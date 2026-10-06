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
                            let mut known_sources: Vec<OmtStreamInfo> = Vec::new();

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
                                        // mDNS resolves a publisher across interfaces and
                                        // protocols, so an announcement may carry only an IPv6
                                        // address even though the sender listens on IPv4. Keep
                                        // the best address seen so far rather than whichever one
                                        // happened to arrive first — otherwise the stored
                                        // address can be one the sender does not actually serve.
                                        match known_sources.iter_mut().find(|s| {
                                            s.name == stream_info.name && s.port == stream_info.port
                                        }) {
                                            Some(existing) => {
                                                if address_rank(&stream_info.host) < address_rank(&existing.host) {
                                                    info!(
                                                        "OMT source {} address upgraded {} -> {}",
                                                        existing.name, existing.host, stream_info.host
                                                    );
                                                    existing.host = stream_info.host.clone();
                                                    existing.resolution = stream_info.resolution.clone();
                                                    existing.fps = stream_info.fps;
                                                    existing.is_online = true;
                                                    let _ = tx.send(known_sources.clone());
                                                }
                                            }
                                            None => {
                                                known_sources.push(stream_info);
                                                let _ = tx.send(known_sources.clone());
                                            }
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

/// Lower is better when choosing which address to connect to.
///
/// A routable IPv4 address wins, then loopback IPv4, then IPv6. OMT senders are
/// commonly IPv4-only, so storing an advertised IPv6 address they do not
/// actually listen on produces a refused connection.
fn address_rank(host: &str) -> u8 {
    match host.parse::<std::net::IpAddr>() {
        Ok(ip) if ip.is_ipv4() && !ip.is_loopback() => 0,
        Ok(ip) if ip.is_ipv4() => 1,
        Ok(_) => 2,
        Err(_) => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::address_rank;

    #[test]
    fn prefers_routable_ipv4_over_loopback_and_ipv6() {
        assert!(address_rank("192.168.1.69") < address_rank("127.0.0.1"));
        assert!(address_rank("127.0.0.1") < address_rank("2001:818:e262:c400::1"));
        assert!(address_rank("2001:818:e262:c400::1") < address_rank("localhost"));
    }
}
