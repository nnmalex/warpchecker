#!/usr/bin/env bash
# Live test against the real WARP tunnel. Needs the Cloudflare WARP app and
# warp-cli, and it WILL disconnect your tunnel for roughly two minutes before
# reconnecting it. For the portable suite that touches nothing, use test.sh.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
port="${CDP_PORT:-9222}"
profile="$(mktemp -d)"

command -v warp-cli >/dev/null || { echo "warp-cli not found" >&2; exit 1; }
command -v deno >/dev/null || { echo "deno is required" >&2; exit 1; }
[ -x "$chrome" ] || { echo "Chrome not found at: $chrome (set CHROME=)" >&2; exit 1; }

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

CDP_PORT="$port" deno run \
  --allow-net --allow-read --allow-env --allow-run=warp-cli --no-lock \
  "$root/tools/e2e-live.js"
