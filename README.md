# WLED Web Video Sync (Rust Core) 🚀

Sync real-time video, screen capture, webcam feeds, and procedural effects to WLED
matrixes, strips, and spotlights — driven either from your **browser** or from a
standalone **Rust engine** built for headless, ultra-low-latency operation.

This repository contains **two independent programs** that share the same DMX output
protocols:

| Component | Language | Role | Default port |
|---|---|---|---|
| **Web UI + Node server** | TypeScript / React | Browser capture (screen, camera, video files), live preview, sends pixels over WebSocket and emits UDP DMX | `3000` |
| **Rust engine** | Rust | Headless native capture (Wayland/PipeWire, OMT), Rayon-parallel pixel sampling, UDP DMX broadcast, telemetry API | `8080` |

You can run either one on its own. The Rust engine is the one you want on a
Raspberry Pi or a media rig; the web app is the one you want for quick browser-based
setup.

---

## 📋 Requirements at a Glance

| What | Minimum | Needed for |
|---|---|---|
| Git | any | cloning |
| Node.js | **18+** (20 LTS or 24 recommended) | web UI |
| Rust toolchain | stable (via rustup) | Rust engine |
| C linker (`gcc`/`cc`) | any | Rust engine |
| `pkg-config` | any | Rust engine |
| PipeWire + D-Bus dev headers | optional | Rust engine **Wayland capture only** |

The Rust engine's default build has **no** PipeWire/D-Bus/X11 dependency — those are
behind an optional Cargo feature. A plain `cargo build --release` only needs a C
linker.

---

## 💻 Part 1 — Web App (Any Desktop Linux / macOS / Windows)

### 1. Clone the repository

```bash
git clone https://github.com/dancingfoot/WLED-Web-Video-Sync-RUST-.git
cd WLED-Web-Video-Sync-RUST-
```

Already cloned? Update to the latest version:

```bash
git pull origin main
```

If you have local changes you want to keep:

```bash
git stash        # save local work
git pull origin main
git stash pop    # re-apply it
```

### 2. Install Node.js

Check first — if this prints `v18` or higher you can skip the install:

```bash
node --version
```

**Pop!_OS / Ubuntu / Debian:**

```bash
sudo apt update
sudo apt install -y nodejs npm
```

