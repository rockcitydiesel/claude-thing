#!/usr/bin/env bash
# Download everything flash.sh needs into .tools/ (no root needed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/.tools"
IMAGE_NAME="debian_bullseye_arm64_v2.0.0-94c2e46_landscape_2025-09-29"
IMAGE_URL="https://github.com/bishopdynamics/superbird-debian-kiosk/releases/download/v2.0/$IMAGE_NAME.tar.gz"
mkdir -p "$TOOLS/image"

command -v uv >/dev/null || { echo "Needs uv (https://docs.astral.sh/uv/) to build the flashing tool's Python env."; exit 1; }

[[ -d "$TOOLS/superbird-tool" ]] || git clone -q https://github.com/bishopdynamics/superbird-tool "$TOOLS/superbird-tool"
[[ -x "$TOOLS/venv/bin/python" ]] || uv venv -q "$TOOLS/venv"
uv pip install -q --python "$TOOLS/venv/bin/python" pyusb git+https://github.com/superna9999/pyamlboot

if [[ ! -f "$TOOLS/image/$IMAGE_NAME/system_a.ext2" ]]; then
  echo "Downloading the kiosk image (~1 GB)..."
  curl -fL --progress-bar -o "$TOOLS/image/kiosk.tar.gz" "$IMAGE_URL"
  tar -xzf "$TOOLS/image/kiosk.tar.gz" -C "$TOOLS/image"
  rm "$TOOLS/image/kiosk.tar.gz"
fi
echo "Ready. Put the Car Thing in burn mode (hold buttons 1+4 while plugging in), then: sudo bash deploy/flash.sh"
