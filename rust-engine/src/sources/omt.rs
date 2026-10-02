use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::io::AsyncReadExt;
use tokio::sync::broadcast;
use tracing::{info, warn, error};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use crate::types::OmtStreamInfo;

/// Open Media Transport (OMT) Protocol Receiver & Discoverer
/// Protocol details:
/// - Transport: TCP (default port range ~5960-5970 or 8080)
/// - Discovery: DNS-SD mDNS service type `_omt._tcp.local`
/// - Video Codec: VMX (ultra low latency) or Uncompressed RGB/YUV
pub struct OmtReceiver {
    active_stream_url: Option<String>,
}

impl OmtReceiver {
    pub fn new() -> Self {
        Self {
            active_stream_url: None,
        }
    }

    /// Background task to discover available OMT sources on the local network via mDNS
    pub async fn start_discovery(tx: broadcast::Sender<Vec<OmtStreamInfo>>) {
        tokio::spawn(async move {
            match ServiceDaemon::new() {
                Ok(mdns) => {
                    let service_type = "_omt._tcp.local.";
                    match mdns.browse(service_type) {
                        Ok(receiver) => {
                            info!("OMT mDNS discovery active for {}", service_type);
                            let mut known_sources = Vec::new();

                            while let Ok(event) = receiver.recv_async().await {
                                match event {
                                    ServiceEvent::ServiceResolved(info) => {
                                        let host = info.get_addresses().iter().next()
                                            .map(|a| a.to_string())
                                            .unwrap_or_else(|| "127.0.0.1".to_string());
                                        let port = info.get_port();
                                        let full_name = info.get_fullname().to_string();

                                        info!("Discovered OMT source: {} at {}:{}", full_name, host, port);

                                        let stream_info = OmtStreamInfo {
                                            id: format!("omt-{}-{}", host, port),
                                            name: full_name,
                                            host,
                                            port,
                                            resolution: "1920x1080".to_string(),
                                            fps: 60,
                                            is_online: true,
                                            is_active: false,
                                        };

                                        if !known_sources.iter().any(|s: &OmtStreamInfo| s.id == stream_info.id) {
                                            known_sources.push(stream_info);
                                            let _ = tx.send(known_sources.clone());
                                        }
                                    }
                                    ServiceEvent::ServiceRemoved(_, fullname) => {
                                        info!("OMT source offline: {}", fullname);
                                        known_sources.retain(|s| s.name != fullname);
                                        let _ = tx.send(known_sources.clone());
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Err(e) => warn!("Failed to browse OMT mDNS: {}", e),
                    }
                }
                Err(e) => warn!("mDNS daemon init failed: {}", e),
            }
        });
    }

    /// Connect to an OMT TCP stream and yield incoming decompressed RGB frames
    pub async fn connect_and_stream(
        host: &str,
        port: u16,
        frame_tx: tokio::sync::mpsc::Sender<Arc<Vec<u8>>>,
        width: usize,
        height: usize,
    ) -> anyhow::Result<()> {
        let addr = format!("{}:{}", host, port);
        info!("Connecting to OMT stream at {}", addr);
        let mut stream = TcpStream::connect(&addr).await?;
        info!("Connected to OMT stream {}", addr);

        // Send OMT Client Negotiation Packet (Low-res proxy request to sender):
        // Magic 'OMTN' (4 bytes), Requested Width (u16), Requested Height (u16), Requested FPS (u8), Profile (1 byte: 1=proxy, 0=main)
        use tokio::io::AsyncWriteExt;
        let negotiation_pkt = [
            b'O', b'M', b'T', b'N',
            (width >> 8) as u8, (width & 0xFF) as u8,
            (height >> 8) as u8, (height & 0xFF) as u8,
            60u8, // 60 FPS target
            1u8,  // 1 = proxy profile, 0 = main
        ];
        if let Err(e) = stream.write_all(&negotiation_pkt).await {
            warn!("Could not send OMT low-res negotiation handshake: {}", e);
        } else {
            info!("Sent low-res OMT negotiation handshake: {}x{} @ 60 FPS (proxy profile)", width, height);
        }

        let mut header_buf = [0u8; 16]; // OMT Packet Header: 4-byte magic, 4-byte length, 2-byte width, 2-byte height, 4-byte format
        let expected_frame_bytes = width * height * 3;
        let mut frame_buf = vec![0u8; expected_frame_bytes];

        loop {
            // Read container packet header
            if let Err(e) = stream.read_exact(&mut header_buf).await {
                error!("OMT stream disconnected: {}", e);
                break;
            }

            // Read video payload
            if let Err(e) = stream.read_exact(&mut frame_buf).await {
                error!("OMT payload read failed: {}", e);
                break;
            }

            // Deliver frame to parallel lighting engine
            if frame_tx.send(Arc::new(frame_buf.clone())).await.is_err() {
                break;
            }
        }

        Ok(())
    }
}
