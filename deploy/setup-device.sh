#!/usr/bin/env bash
# Configure a freshly flashed Car Thing: SSH key login, kiosk URL, button forwarder.
# Run as your user with the Car Thing plugged in normally (after flash.sh) and the
# laptop side of the USB network up (ping 192.168.7.2 works).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV="superbird@192.168.7.2"
KEY="$HOME/.ssh/carthing_ed25519"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o LogLevel=ERROR -o StrictHostKeyChecking=accept-new "$DEV")

ping -c1 -W2 192.168.7.2 >/dev/null || { echo "Can't reach the Car Thing at 192.168.7.2 (see README: USB network)."; exit 1; }

[[ -f "$KEY" ]] || ssh-keygen -q -t ed25519 -N '' -C carthing -f "$KEY"
if ! "${SSH[@]}" true 2>/dev/null; then
  echo "Installing SSH key (uses the image's default password 'superbird')..."
  ASKPASS="$(mktemp)"; trap 'rm -f "$ASKPASS"' EXIT
  printf '#!/bin/sh\necho superbird\n' > "$ASKPASS"; chmod 700 "$ASKPASS"
  SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}" setsid -w \
    ssh-copy-id -i "$KEY.pub" -o StrictHostKeyChecking=accept-new "$DEV" </dev/null >/dev/null 2>&1
fi

scp -q -i "$KEY" -o LogLevel=ERROR "$ROOT/device/claude-buttons.py" "$ROOT/device/claude-buttons.service" "$ROOT/device/boot.html" "$DEV:/tmp/"
"${SSH[@]}" 'set -e
sudo install -m 755 /tmp/claude-buttons.py /opt/claude-buttons.py
sudo install -m 644 /tmp/claude-buttons.service /etc/systemd/system/claude-buttons.service
sudo install -m 644 /tmp/boot.html /opt/claude-thing-boot.html
sudo cp -n /etc/kiosk/config.json /etc/kiosk/config.json.orig
sudo python3 - <<PY
import json
p = "/etc/kiosk/config.json"; c = json.load(open(p))
c.update(url="file:///opt/claude-thing-boot.html", screen_sleep_allow=False, ha_server="", ha_token="",
         room_light="", esc_scene="", room_scene_1="", room_scene_2="", room_scene_3="", room_scene_4="", room_scene_5="")
json.dump(c, open(p, "w"))
PY
# The image mounts /run so systemd sees 0 bytes free and refuses daemon-reload;
# enabling without a reload and starting by name still works.
sudo systemctl enable --no-reload claude-buttons >/dev/null 2>&1
sudo systemctl restart claude-buttons 2>&1 | grep -v "changed on disk" || true
sudo systemctl restart kiosk'
echo "Car Thing configured. It shows 'Waiting for the laptop' until the server answers on 192.168.7.1:7777."
echo "Tip: change the device password with: ssh -i $KEY $DEV passwd"
