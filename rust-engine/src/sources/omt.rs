use tokio::sync::broadcast;
use tracing::{info, warn};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use crate::types::OmtStreamInfo;

/// Open Media Transport (OMT) protocol discoverer.
///
/// Discovery uses DNS-SD/mDNS on `_omt._tcp.local`. Only what a publisher
/// actually advertises is reported to the UI; nothing here is invented.
/// Receiving/decoding lives in `sources::omt_receive`.
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
                                        let port = info.get_port();
                                        let full_name = info.get_fullname().to_string();

                                        // A source is announced once per network interface, so
                                        // pick one sensible address (IPv4, non-loopback) and
                                        // de-duplicate below by name+port instead of by address.
                                        let host = info.get_addresses().iter()
                                            .find(|a| a.is_ipv4() && !a.is_loopback())
                                            .or_else(|| info.get_addresses().iter().find(|a| a.is_ipv4()))
                                            .or_else(|| info.get_addresses().iter().next())
                                            .map(|a| a.to_string())
                                            .unwrap_or_else(|| "127.0.0.1".to_string());

                                        // Only report what the sender actually advertises —
                                        // never invent a resolution.
                                        let props = info.get_properties();
                                        let txt = |key: &str| props.get(key).map(|v| v.val_str().to_string());
                                        let resolution = match (txt("width"), txt("height")) {
                                            (Some(w), Some(h)) => format!("{}x{}", w, h),
                                            _ => txt("resolution").unwrap_or_else(|| "unknown".to_string()),
                                        };
                                        let fps = txt("fps")
                                            .and_then(|v| v.parse::<u32>().ok())
                                            .unwrap_or(0);

                                        info!("Discovered OMT source: {} at {}:{}", full_name, host, port);

                                        let stream_info = OmtStreamInfo {
                                            id: format!("omt-{}-{}", full_name, port),
                                            name: full_name,
                                            host,
                                            port,
                                            resolution,
                                            fps,
                                            is_online: true,
                                            is_active: false,
                                        };

                                        // One entry per publisher, not one per interface.
                                        if !known_sources.iter().any(|s: &OmtStreamInfo| {
                                            s.name == stream_info.name && s.port == stream_info.port
                                        }) {
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
}
