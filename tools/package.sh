#!/usr/bin/env bash
# Build the Chrome Web Store upload zip containing only shipped files.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

version="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
out="dist/warp-checker-${version}.zip"

mkdir -p dist
rm -f "$out"

zip -q -r "$out" \
  manifest.json \
  background.js \
  content.js \
  managed-schema.json \
  popup.html \
  popup.js \
  icons \
  -x '.*' -x '__MACOSX/*'

echo "Built $out"
unzip -l "$out"
