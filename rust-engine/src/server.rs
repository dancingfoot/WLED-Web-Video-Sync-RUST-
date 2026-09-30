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
use crate::types::{EngineTelemetry, MatrixLayout, ColorCalibration, DmxUniversePatch, OmtStreamInfo};

pub struct AppState {
    pub telemetry: RwLock<EngineTelemetry>,
    pub layout: RwLock<MatrixLayout>,
    pub calibration: RwLock<ColorCalibration>,
    pub patches: RwLock<Vec<DmxUniversePatch>>,
    pub omt_sources: RwLock<Vec<OmtStreamInfo>>,
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
        "version": "1.0.0",
        "wayland_support": true,
        "omt_support": true
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