> Distro repositories often ship an older Node than you want. For Node 20 LTS or
> newer, use [NodeSource](https://github.com/nodesource/distributions) or
> [nvm](https://github.com/nvm-sh/nvm) instead.

**Fedora / RHEL:**

```bash
sudo dnf install -y nodejs npm
```

**Arch:**

```bash
sudo pacman -S nodejs npm
```

**macOS (Homebrew):**

```bash
brew install node
```

### 3. Install dependencies and run

```bash
npm install     # downloads Node/React dependencies into node_modules/

npm run dev     # dev server with hot reload
```

Open **<http://localhost:3000>**.

If port `3000` is already taken by another project, pick a free one with the `PORT`
environment variable:

```bash
PORT=3002 npm run dev
```

The UI's own WebSocket is same-origin, so it follows whichever port you choose. Only
the Rust engine's address (`ws://localhost:8080/ws`) stays fixed.

### 4. Production build

```bash
npm run build                      # bundles UI -> dist/, compiles server -> dist/server.cjs
NODE_ENV=production npm start      # serves the built assets
```

`NODE_ENV=production` matters: without it the server boots a Vite dev middleware
instead of serving `dist/`, so you would be running development mode in production.

### Other scripts

```bash
npm run lint    # tsc --noEmit — type-check only, no output files
```

### Environment variables

**You do not need a `.env` file.** The bundled `.env.example` (`GEMINI_API_KEY`,
`APP_URL`) is vestigial — it is inherited from the AI Studio template and **no code
in this repository reads either variable**. You can safely ignore it.

The one environment variable the server does read is `PORT` (default `3000`), used to
override the web server's listen port. It is read directly from the process
environment, so a `.env` file will not set it — pass it inline as shown above.

---

## 🦀 Part 2 — Rust Engine

The Rust engine is a separate program in `rust-engine/`. It performs native capture,
parallel pixel downsampling, and UDP DMX broadcast, and exposes a telemetry API on
port `8080`.

### 1. Install the Rust toolchain (rustup)

Install the official toolchain via rustup rather than your distro's `rustc`, which is
often outdated. rustup installs into `~/.cargo` and **does not require sudo**:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
```

Then load it into your current shell:

```bash
source "$HOME/.cargo/env"
```

Verify:

```bash
cargo --version    # e.g. cargo 1.99.0
rustc --version
```

To make `cargo` permanently available in new shells, add it to your shell profile:

```bash
echo '. "$HOME/.cargo/env"' >> ~/.bashrc
```

> **Note on `--profile minimal`:** this omits `rustfmt` and `clippy`, which is all you
> need to build. If you plan to contribute, drop `--profile minimal` to get the full
> component set, or add them later with
> `rustup component add clippy rustfmt`.

### 2. Install build prerequisites

The default build links native code, so a C toolchain is required.

**Pop!_OS / Ubuntu / Debian:**

```bash
sudo apt update
sudo apt install -y build-essential pkg-config
```

**Fedora / RHEL:**

```bash
sudo dnf install -y gcc gcc-c++ make pkg-config
```

**Arch:**

```bash
sudo pacman -S --needed base-devel pkg-config
```

**macOS:** install the Xcode command line tools:

```bash
xcode-select --install
```

### 3. Optional — Wayland / PipeWire capture support

Native screen capture through `xdg-desktop-portal` + PipeWire is **off by default**.
Enable it only if you need it; then install the headers first:

**Pop!_OS / Ubuntu / Debian:**

```bash
sudo apt install -y libclang-dev libpipewire-0.3-dev libspa-0.2-dev libdbus-1-dev
```

**Fedora / RHEL:**

```bash
sudo dnf install -y clang-devel pipewire-devel dbus-devel
```

**Arch:**

```bash
sudo pacman -S --needed clang pipewire
```

### 4. Build and run

```bash
cd rust-engine

# Standard build — OMT, DDP, Art-Net, sACN, procedural effects
cargo build --release

# OR with native Wayland PipeWire capture enabled
cargo build --release --features wayland-pipewire
```

The optimized binary is written to:

```
rust-engine/target/release/wled-video-sync-rust
```

Run it:

```bash
./target/release/wled-video-sync-rust
```

On startup you should see:

```
UDP sender socket bound successfully on local interface
Spawning Procedural Generator at 60 FPS (1280x720)
Rust Engine WebSocket & API listening on http://0.0.0.0:8080
OMT mDNS discovery active for _omt._tcp.local.
```

Then connect the web UI to `ws://localhost:8080/ws`, or query the HTTP API directly:

```bash
curl http://localhost:8080/api/health
```

There is no web page served at the engine's root.

> **The engine takes no command-line arguments.** `clap` is listed in `Cargo.toml` but
> argument parsing is not implemented, so flags such as `--headless` are silently
> ignored and the engine simply starts. It always runs headless — there is no GUI mode.

---

## 🍓 Part 3 — Raspberry Pi 4

Target: **Raspberry Pi 4 Model B** running **Raspberry Pi OS 64-bit (aarch64)**.

64-bit is strongly recommended — the aarch64 target enables SIMD and 64-bit atomics
in the pixel mapper. A 32-bit OS will still work but with lower frame throughput.

### Option A — Automated setup script

The repo ships `scripts/install_pi4.sh`, which provisions the whole stack:

1. Verifies the `aarch64` architecture
2. `apt` installs build deps (`build-essential`, `pkg-config`, `git`, `curl`, `libasound2-dev`)
3. Installs the Rust toolchain via rustup (if `cargo` is missing)
4. Writes `/etc/sysctl.d/99-wled-video-sync.conf` and raises UDP/kernel socket buffers to 25 MB
5. Disables 802.11 power saving on `wlan0` to remove latency spikes
6. Compiles the engine with `cargo build --release`
7. Creates and enables the `wled-video-sync.service` systemd unit

Run it **from the repository root**, on the Pi:

```bash
git clone https://github.com/dancingfoot/WLED-Web-Video-Sync-RUST-.git
cd WLED-Web-Video-Sync-RUST-
chmod +x scripts/install_pi4.sh
./scripts/install_pi4.sh
```

The script uses `sudo` for the `apt`, `sysctl`, and `systemd` steps, so you will be
prompted for your password. It also needs network access to download crates.

> **It does not install Node.js.** If you also want the browser UI on the Pi, install it
> separately (see [Part 1, step 2](#2-install-nodejs)).
>
> **It builds without `--features wayland-pipewire`,** so Pi-side Wayland capture is not
> enabled by the script. Edit the `cargo build` line and add the dev headers from
> [Part 2, step 3](#3-optional--wayland--pipewire-capture-support) if you need it.
>
> **The `--headless` flag in the generated unit is ignored** — it is a no-op, because the
> engine accepts no arguments.

### Option B — Manual setup

Do it by hand if you want to control each step:

```bash
# 1. System packages
sudo apt update
sudo apt install -y build-essential pkg-config git curl libasound2-dev

# 2. Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
source "$HOME/.cargo/env"

# 3. Build (expect ~2-3 minutes on a Pi 4)
cd rust-engine
cargo build --release
```

### Run it headless as a service

Create `/etc/systemd/system/wled-video-sync.service` (adjust `User`, `WorkingDirectory`,
and `ExecStart` to match your paths):

```ini
[Unit]
Description=WLED Video Sync Headless Engine
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/WLED-Web-Video-Sync-RUST-
ExecStart=/home/pi/WLED-Web-Video-Sync-RUST-/rust-engine/target/release/wled-video-sync-rust
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wled-video-sync.service
```

Manage and inspect it:

```bash
sudo systemctl status wled-video-sync     # is it running?
journalctl -u wled-video-sync -f          # follow live logs
sudo systemctl restart wled-video-sync    # after a rebuild
```

Once running, power-cycling the Pi brings the engine back automatically with no SSH
login required.

---

## 📦 Part 4 — AppImage (Portable, No Install Required)

`packaging/appimage/build-appimage.sh` produces one self-contained executable:

```
build/appimage/WLED-Web-Video-Sync-<version>-x86_64.AppImage     # ~42 MB
```

It bundles everything it needs — the **Node.js runtime**, the production web server
(compiled to a single file, so there is no `node_modules`), and the compiled **Rust
engine**. The target machine needs no Node, no Rust, no npm, and no root.

### Build it

```bash
npm install                                     # once, for the esbuild/vite toolchain
npm run build                                   # produces dist/
( cd rust-engine && cargo build --release --features omt )   # engine, with OMT receiving
./packaging/appimage/build-appimage.sh
```

The script checks its inputs up front and tells you which one is missing. It downloads
`appimagetool` on first run and caches it in `build/appimage/`, alongside the finished
AppImage (`build/` is gitignored; the packaging sources under `packaging/` are tracked).

### Run it

```bash
chmod +x build/appimage/WLED-Web-Video-Sync-<version>-x86_64.AppImage
./build/appimage/WLED-Web-Video-Sync-<version>-x86_64.AppImage
```

It starts the web UI and the Rust engine, waits for the server to answer, then opens
your browser. **Stop it with Ctrl+C** — that shuts down both processes cleanly.

| Option | Effect |
|---|---|
| `--port N` | Web UI port (default: first free port from 3000 upwards) |
| `--no-engine` | Skip the Rust engine and run the web UI only |
| `--no-browser` | Do not open a browser |
| `--install` | Install into `~/.local` (see below) |
| `--uninstall` | Reverse a previous `--install` |
| `-V`, `--version` | Print the version |
| `--help` | Show usage |

### Stopping it

Pick whichever suits you:

- **A Quit App button in the header** — offered only when the AppImage launched the app.
  It stops the web server, which the launcher waits on, so the engine is stopped too and the
  whole app closes. (It is hidden under a plain `npm run dev`, where killing the server
  would be unhelpful.)
- **Ctrl+C in the terminal**, if you started it from one.
- **The terminal window itself**, since the application-menu entry opens one
  (`Terminal=true` in the desktop entry). Set it to `false` if you would rather it launch
  silently — but then you lose the startup messages and Ctrl+C.

The launcher prints the chosen ports and the engine log path on startup, which is why a
terminal is useful: that is where engine failures are reported.


If the default port is busy the launcher automatically takes the next free one, so
several copies can run side by side. The engine's port (`8080`) is fixed inside the
binary — if it is busy, the launcher warns and starts the UI alone rather than failing.

### Install it into your application menu

```bash
./WLED-Web-Video-Sync-<version>-x86_64.AppImage --install
```

This copies the AppImage to `~/.local/bin/`, adds a desktop launcher under
`~/.local/share/applications/`, and installs the icon. `--uninstall` reverses it, and if
`~/.local/bin` is not on your `PATH` the command prints the exact line to add.

### FUSE

AppImages normally require FUSE. If your system has no `/dev/fuse` (containers, minimal
installs), either install `libfuse2`/`fuse2`, or run it with:

```bash
APPIMAGE_EXTRACT_AND_RUN=1 ./WLED-Web-Video-Sync-<version>-x86_64.AppImage
```

> **x86_64 only.** The build script targets x86_64, matching a normal desktop. The
> Raspberry Pi is aarch64, so use Part 3 there. Building an ARM AppImage means changing
> the arch settings in the script and supplying aarch64 Node and Rust builds.

---

## 🔲 Source Region & Aspect Ratio

A video source and an LED matrix rarely share an aspect ratio — a 16:9 camera driving a
16×16 square panel, for example. Mapping the whole frame onto the matrix stretches the
image. Instead, the engine maps a **region** of the source onto the matrix:

- **Default (auto-fit).** The region is the largest *centered* crop of the source whose
  aspect ratio equals the matrix aspect ratio. A 16:9 source on a square matrix uses a
  centered square slice of the frame — full height, sides trimmed. Nothing is stretched.
- **Custom.** You can pick any region yourself. It is sent to the engine as normalized
  coordinates (`x`, `y`, `width`, `height` in `0.0`–`1.0`) over the engine WebSocket with
  `{"command":"update_region","region":{...}}`, or as `"auto_aspect": true` to hand
  control back to auto-fit.

The preview always draws the frame at the source's **true aspect ratio** and outlines the
region actually being sampled, dimming everything outside it — so what you see matches
what the LEDs receive. With custom mapping off the outline is a fixed green crop; turn on
**Custom Mapping** to drag and resize it (orange). The engine clamps any out-of-frame
values at sample time.

You can run the engine on a different API port if `8080` is taken:

```bash
ENGINE_PORT=8090 ./target/release/wled-video-sync-rust
```

The engine exits with a clear message rather than panicking if the port is unavailable.

---

## 📡 Open Media Transport (OMT) Streams

The Rust engine performs real mDNS discovery of `_omt._tcp.local` publishers and reports
what it finds to the UI, which lists them for you to choose from. There are no mock
streams: if the engine is unreachable or nothing is publishing, the UI says so.

Discovery de-duplicates a publisher that is announced on several network interfaces, and
only reports a resolution or frame rate that the sender actually advertises in its mDNS
TXT records (otherwise `unknown` / no FPS). Run the engine to see what is on your network:

```bash
curl http://localhost:8080/api/omt/sources
```

### Receiving a stream

Choosing a stream in the UI tells the engine to subscribe to it. The engine then decodes
the VMX video and feeds it into the same pixel pipeline as every other source, reporting
what it is doing through telemetry (`source_status`), which the UI shows under the stream
list:

- `connecting to omt://…` — subscribing
- `receiving <name> (1920x1080)` — frames are arriving
- `connection failed: … — fell back to the procedural generator` — the publisher was not
  reachable, so the engine restored the procedural source rather than leaving the LEDs dark

### Seeing the picture

OMT video is decoded **inside the engine**, so the browser cannot play it directly. The
engine therefore publishes a small live copy of the active frame (240 px wide, ~10 fps) over
the same WebSocket, and the UI draws it in the preview — you can confirm the stream is real
and position the crop region against actual content.

Under the stream list you get two readouts that separate the usual causes of "it shows in
the list but there is no picture":

| Readout | Meaning |
|---|---|
| `engine: receiving …` | the engine is subscribed and decoding frames |
| `video: live 240x135 — frames arriving` | decoded video is actually reaching the browser |
| `video: waiting for video from the engine…` | subscribed, but no frames have arrived yet |
| `video: stopped (last … 3s ago)` | frames stopped arriving |
| `video: no stream selected — pick one above` | nothing chosen yet |

The preview canvas shows a **NO OMT VIDEO** card until real frames arrive, rather than a mock
image, so a blank pane always means "no video", never "the placeholder is broken".

The preview is deliberately small and throttled; it is for framing and confirmation, not for
viewing the stream at full quality.

Receiving is **off by default** because it pulls in an extra crate. Enable it with:

```bash
cd rust-engine
cargo build --release --features omt
```

It uses the pure-Rust
[`openmediatransport`](https://crates.io/crates/openmediatransport) crate for the VMX
codec. That crate is very new (0.1.0), so it is pinned to an exact version. Without the
feature the engine still discovers and lists streams, and says plainly that receiving was
not compiled in rather than failing silently.

> **Not verified against a real sender.** This was developed where no working OMT
> publisher existed — the only one advertising on the local network answered mDNS but
> never accepted a TCP connection, which the engine correctly reported as a connection
> failure. Frame decode is therefore exercised only by unit tests, not against vMix, OBS
> or `omtplayer`. Treat real-world interoperability as unproven.

---

## 🔢 Versioning

The version lives in **one place**: the [`VERSION`](VERSION) file at the repository root.
Everything else is derived from it, so there is nothing to keep in sync by hand:

| Consumer | How it gets the version |
|---|---|
| `package.json` | written by `scripts/version.sh sync` |
| `rust-engine/Cargo.toml` | written by `scripts/version.sh sync` |
| Rust engine `/api/health` | `env!("CARGO_PKG_VERSION")` at compile time |
| Web UI | Vite `define` → `__APP_VERSION__`, read from `VERSION` at build time |
| AppImage filename | `WLED-Web-Video-Sync-<version>-x86_64.AppImage` |
| AppImage metadata | `X-AppImage-Version` in the desktop entry |
| `--version` on the AppImage | bundled `VERSION` file |

### Rolling a release

```bash
./scripts/version.sh              # print the current version
./scripts/version.sh bump patch   # or: minor | major
./scripts/version.sh set 2.0.0    # or set it explicitly
./scripts/version.sh check        # verify every manifest agrees (good for CI)
```

`bump` and `set` both update `VERSION` and re-sync `package.json` and
`rust-engine/Cargo.toml`. `check` exits non-zero if anything has drifted, so it is
worth running in CI. After bumping, rebuild whatever you ship — the UI and engine bake
the version in at build time:

```bash
npm run build
( cd rust-engine && cargo build --release --features omt )
./packaging/appimage/build-appimage.sh
```

---

## 🔌 Ports & Protocols Reference

| Port | Protocol | Purpose |
|---|---|---|
| `3000` | HTTP / WebSocket | Node web server and UI; browser pixel stream at `/api/video-sync` (override with `PORT`) |
| `8080` | HTTP / WebSocket | Rust engine telemetry API and `/ws` (override with `ENGINE_PORT`) |
| `4048` | UDP | DDP — native WLED protocol |
| `6454` | UDP | Art-Net 4 |
| `5568` | UDP | sACN / ANSI E1.31 |
| `21324` | UDP | WLED WARLS / DRGB legacy real-time |

Useful endpoints:

```bash
curl http://localhost:3000/api/health       # Node server health + supported protocols
curl http://localhost:8080/api/health       # Rust engine status
curl http://localhost:8080/api/omt/sources  # mDNS-discovered OMT sources (JSON array)
```

The engine has no page at its root — `/` returns `404`. Its only routes are
`/api/health`, `/api/omt/sources`, and the `/ws` WebSocket.

**Rust engine connection is localhost-only.** The web UI connects to the engine at a
hardcoded `ws://localhost:8080/ws`, so the browser must run on the *same machine* as the
engine. The browser-side UDP output path (`/api/video-sync`) is same-origin and works
from any device that can load the page.

---

## 🛠 Troubleshooting

**`cargo: command not found`** — rustup is installed but not on your `PATH`. Run
`source "$HOME/.cargo/env"`, or append that line to `~/.bashrc`.

**`error: linking with 'cc' failed`** — no C linker. Install `build-essential`
(Debian/Ubuntu) or `gcc` (Fedora/Arch).

**`failed to create directory ... ~/.cargo/registry`** — the cargo cache lives outside
the project directory. Make sure your user owns `~/.cargo`, and avoid running the build
as a different user or under a restrictive sandbox.

**Wayland capture fails / `pipewire` errors** — the `wayland-pipewire` feature is off by
default. Install the dev headers from [Part 2, step 3](#3-optional--wayland--pipewire-capture-support)
and rebuild with `--features wayland-pipewire`.

**Browser shows no pixels on the matrix** — confirm the target IP and protocol in the UI
and that the engine or Node server is actually listening (`ss -ltnp | grep -E '3000|8080'`).

**UDP micro-stutters at high FPS** — raise kernel socket buffers. The Pi script does this
automatically; on a desktop, see `/etc/sysctl.d/99-wled-video-sync.conf` in
`scripts/install_pi4.sh` for the exact values.

**Node version too old** — Vite 6 requires Node 18+. Check with `node --version`.

---

## 📁 Project Layout

```
├── server.ts                  # Express + WebSocket + UDP DMX server (port 3000)
├── src/
│   ├── App.tsx                # main UI, capture pipeline, WebSocket client
│   ├── types.ts               # shared types (OMT, NDI, matrix config)
│   ├── components/            # UI components (e.g. WLED emulator)
│   └── utils/
│       ├── omtNegotiation.ts  # OMT proxy-profile URL + bandwidth estimation
│       └── proceduralEffects.ts
├── rust-engine/               # standalone Rust engine → own README
│   ├── src/
│   │   ├── main.rs            # engine entrypoint, frame loop
│   │   ├── server.rs          # Axum telemetry API + WebSocket (port 8080)
│   │   ├── sources/           # OMT, Wayland/PipeWire, procedural generators
│   │   ├── protocols/         # DDP, Art-Net, sACN, WARLS packet builders
│   │   └── pipeline/          # Rayon parallel pixel sampler
│   └── Cargo.toml
├── scripts/install_pi4.sh     # Raspberry Pi 4 automated provisioning
├── packaging/appimage/        # AppImage packaging sources
│   ├── build-appimage.sh      #   assembles the AppDir and runs appimagetool
│   ├── AppRun                 #   launcher (ports, install/uninstall, cleanup)
│   ├── make_icon.py           #   generates the icon (stdlib only)
│   └── wled-video-sync.desktop
├── build/appimage/            # AppImage output + tool cache (gitignored)
└── dist/                      # build output (generated)
```

For engine internals and its own build notes, see
[`rust-engine/README.md`](./rust-engine/README.md).

---

## 🎯 Precise Spot Mapping

Use the **Individual Accent Lamp** module in the sidebar to sync WLED bulbs and
spotlights:

- Toggle **Precise Coordinates** to position a single target pixel or an area-average box.
- Drag the sliders to move the live target outline on the matrix preview canvas in real time.
