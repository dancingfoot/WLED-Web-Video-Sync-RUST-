#!/usr/bin/env bash
# ==============================================================================
# Version management — one source of truth: the VERSION file at the repo root.
# ==============================================================================
# Propagates that version into every place that needs it and can check that they
# all still agree (useful in CI).
#
# Usage:
#   scripts/version.sh                 Print the current version
#   scripts/version.sh check           Verify every manifest matches VERSION
#   scripts/version.sh sync            Write VERSION into package.json + Cargo.toml
#   scripts/version.sh set 1.2.3       Set an explicit version, then sync
#   scripts/version.sh bump patch      Bump major | minor | patch, then sync
#
# The Rust engine and the web UI read the version from their own manifests at
# build time (Cargo's CARGO_PKG_VERSION and a Vite define), so `sync` is the only
# step needed to roll a release.
# ==============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$REPO/VERSION"
PKG_JSON="$REPO/package.json"
LOCK_JSON="$REPO/package-lock.json"
CARGO_TOML="$REPO/rust-engine/Cargo.toml"

C_R=$'\033[0;31m'; C_G=$'\033[0;32m'; C_0=$'\033[0m'
err() { printf '%s[ERROR]%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }
ok()  { printf '%s[OK]%s %s\n' "$C_G" "$C_0" "$*"; }

require_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || err "'$1' is not a MAJOR.MINOR.PATCH version"
}

read_version() {
  [ -f "$VERSION_FILE" ] || err "VERSION file missing at $VERSION_FILE"
  tr -d '[:space:]' < "$VERSION_FILE"
}

# Read the version currently declared in a manifest (empty if absent).
pkg_version()  { node -p "require('$PKG_JSON').version || ''" 2>/dev/null || true; }
lock_version() { node -p "require('$LOCK_JSON').version || ''" 2>/dev/null || true; }
cargo_version() {
  # Only the version inside [package] — Cargo.toml has many `version =` lines.
  awk '
    /^\[package\]/ { p = 1; next }
    /^\[/          { p = 0 }
    p && /^version *=/ { match($0, /"[^"]*"/); print substr($0, RSTART + 1, RLENGTH - 2); exit }
  ' "$CARGO_TOML"
}

cmd_sync() {
  local v; v="$(read_version)"
  require_semver "$v"

  # package.json — via node so the JSON stays valid regardless of formatting.
  V="$v" node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
    pkg.version = process.env.V;
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  ' "$PKG_JSON"

  # package-lock.json — npm tolerates a stale root version, but leaving one
  # behind is confusing when reading the lockfile.
  if [ -f "$LOCK_JSON" ]; then
    V="$v" node -e '
      const fs = require("fs");
      const path = process.argv[1];
      const lock = JSON.parse(fs.readFileSync(path, "utf8"));
      lock.version = process.env.V;
      if (lock.packages && lock.packages[""]) lock.packages[""].version = process.env.V;
      fs.writeFileSync(path, JSON.stringify(lock, null, 2) + "\n");
    ' "$LOCK_JSON"
  fi

  # Cargo.toml — only the version inside [package], never a dependency's.
  V="$v" awk -v ver="$v" '
    /^\[package\]/ { in_pkg = 1; print; next }
    /^\[/          { in_pkg = 0 }
    in_pkg && !done && /^version *=/ { print "version = \"" ver "\""; done = 1; next }
    { print }
  ' "$CARGO_TOML" > "$CARGO_TOML.tmp" && mv "$CARGO_TOML.tmp" "$CARGO_TOML"

  ok "Synced version $v -> package.json, package-lock.json, rust-engine/Cargo.toml"
}

cmd_check() {
  local v; v="$(read_version)"
  require_semver "$v"
  local failures=0

  local p; p="$(pkg_version)"
  if [ "$p" = "$v" ]; then ok "package.json          $p"
  else printf '%s[FAIL]%s package.json          %s (expected %s)\n' "$C_R" "$C_0" "$p" "$v"; failures=$((failures+1)); fi

  local l; l="$(lock_version)"
  if [ "$l" = "$v" ]; then ok "package-lock.json     $l"
  else printf '%s[FAIL]%s package-lock.json     %s (expected %s)\n' "$C_R" "$C_0" "$l" "$v"; failures=$((failures+1)); fi

  local c; c="$(cargo_version)"
  if [ "$c" = "$v" ]; then ok "rust-engine/Cargo.toml $c"
  else printf '%s[FAIL]%s rust-engine/Cargo.toml %s (expected %s)\n' "$C_R" "$C_0" "$c" "$v"; failures=$((failures+1)); fi

  [ "$failures" -eq 0 ] || err "$failures manifest(s) out of sync — run: scripts/version.sh sync"
  ok "All manifests at $v"
}

cmd_set() {
  [ $# -eq 1 ] || err "usage: scripts/version.sh set X.Y.Z"
  require_semver "$1"
  printf '%s\n' "$1" > "$VERSION_FILE"
  ok "VERSION set to $1"
  cmd_sync
}

cmd_bump() {
  [ $# -eq 1 ] || err "usage: scripts/version.sh bump major|minor|patch"
  local cur; cur="$(read_version)"; require_semver "$cur"
  IFS=. read -r major minor patch <<< "$cur"
  case "$1" in
    major) major=$((major+1)); minor=0; patch=0 ;;
    minor) minor=$((minor+1)); patch=0 ;;
    patch) patch=$((patch+1)) ;;
    *) err "unknown bump target '$1' (use major, minor or patch)" ;;
  esac
  cmd_set "$major.$minor.$patch"
}

case "${1:-show}" in
  show)  read_version ;;
  check) cmd_check ;;
  sync)  cmd_sync ;;
  set)   shift; cmd_set "$@" ;;
  bump)  shift; cmd_bump "$@" ;;
  *)     err "unknown command '${1}' — use show, check, sync, set or bump" ;;
esac
