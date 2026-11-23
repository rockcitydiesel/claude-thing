#!/usr/bin/env bash
# Install the dashboard server as a systemd user service that starts at boot.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(readlink -f "$(command -v node)")" || { echo "Node.js 22+ is required."; exit 1; }
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
(( MAJOR >= 22 )) || { echo "Node.js 22+ is required (found $("$NODE" -v))."; exit 1; }

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
rm -f "$UNIT_DIR/claude-thing.service"   # may be a symlink from an older install
sed -e "s#@NODE@#$NODE#" -e "s#@ROOT@#$ROOT#" "$ROOT/deploy/claude-thing.service.in" > "$UNIT_DIR/claude-thing.service"
systemctl --user daemon-reload
systemctl --user enable --now claude-thing
echo "Server running: http://127.0.0.1:7777/  (demo data: http://127.0.0.1:7777/?fixture=demo)"

if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]]; then
  echo
  echo "To start the server at boot (before you log in), run once:"
  echo "  sudo loginctl enable-linger $USER"
fi

echo
echo "Then, with root, give the laptop its address on the Car Thing's USB network:"
if systemctl is-active -q systemd-networkd; then
  echo "  sudo cp $ROOT/deploy/10-carthing.network /etc/systemd/network/ && sudo networkctl reload"
else
  echo "  (systemd-networkd isn't running) give the rndis_host USB interface the static address 192.168.7.1/24"
  echo "  e.g. NetworkManager: nmcli con add type ethernet ifname <iface> ipv4.method manual ipv4.addresses 192.168.7.1/24"
fi
if systemctl is-active -q ufw 2>/dev/null; then
  echo "  sudo ufw allow proto tcp from 192.168.7.2 to 192.168.7.1 port 7777 comment claude-thing"
else
  echo "  If you run a firewall, allow TCP from 192.168.7.2 to 192.168.7.1 port 7777."
fi
