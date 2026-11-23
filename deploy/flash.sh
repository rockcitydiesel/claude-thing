#!/usr/bin/env bash
# Flash superbird-debian-kiosk v2.0 (landscape) onto a Car Thing in USB burn mode.
# Run as root:  sudo bash deploy/flash.sh
# Prep (as your user, no root): .tools/superbird-tool, .tools/venv, .tools/image/<extracted>.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOL="$ROOT/.tools/superbird-tool/superbird_tool.py"
PY="$ROOT/.tools/venv/bin/python"
IMAGE="$(find "$ROOT/.tools/image" -mindepth 1 -maxdepth 1 -type d -name 'debian_bullseye_arm64_*landscape*' | head -1)"

[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo bash $0"; exit 1; }
[[ -x "$PY" && -f "$TOOL" ]] || { echo "Missing .tools/venv or superbird-tool; run the prep steps first."; exit 1; }
[[ -n "$IMAGE" && -f "$IMAGE/system_a.ext2" ]] || { echo "Extracted landscape image not found under .tools/image/"; exit 1; }

# superbird-tool opens images/*.bin relative to its own directory.
cd "$(dirname "$TOOL")"

# Partition erases take longer than pyusb's 1 s default read timeout (worse behind a
# USB hub), which aborts the flash with USBTimeoutError. Give erases 60 s.
if ! grep -q "CLAUDE_THING_ERASE_TIMEOUT" superbird_device.py; then
  sed -i 's/resp = self.device.bulkCmd(command)/resp = self.device.bulkCmd(command, timeout=(60000 if "erase" in command else None))  # CLAUDE_THING_ERASE_TIMEOUT/' superbird_device.py
fi
grep -q "CLAUDE_THING_ERASE_TIMEOUT" superbird_device.py || { echo "Could not apply erase-timeout patch"; exit 1; }

echo "Looking for the Car Thing (hold buttons 1+4 while plugging in, no USB hub)..."
OUT="$("$PY" "$TOOL" --find_device 2>&1 || true)"
echo "$OUT"
grep -qiE "burn mode|usb mode" <<<"$OUT" || { echo "Car Thing not found in burn/USB mode. Replug holding 1+4 and retry."; exit 1; }

echo "Flashing $IMAGE (takes several minutes; do not unplug)..."
"$PY" "$TOOL" --restore_device "$IMAGE"
echo "Done. Unplug the Car Thing, then plug it back in normally (no buttons held)."
