#!/usr/bin/env bash
# End-to-end test: starts a throwaway headless Chrome, loads the extension
# through the DevTools Protocol, exercises it, and tears the browser down.
# Your own Chrome profile is never touched.
#
# Requires: Google Chrome 137+, deno.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
port="${CDP_PORT:-9222}"
profile="$(mktemp -d)"
shots="$root/dist/screenshots"

[ -x "$chrome" ] || { echo "Chrome not found at: $chrome (set CHROME=)" >&2; exit 1; }
command -v deno >/dev/null || { echo "deno is required" >&2; exit 1; }

mkdir -p "$shots"

"$chrome" \
  --user-data-dir="$profile" \
  --enable-unsafe-extension-debugging \
  --remote-debugging-port="$port" \
  --no-first-run --no-default-browser-check \
  --headless=new about:blank >"$profile/chrome.log" 2>&1 &
chrome_pid=$!

cleanup() {
  kill "$chrome_pid" 2>/dev/null || true
  wait "$chrome_pid" 2>/dev/null || true
  rm -rf "$profile"
}
trap cleanup EXIT

for _ in $(seq 1 40); do
  curl -sf --max-time 1 "http://127.0.0.1:$port/json/version" >/dev/null && break
  sleep .25
done

CDP_PORT="$port" SHOT_DIR="$shots" \
  deno run --allow-net --allow-read --allow-write --allow-env --no-lock \
  "$root/tools/e2e-test.js"

echo "screenshots: $shots"
