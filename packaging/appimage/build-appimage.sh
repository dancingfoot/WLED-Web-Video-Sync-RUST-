#!/usr/bin/env bash
# ==============================================================================
# Build the WLED Web Video Sync AppImage
# ==============================================================================
# Produces a self-contained x86_64 AppImage bundling:
#   - the Node.js runtime (no system Node required)
#   - the production web server, bundled to a single file (no node_modules)
#   - the compiled Rust DMX engine
#
# Requirements: bash, curl OR a cached appimagetool, python3 (icon), and a
# previously built dist/ and rust-engine release binary.
#
# Usage:  ./build/appimage/build-appimage.sh
# ==============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$REPO/packaging/appimage"     # tracked packaging sources
OUTDIR="$REPO/build/appimage"       # generated artifacts (gitignored)
WORK="$OUTDIR/work"
APPDIR="$WORK/WLED-Video-Sync.AppDir"
APP_NAME="wled-video-sync"
ARCH="x86_64"

# Version comes from the single source of truth at the repo root.
VERSION="$(tr -d '[:space:]' < "$REPO/VERSION")"
[ -n "$VERSION" ] || { echo "VERSION file is empty" >&2; exit 1; }
OUT="$OUTDIR/WLED-Web-Video-Sync-$VERSION-$ARCH.AppImage"

mkdir -p "$OUTDIR"

C_G=$'\033[0;32m'; C_C=$'\033[0;36m'; C_Y=$'\033[1;33m'; C_0=$'\033[0m'
step() { printf '%s==>%s %s\n' "$C_C" "$C_0" "$*"; }
ok()   { printf '%s[OK]%s %s\n' "$C_G" "$C_0" "$*"; }

# ------------------------------------------------------------------ preflight -
step "Checking inputs"
[ -f "$REPO/dist/index.html" ] || {
  echo "dist/index.html missing — run 'npm run build' first." >&2; exit 1; }
ENGINE="$REPO/rust-engine/target/release/wled-video-sync-rust"
[ -x "$ENGINE" ] || {
  echo "Rust engine not built — run 'cargo build --release --features omt' in rust-engine/ first." >&2; exit 1; }
NODE_REAL="$(command -v node || true)"
[ -n "$NODE_REAL" ] || { echo "node not found on PATH." >&2; exit 1; }
ok "dist/, Rust engine, and node ($NODE_REAL) all present"

# ----------------------------------------------------------------- assemble ---
step "Assembling AppDir"
rm -rf "$WORK"
mkdir -p "$APPDIR/usr/bin" \
         "$APPDIR/usr/share/$APP_NAME" \
         "$APPDIR/usr/share/icons/hicolor/256x256/apps" \
         "$APPDIR/usr/share/applications"

# Bundled Node runtime
cp "$(readlink -f "$NODE_REAL")" "$APPDIR/usr/bin/node"
chmod +x "$APPDIR/usr/bin/node"

# Rust engine
cp "$ENGINE" "$APPDIR/usr/bin/wled-video-sync-rust"
chmod +x "$APPDIR/usr/bin/wled-video-sync-rust"

# Web server: a single self-contained file, colocated with the built UI so the
# production server resolves its static assets relative to itself.
step "Bundling web server (express + ws, vite kept external)"
( cd "$REPO" && npx esbuild server.ts --bundle --platform=node --format=cjs \
    --external:vite --outfile="$APPDIR/usr/share/$APP_NAME/server.cjs" >/dev/null )
cp "$REPO/dist/index.html" "$APPDIR/usr/share/$APP_NAME/"
cp -r "$REPO/dist/assets" "$APPDIR/usr/share/$APP_NAME/"

# Icon
if [ ! -f "$HERE/$APP_NAME.png" ]; then
  ( cd "$HERE" && python3 make_icon.py >/dev/null )
fi
cp "$HERE/$APP_NAME.png" "$APPDIR/$APP_NAME.png"
cp "$HERE/$APP_NAME.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/$APP_NAME.png"

# Launcher + desktop entry
install -m 755 "$HERE/AppRun" "$APPDIR/AppRun"
install -m 644 "$HERE/$APP_NAME.desktop" "$APPDIR/$APP_NAME.desktop"

# Stamp the version for the launcher (--version) and for appimagetool, which
# records X-AppImage-Version as the AppImage's own version metadata.
printf '%s\n' "$VERSION" > "$APPDIR/usr/share/$APP_NAME/VERSION"
{
  echo "X-AppImage-Version=$VERSION"
} >> "$APPDIR/$APP_NAME.desktop"
install -m 644 "$APPDIR/$APP_NAME.desktop" "$APPDIR/usr/share/applications/$APP_NAME.desktop"
ok "AppDir assembled at $APPDIR (version $VERSION)"

# ------------------------------------------------------------- appimagetool ---
TOOL="$OUTDIR/appimagetool-$ARCH.AppImage"
if [ ! -x "$TOOL" ]; then
  step "Downloading appimagetool"
  curl -fsSL -o "$TOOL" \
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-$ARCH.AppImage"
  chmod +x "$TOOL"
fi
ok "appimagetool ready"

# ------------------------------------------------------------------- build ----
step "Building AppImage"
# --no-appstream: no AppStream metadata is shipped, and the check needs network.
ARCH="$ARCH" APPIMAGE_EXTRACT_AND_RUN=1 \
  "$TOOL" --no-appstream "$APPDIR" "$OUT"
ok "AppImage: $OUT"

ls -la "$OUT"
