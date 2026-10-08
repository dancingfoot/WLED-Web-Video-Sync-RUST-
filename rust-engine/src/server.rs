use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use tower_http::cors::CorsLayer;
use tracing::{info, warn};
use crate::types::{EngineTelemetry, MatrixLayout, ColorCalibration, DmxUniversePatch, OmtStreamInfo, SourceRegion, PreviewFrame};

pub struct AppState {
    pub telemetry: RwLock<EngineTelemetry>,
    pub layout: RwLock<MatrixLayout>,
    pub calibration: RwLock<ColorCalibration>,
    pub patches: RwLock<Vec<DmxUniversePatch>>,
    pub omt_sources: RwLock<Vec<OmtStreamInfo>>,
    pub region: RwLock<SourceRegion>,
    /// Id of the OMT stream the client asked us to subscribe to. `None` means
    /// the procedural generator is the active source.
    pub selected_omt: RwLock<Option<String>>,
    /// Latest downscaled frame, published so the UI can show what is arriving.
    pub preview: RwLock<Option<PreviewFrame>>,
    pub omt_broadcast_rx: broadcast::Sender<Vec<OmtStreamInfo>>,
}

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/health", get(health_check))
        .route("/api/omt/sources", get(get_omt_sources))
        .route("/ws", get(ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "online",
        "engine": "rust-wled-dmx-sync",
        // Real crate version, kept in step with VERSION by scripts/version.sh.
        "version": env!("CARGO_PKG_VERSION"),
        // Report what this build actually has, not what it could have.
        "wayland_support": cfg!(feature = "wayland-pipewire"),
        "omt_support": cfg!(feature = "omt")
    }))
}

async fn get_omt_sources(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let sources = state.omt_sources.read().await;
    Json(sources.clone())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    info!("Client connected to Rust Engine WebSocket");

    // Interval to send live engine telemetry at 20Hz
    let mut interval = tokio::time::interval(std::time::Duration::from_millis(50));
    let mut omt_rx = state.omt_broadcast_rx.subscribe();

    // Preview frames go out far more slowly than telemetry: one raw RGB frame
    // is orders of magnitude larger than a telemetry tick.
    let mut preview_interval = tokio::time::interval(std::time::Duration::from_millis(100));
    let mut last_preview_seq: u64 = 0;

    // Snapshot on connect so a fresh client is immediately in sync with the
    // currently discovered streams and the active source region.
    {
        let sources = state.omt_sources.read().await.clone();
        let msg = serde_json::json!({ "type": "omt_sources", "data": sources });
        let _ = socket.send(Message::Text(msg.to_string())).await;

        let region = *state.region.read().await;
        let msg = serde_json::json!({ "type": "region", "data": region });
        let _ = socket.send(Message::Text(msg.to_string())).await;
    }

    loop {
        tokio::select! {
            _ = interval.tick() => {
                let tele = state.telemetry.read().await;
                let msg = serde_json::json!({
                    "type": "telemetry",
                    "data": *tele
                });
                if socket.send(Message::Text(msg.to_string())).await.is_err() {
                    break;
                }
            }
            Ok(sources) = omt_rx.recv() => {
                let msg = serde_json::json!({ "type": "omt_sources", "data": sources });
                if socket.send(Message::Text(msg.to_string())).await.is_err() {
                    break;
                }
            }
            _ = preview_interval.tick() => {
                // Binary framing: [0x01][width u16 LE][height u16 LE][RGB8...]
                let latest = state.preview.read().await.clone();
                if let Some(p) = latest {
                    if p.sequence != last_preview_seq {
                        last_preview_seq = p.sequence;
                        let mut buf = Vec::with_capacity(5 + p.rgb.len());
                        buf.push(0x01);
                        buf.extend_from_slice(&(p.width as u16).to_le_bytes());
                        buf.extend_from_slice(&(p.height as u16).to_le_bytes());
                        buf.extend_from_slice(&p.rgb);
                        if socket.send(Message::Binary(buf)).await.is_err() {
                            break;
                        }
                    }
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                            if let Some(cmd) = val.get("command").and_then(|c| c.as_str()) {
                                match cmd {
                                    "update_calibration" => {
                                        if let Some(calib) = val.get("calibration") {
                                            if let Ok(c) = serde_json::from_value::<ColorCalibration>(calib.clone()) {
                                                *state.calibration.write().await = c;
                                            }
                                        }
                                    }
                                    "update_layout" => {
                                        if let Some(lay) = val.get("layout") {
                                            if let Ok(l) = serde_json::from_value::<MatrixLayout>(lay.clone()) {
                                                *state.layout.write().await = l;
                                            }
                                        }
                                    }
                                    "update_patches" => {
                                        if let Some(p) = val.get("patches") {
                                            if let Ok(patches) = serde_json::from_value::<Vec<DmxUniversePatch>>(p.clone()) {
                                                *state.patches.write().await = patches;
                                            }
                                        }
                                    }
                                    "select_omt_source" => {
                                        if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
                                            info!("Client selected OMT source {}", id);
                                            *state.selected_omt.write().await = Some(id.to_string());
                                        }
                                    }
                                    "clear_omt_source" => {
                                        info!("Client cleared the OMT selection");
                                        *state.selected_omt.write().await = None;
                                    }
                                    "rescan_omt" => {
                                        // Discovery is continuous; re-emit the current list so
                                        // the client gets a fresh snapshot on demand.
                                        let sources = state.omt_sources.read().await.clone();
                                        let _ = state.omt_broadcast_rx.send(sources);
                                    }
                                    "update_region" => {
                                        if let Some(r) = val.get("region") {
                                            if let Ok(region) = serde_json::from_value::<SourceRegion>(r.clone()) {
                                                *state.region.write().await = region;
                                                // Echo the accepted region so the UI and engine agree.
                                                // Out-of-frame values are clamped later, at sample time.
                                                let msg = serde_json::json!({ "type": "region", "data": region });
                                                let _ = socket.send(Message::Text(msg.to_string())).await;
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    info!("Client disconnected from Rust Engine WebSocket");
}
