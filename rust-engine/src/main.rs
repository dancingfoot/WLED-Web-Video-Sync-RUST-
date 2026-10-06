use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio::net::UdpSocket;
use tracing::{error, info, warn, Level};
use tracing_subscriber::FmtSubscriber;

mod types;
mod protocols;
mod pipeline;
mod sources;
mod server;

use types::{EngineTelemetry, MatrixLayout, ColorCalibration, DmxUniversePatch, OmtStreamInfo, SyncProtocol, SourceRegion, VideoFrame};
use protocols::{DdpBuilder, ArtNetBuilder, SacnBuilder, WarlsBuilder};
use pipeline::PixelSampler;
use sources::{OmtReceiver, WaylandCaptureEngine, ProceduralEngine, ProceduralPattern};
use sources::omt_receive;
use server::{AppState, create_router};

/// Native size of the frame pipeline. Every source must deliver frames at this
/// resolution; `SourceRegion` then selects the part mapped onto the matrix.
const SOURCE_WIDTH: usize = 1280;
const SOURCE_HEIGHT: usize = 720;

/// Hand a datagram to the socket without ever blocking the render loop.
///
/// A DMX target that does not exist on the network (the shipped defaults are
/// placeholders) leaves the kernel's ARP entry INCOMPLETE. Awaiting the send
/// then stalls the whole frame loop for as long as resolution takes — measured
/// at ~1.8s per stall — which wrecks the output timing. Dropping the packet and
/// counting it keeps the matrix running at full rate.
fn send_now(socket: &UdpSocket, packet: &[u8], addr: &str, dropped: &mut u64) -> bool {
    // Patch targets are IP literals; anything unparseable is counted as dropped
    // rather than silently ignored or, worse, blocking.
    let Ok(target) = addr.parse::<std::net::SocketAddr>() else {
        *dropped += 1;
        return false;
    };
    match socket.try_send_to(packet, target) {
        Ok(_) => true,
        Err(_) => {
            *dropped += 1;
            false
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize high-performance tracing
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    info!("============================================================");
    info!(" WLED & DMX Video Sync Engine (Rust Ultra-Low-Latency Core)");
    info!(" Supporting: Linux Wayland PipeWire, Open Media Transport (OMT)");
    info!(" Protocols: DDP, Art-Net 4, sACN E1.31, WLED WARLS/DRGB");
    info!("============================================================");

    // Channels for mDNS discovered OMT sources
    let (omt_tx, mut omt_rx) = broadcast::channel::<Vec<OmtStreamInfo>>(16);

    // Initial state setup
    let initial_patches = vec![
        DmxUniversePatch {
            id: "main-wled".to_string(),
            name: "Main WLED Matrix (DDP)".to_string(),
            target_ip: "192.168.1.100".to_string(),
            target_port: 4048,
            protocol: SyncProtocol::Ddp,
            start_universe: 1,
            universe_count: 1,
            channels_per_universe: 512,
            start_led_index: 0,
            led_count: 256,
            enabled: true,
        },
        DmxUniversePatch {
            id: "artnet-stage-wash".to_string(),
            name: "Stage Wash DMX (Art-Net 4)".to_string(),
            target_ip: "192.168.1.200".to_string(),
            target_port: 6454,
            protocol: SyncProtocol::ArtNet,
            start_universe: 0,
            universe_count: 4,
            channels_per_universe: 510,
            start_led_index: 0,
            led_count: 680,
            enabled: true,
        },
    ];

    let app_state = Arc::new(AppState {
        telemetry: RwLock::new(EngineTelemetry::default()),
        layout: RwLock::new(MatrixLayout::default()),
        calibration: RwLock::new(ColorCalibration::default()),
        patches: RwLock::new(initial_patches),
        omt_sources: RwLock::new(Vec::new()),
        region: RwLock::new(SourceRegion::default()),
        selected_omt: RwLock::new(None),
        omt_broadcast_rx: omt_tx.clone(),
    });

    // Start background OMT mDNS discovery
    OmtReceiver::start_discovery(omt_tx).await;

    // Listen for discovered OMT sources and update app state
    let state_omt_clone = app_state.clone();
    tokio::spawn(async move {
        while let Ok(sources) = omt_rx.recv().await {
            *state_omt_clone.omt_sources.write().await = sources;
        }
    });

    // Start high-performance non-blocking UDP socket
    let udp_socket = Arc::new(UdpSocket::bind("0.0.0.0:0").await?);
    info!("UDP sender socket bound successfully on local interface");

    // Frame ingestion channel. Sources deliver frames at their own resolution,
    // so each frame carries its own dimensions.
    let (frame_tx, mut frame_rx) = mpsc::channel::<Arc<VideoFrame>>(4);

    // ---- Active source supervisor -------------------------------------------
    // Owns whichever source is feeding the pipeline. Watches the client's OMT
    // selection and swaps sources to match, making sure exactly one is ever
    // running. Connection problems go into the shared status string, which is
    // reported through telemetry, so the UI can show them rather than looking
    // like nothing happened.
    let source_status = omt_receive::new_status("starting up");

    // Publish the source status independently of the frame loop. If the active
    // source never delivers frames — a dead OMT publisher, say — the pipeline
    // goes quiet, and without this the UI would just see frozen telemetry
    // instead of the reason.
    {
        let sync_state = app_state.clone();
        let sync_status = source_status.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                // Copy out and release the std lock before awaiting anything.
                let latest = sync_status.lock().map(|s| s.clone()).ok();
                if let Some(s) = latest {
                    let mut tele = sync_state.telemetry.write().await;
                    if tele.source_status != s {
                        tele.source_status = s.clone();
                        tele.active_source = s;
                    }
                }
            }
        });
    }

    {
        let sup_state = app_state.clone();
        let sup_status = source_status.clone();
        let sup_tx = frame_tx.clone();
        tokio::spawn(async move {
            // Sentinel so the first pass applies the default (procedural) source.
            let mut current: Option<String> = Some("<uninitialised>".to_string());
            let mut handle: Option<omt_receive::OmtReceiverHandle> = None;
            let mut procedural_stop: Option<Arc<AtomicBool>> = None;

            let start_procedural = |status: &omt_receive::SourceStatus| {
                let stop = ProceduralEngine::start_generator(
                    ProceduralPattern::RainbowWave,
                    sup_tx.clone(),
                    SOURCE_WIDTH,
                    SOURCE_HEIGHT,
                    60,
                );
                omt_receive::set_status(status, "procedural generator running");
                stop
            };

            loop {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;

                // Checked every tick, before the early-continue below, because the
                // selection does not change when a receiver fails.
                if handle.as_ref().is_some_and(|h| h.has_failed()) {
                    handle = None;
                    let reason = sup_status
                        .lock()
                        .map(|s| s.clone())
                        .unwrap_or_else(|_| "OMT source unavailable".to_string());
                    // Clear the selection so the operator can pick it again.
                    *sup_state.selected_omt.write().await = None;
                    current = None;
                    procedural_stop = Some(start_procedural(&sup_status));
                    omt_receive::set_status(
                        &sup_status,
                        format!("{} — fell back to the procedural generator", reason),
                    );
                    warn!("{}", reason);
                }

                let want = sup_state.selected_omt.read().await.clone();
                if want == current {
                    continue;
                }
                current = want.clone();

                // Tear down whatever was running so only one source feeds the pipeline.
                if let Some(h) = handle.take() {
                    h.stop();
                }
                if let Some(s) = procedural_stop.take() {
                    s.store(true, Ordering::Relaxed);
                }

                let Some(id) = want else {
                    procedural_stop = Some(start_procedural(&sup_status));
                    continue;
                };

                let found = sup_state
                    .omt_sources
                    .read()
                    .await
                    .iter()
                    .find(|s| s.id == id)
                    .cloned();

                match found {
                    Some(src) => {
                        let url = format!("omt://{}:{}/{}", src.host, src.port, src.name);
                        info!("Subscribing to OMT source {} ({})", src.name, url);
                        handle = Some(omt_receive::spawn(
                            src.name.clone(),
                            url,
                            vec![src.host.clone()],
                            sup_tx.clone(),
                            sup_status.clone(),
                        ));
                    }
                    None => {
                        // Selected stream vanished from discovery: stay procedural
                        // and say why rather than silently doing nothing.
                        let msg = format!(
                            "selected stream '{}' is no longer available — using procedural",
                            id
                        );
                        warn!("{}", msg);
                        current = None;
                        *sup_state.selected_omt.write().await = None;
                        procedural_stop = Some(start_procedural(&sup_status));
                        omt_receive::set_status(&sup_status, msg);
                    }
                }
            }
        });
    }

    // Spawn Axum HTTP and WebSocket API Server. The port is overridable so a
    // second instance (or a test run) does not collide with an existing engine.
    let api_port: u16 = std::env::var("ENGINE_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8080);

    let api_state = app_state.clone();
    tokio::spawn(async move {
        let app = create_router(api_state);
        let listener = match tokio::net::TcpListener::bind(("0.0.0.0", api_port)).await {
            Ok(l) => l,
            Err(e) => {
                error!(
                    "Cannot bind API port {}: {}. Another engine may already be running — \
                     stop it or set ENGINE_PORT=<port> to use a different one.",
                    api_port, e
                );
                std::process::exit(1);
            }
        };
        info!("Rust Engine WebSocket & API listening on http://0.0.0.0:{}", api_port);
        if let Err(e) = axum::serve(listener, app).await {
            error!("API server stopped: {}", e);
        }
    });

    // Protocol packet builders
    let mut ddp = DdpBuilder::new();
    let mut artnet = ArtNetBuilder::new();
    let mut sacn = SacnBuilder::new("Rust WLED Sync");
    let mut sampler = PixelSampler::new(1.0);

    let mut fps_counter: u32 = 0;
    let mut last_fps_time = std::time::Instant::now();

    info!("Entering ultra-low-latency pixel processing & DMX broadcast loop...");

    while let Some(raw_frame) = frame_rx.recv().await {
        let loop_start = std::time::Instant::now();

        let layout = app_state.layout.read().await.clone();
        let calib = app_state.calibration.read().await.clone();
        let patches = app_state.patches.read().await.clone();
        let region = *app_state.region.read().await;

        // 1. Rayon parallel downsampling & gamma/color correction
        let sampled_pixels = sampler.sample_frame_to_leds(
            &raw_frame.rgb,
            raw_frame.width,
            raw_frame.height,
            &layout,
            &calib,
            &region,
        );

        let mut packets_sent_this_frame: u64 = 0;
        let mut bytes_sent_this_frame: u64 = 0;
        let mut dropped_this_frame: u64 = 0;

        // 2. Dispatch packets across all active DMX patches
        for patch in &patches {
            if !patch.enabled {
                continue;
            }

            let start_byte = patch.start_led_index * 3;
            let end_byte = (start_byte + patch.led_count * 3).min(sampled_pixels.len());
            if start_byte >= sampled_pixels.len() {
                continue;
            }
            let led_slice = &sampled_pixels[start_byte..end_byte];

            match patch.protocol {
                SyncProtocol::Ddp => {
                    let packets = ddp.build_packets(led_slice, 0);
                    let target_addr = format!("{}:{}", patch.target_ip, patch.target_port);
                    for pkt in packets {
                        bytes_sent_this_frame += pkt.len() as u64;
                        packets_sent_this_frame += 1;
                        send_now(&udp_socket, &pkt, &target_addr, &mut dropped_this_frame);
                    }
                }
                SyncProtocol::ArtNet => {
                    let packets = artnet.build_multi_universe_packets(patch.start_universe, led_slice);
                    let target_addr = format!("{}:{}", patch.target_ip, patch.target_port);
                    for (_univ, pkt) in packets {
                        bytes_sent_this_frame += pkt.len() as u64;
                        packets_sent_this_frame += 1;
                        send_now(&udp_socket, &pkt, &target_addr, &mut dropped_this_frame);
                    }
                }
                SyncProtocol::SacnE131 => {
                    // Send sACN packet
                    let packet = sacn.build_universe_packet(patch.start_universe, led_slice, 100);
                    let target_addr = if patch.target_ip.is_empty() || patch.target_ip == "239.255.0.0" {
                        format!("{}:{}", SacnBuilder::multicast_ip_for_universe(patch.start_universe), patch.target_port)
                    } else {
                        format!("{}:{}", patch.target_ip, patch.target_port)
                    };
                    bytes_sent_this_frame += packet.len() as u64;
                    packets_sent_this_frame += 1;
                    send_now(&udp_socket, &packet, &target_addr, &mut dropped_this_frame);
                }
                SyncProtocol::Warls => {
                    let packet = WarlsBuilder::build_warls(led_slice, 2);
                    let target_addr = format!("{}:{}", patch.target_ip, patch.target_port);
                    bytes_sent_this_frame += packet.len() as u64;
                    packets_sent_this_frame += 1;
                    send_now(&udp_socket, &packet, &target_addr, &mut dropped_this_frame);
                }
                SyncProtocol::Drgb => {
                    let packet = WarlsBuilder::build_drgb(led_slice, 2);
                    let target_addr = format!("{}:{}", patch.target_ip, patch.target_port);
                    bytes_sent_this_frame += packet.len() as u64;
                    packets_sent_this_frame += 1;
                    send_now(&udp_socket, &packet, &target_addr, &mut dropped_this_frame);
                }
            }
        }

        // Performance metrics
        let render_duration = loop_start.elapsed();
        fps_counter += 1;

        if last_fps_time.elapsed().as_secs() >= 1 {
            let actual_fps = fps_counter as f32;
            fps_counter = 0;
            last_fps_time = std::time::Instant::now();

            let mut tele = app_state.telemetry.write().await;
            tele.fps = actual_fps;
            tele.render_time_us = render_duration.as_micros() as u64;
            tele.packets_sent += packets_sent_this_frame;
            tele.bytes_sent = tele.bytes_sent.saturating_add(bytes_sent_this_frame);
            tele.total_leds = layout.width * layout.height;
            tele.total_universes = patches.len();
            tele.dropped_frames = tele.dropped_frames.saturating_add(dropped_this_frame);
        }
    }

    Ok(())
}
