# WLED & DMX Video Sync Engine (Rust Core)

High-performance, ultra-low-latency video-to-LED lighting sync engine written in Rust. Designed for Linux Wayland, Open Media Transport (OMT), and high-density multi-universe DMX installations (DDP, Art-Net 4, sACN E1.31, WLED).

---

## Features

- **Blazing Performance:** Rayon parallelized downsampling, SIMD color matrix transforms, zero-allocation packet packing.
- **Linux Wayland Capture:** Native Wayland screen capture via `xdg-desktop-portal` (`org.freedesktop.portal.ScreenCast`) and PipeWire DMA-BUF with sub-millisecond latency.
- **Open Media Transport (OMT) Receiver:** Automatic mDNS discovery (`_omt._tcp.local`) for OMT feeds from vMix, OBS DistroAV, Open Camera, or hardware transmitters.
- **Multi-Protocol DMX Output:**
  - **DDP:** Native WLED protocol with push flag, sequence verification, and automatic packet chunking.
  - **Art-Net 4:** DMX512 packets sliced across consecutive Art-Net universes (170 RGB LEDs / 510 channels per universe).
  - **sACN (ANSI E1.31):** Full Root/Framing/DMP layers with Multicast (`239.255.x.x`) and Unicast routing.
  - **WLED WARLS / DRGB:** Legacy real-time UDP formats.
- **Built-in Axum Web & WebSocket Server:** Runs on port `8080`, providing real-time telemetry, live matrix visualization, and remote configuration from any device on your LAN.

---

## Building from Source

### 1. Prerequisites (Linux)

#### Ubuntu / Debian / Pop!_OS:
```bash
sudo apt update
sudo apt install -y build-essential pkg-config libclang-dev libpipewire-0.3-dev libspa-0.2-dev libdbus-1-dev
```

#### Fedora / RHEL:
```bash
sudo dnf install -y gcc clang-devel pipewire-devel dbus-devel
```

#### Arch Linux:
```bash
sudo pacman -S base-devel clang pipewire
```

### 2. Compile Release Binary

```bash
cd rust-engine

# Build with standard features (OMT, DMX, DDP, Procedural)
cargo build --release

# OR build with native Wayland PipeWire DMA-BUF capture:
cargo build --release --features wayland-pipewire
```

The optimized binary will be created at `target/release/wled-video-sync-rust`.

---

## Running the Engine

```bash
./target/release/wled-video-sync-rust
```

Once running:
- Open `http://localhost:8080` or connect your Web UI to `ws://localhost:8080/ws`.
- Discovered OMT sources on the network will appear automatically.
- DDP and DMX UDP packets will broadcast directly to your lights with sub-millisecond latency.

---

## Systemd Service Setup (Optional)

To run the engine automatically in the background on your media rig or stage server:

Create `/etc/systemd/system/wled-sync.service`:
```ini
[Unit]
Description=WLED & DMX Video Sync Rust Engine
After=network.target pipewire.service

[Service]
Type=simple
User=YOUR_USERNAME
ExecStart=/usr/local/bin/wled-video-sync-rust
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wled-sync.service
```
