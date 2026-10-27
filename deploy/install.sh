#!/bin/sh
# Turns a Debian/Raspberry Pi OS machine that already has the party-game package installed into a party box:
# own Wi-Fi (hostapd + dnsmasq), the name partygame.local (avahi), the game on port 80 and the captive-portal redirect.
# Run as root: sudo sh deploy/install.sh [--kiosk]   (see docs/party-box.md)
#   --kiosk  also make this machine the TV: console mode (a phone is the host) and a full-screen browser at boot
set -eu

extra_units=

kiosk=0
for arg in "$@"; do
  case "$arg" in
    --kiosk) kiosk=1 ;;
    *) echo "unknown option $arg" >&2; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)
[ -x /usr/bin/party-game-server ] || { echo "install the party-game package first (docs/manual/installation.md)" >&2; exit 1; }

apt-get install -y hostapd dnsmasq avahi-daemon

hostnamectl set-hostname partygame

# the Wi-Fi interface gets a fixed address, and its network manager must leave it alone
if [ -f /etc/dhcpcd.conf ] && ! systemctl is-active --quiet NetworkManager; then
  # Raspberry Pi OS Bullseye and older: dhcpcd
  if ! grep -q '^# party-box' /etc/dhcpcd.conf; then
    printf '\n# party-box\ninterface wlan0\n    static ip_address=192.168.4.1/24\n    nohook wpa_supplicant\n' >> /etc/dhcpcd.conf
  fi
elif systemctl is-active --quiet NetworkManager; then
  # Raspberry Pi OS Bookworm and newer, Ubuntu desktop: NetworkManager. It must not manage wlan0 (hostapd owns it);
  # a small service gives it the fixed address once hostapd has brought it up.
  mkdir -p /etc/NetworkManager/conf.d
  printf '[keyfile]\nunmanaged-devices=interface-name:wlan0\n' > /etc/NetworkManager/conf.d/party-box.conf
  cat > /etc/systemd/system/party-box-wlan0.service <<'UNIT'
[Unit]
Description=Party box Wi-Fi address
After=hostapd.service
Before=dnsmasq.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/env ip link set wlan0 up
ExecStart=/usr/bin/env ip addr replace 192.168.4.1/24 dev wlan0

[Install]
WantedBy=multi-user.target
UNIT
  systemctl reload NetworkManager || true
  extra_units=party-box-wlan0
else
  echo "no dhcpcd or NetworkManager found: set wlan0 to 192.168.4.1/24 yourself, then run this script again (see docs/party-box.md)" >&2
  exit 1
fi

# copy a config the operator may edit (SSID, password, country...) only when it is not there yet
install_once() {
  if [ -e "$2" ]; then echo "keeping your $2"; else install -m 644 "$1" "$2"; fi
}
install_once "$here/hostapd.conf" /etc/hostapd/hostapd.conf
install_once "$here/dnsmasq.conf" /etc/dnsmasq.d/party-box.conf
install_once "$here/avahi-partygame.service" /etc/avahi/services/partygame.service
install -m 644 "$here/party-box.service" /etc/systemd/system/party-game.service

# keep operator settings that are already there
touch /etc/default/party-game
for kv in PORT=80 PUBLIC_URL=http://partygame.local CAPTIVE_PORTAL=1; do
  key=${kv%%=*}
  grep -q "^$key=" /etc/default/party-game || echo "$kv" >> /etc/default/party-game
done

if [ "$kiosk" -eq 1 ]; then
  apt-get install -y cage chromium curl
  id party-kiosk >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/party-kiosk --shell /usr/sbin/nologin --groups video,render,input,audio party-kiosk
  grep -q '^CONSOLE_MODE=' /etc/default/party-game || echo "CONSOLE_MODE=1" >> /etc/default/party-game
  install -m 644 "$here/party-kiosk.service" /etc/systemd/system/party-kiosk.service
  systemctl set-default graphical.target
fi

sed -i 's|^#\?DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd
rfkill unblock wlan || true

systemctl daemon-reload
systemctl unmask hostapd
# shellcheck disable=SC2086
systemctl enable hostapd dnsmasq avahi-daemon party-game $extra_units
[ "$kiosk" -eq 1 ] && systemctl enable party-kiosk
if [ "$kiosk" -eq 1 ]; then
  echo "Done. Reboot: the TV shows the game. On your phone join the Wi-Fi 'BonkArena', open http://partygame.local/console and type the PIN on the TV."
else
  echo "Done. Reboot, join the Wi-Fi 'BonkArena' and open http://partygame.local"
fi
