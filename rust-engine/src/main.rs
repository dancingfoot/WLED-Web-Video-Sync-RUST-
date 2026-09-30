use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio::net::UdpSocket;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

mod types;
mod protocols;
mod pipeline;
mod sources;
mod server;

use types::{EngineTelemetry, MatrixLayout, ColorCalibration, DmxUniversePatch, OmtStreamInfo, SyncProtocol};
use protocols::{DdpBuilder, ArtNetBuilder, SacnBuilder, WarlsBuilder};
use pipeline::PixelSampler;
use sources::{OmtReceiver, WaylandCaptureEngine, ProceduralEngine, ProceduralPattern};
use server::{AppState, create_router};

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

    // Frame ingestion channel: sources send raw 1920x1080 RGB frames here
    let (frame_tx, mut frame_rx) = mpsc::channel::<Arc<Vec<u8>>>(4);

    // Launch default source (Procedural rainbow generator or Wayland capture)
    ProceduralEngine::start_generator(
        ProceduralPattern::RainbowWave,
        frame_tx.clone(),
        1280,
        720,
        60, // 60 FPS target
    );

    // Spawn Axum HTTP and WebSocket API Server on port 8080
    let api_state = app_state.clone();
    tokio::spawn(async move {
        let app = create_router(api_state);
        let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
        info!("Rust Engine WebSocket & API listening on http://0.0.0.0:8080");
        axum::serve(listener, app).await.unwrap();
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

        // 1. Rayon parallel downsampling & gamma/color correction
        let sampled_pixels = sampler.sample_frame_to_leds(
            &raw_frame,
            1280,
            720,
            &layout,
            &calib,
        );

        let mut packets_sent_this_frame: u64 = 0;
        let mut bytes_sent_this_frame: u64 = 0;

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
                        let _ = udp_socket.send_to(&pkt, &target_addr).await;
                    }
                }
                SyncProtocol::ArtNet => {
                    let packets = artnet.build_multi_universe_packets(patch.start_universe, led_slice);
                    let target_addr = format!("{}:{}", patch.target_ip, patch.target_port);
                    for (_univ, pkt) in packets {
                        bytes_sent_this_frame += pkt.len() as u64;
                        packets_sent_this_frame += 1;
                        let _ = udp_socket.send_to(&pkt, &target_addr).await;
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
                    let _ = udp_socket.send_to(&packet, &target_addr).await;
                }
                SyncProtocol::Warls => {
                    let packet = WarlsBuilder::build_warls(led_slice, 2);
                    let target_addr = format!("{}:{}", patch.target_ip, patch.target_port);
                    bytes_sent_this_frame += packet.len() as u64;
                    packets_sent_this_frame += 1;
                    let _ = udp_socket.send_to(&packet, &target_addr).await;
                }
                SyncProtocol::Drgb => {
                    let packet = WarlsBuilder::build_drgb(led_slice, 2);
                    let target_addr = format!("{}:{}", patch.target_ip, patch.target_port);
                    bytes_sent_this_frame += packet.len() as u64;
                    packets_sent_this_frame += 1;
                    let _ = udp_socket.send_to(&packet, &target_addr).await;
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
            tele.bytes_sent += bytes_sent_this_frame;
            tele.total_leds = layout.width * layout.height;
            tele.total_universes = patches.len();
        }
    }

    Ok(())
}
