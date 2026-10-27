# Party box

A party box is a small computer (a Raspberry Pi 3 or newer, or a mini PC with Wi-Fi) that you plug in at a party. It makes
its own Wi-Fi network, starts the game by itself and sends every phone that joins straight to it. No home internet is needed.

## What you get

1. **Autostart**: the game starts when the box gets power.
2. **Its own Wi-Fi** (`BonkArena`): made by `hostapd`; `dnsmasq` gives phones an address.
3. **A friendly name**: `http://partygame.local`, announced with mDNS by `avahi`.
4. **Captive portal**: when a phone joins the Wi-Fi, it is sent to the game on its own.
5. **QR code**: the watch screen shows the room's QR code; phones scan it and join.

## Supported systems

The installer works on Debian-based systems (Raspberry Pi OS, Debian, Ubuntu) that manage the network with `dhcpcd`
(Raspberry Pi OS Bullseye and older) or with NetworkManager (Raspberry Pi OS Bookworm and newer, Ubuntu desktop).
With NetworkManager it stops managing `wlan0` and adds a small service that gives the Wi-Fi card its address. On a
system with neither (for example Ubuntu Server with netplan), the installer stops and tells you to give `wlan0` the
address `192.168.4.1/24` yourself, then run it again.

## Install

1. Install the Linux package of the game ([Installation](manual/installation.md)).
2. Copy the `deploy/` folder of this repository to the box.
3. Run `sudo sh deploy/install.sh`. It installs `hostapd`, `dnsmasq` and `avahi-daemon`, names the machine `partygame`,
   gives the Wi-Fi card the address `192.168.4.1`, and sets `PORT=80`, `PUBLIC_URL=http://partygame.local` and
   `CAPTIVE_PORTAL=1` in `/etc/default/party-game`. Settings and files you already have are kept: running the script
   again does not reset the Wi-Fi name, country or password in `hostapd.conf`, nor `dnsmasq.conf`. To get the original
   file back, delete it (`/etc/hostapd/hostapd.conf`, `/etc/dnsmasq.d/party-box.conf`) and run the script again.
4. Reboot.

To change the Wi-Fi name, channel or country, edit `/etc/hostapd/hostapd.conf` and run `sudo systemctl restart hostapd`.
To put a password on it, add `wpa=2`, `wpa_passphrase=your-password` and `wpa_key_mgmt=WPA-PSK` to that file.

## Play

1. On the TV or laptop, join the Wi-Fi `BonkArena` and open `http://partygame.local`. Create a room and open its watch link.
2. The lobby shows a QR code. Phones join the same Wi-Fi, scan it, and are in the room.
3. A phone that opens any web page after joining the Wi-Fi is sent to the game by the captive portal.

## Use it like a game console (Raspberry Pi + TV)

With console mode the box behaves like a console: plug the Pi into the TV and power it on. Nobody needs a keyboard.
The phone is the controller, the host and the admin.

1. Run `sudo sh deploy/install.sh --kiosk` instead of the plain install in step 3 above. It also installs `cage` and `chromium`,
   sets `CONSOLE_MODE=1`, and starts a full-screen browser on the TV at boot.
2. Reboot. The TV opens a room by itself and shows the room code, a QR code and a PIN.
3. Wait until the TV shows the code and PIN (pairing only works while the TV page is open). On your phone join the Wi-Fi `BonkArena` and open `http://partygame.local/console` (it is also in the hint at the bottom of the TV).
4. Type the PIN shown on the TV and choose **Pair**.
5. Choose **Control the room**. You are the host without taking a seat: pick the game, change the options and choose **Start**.
   Choose **Play too** if you also want to play.
6. Friends scan the QR code on the TV and join as players. They never see the host controls.
7. Choose **Admin** on the console page to open the admin page on your phone, already signed in.

Good to know:
- The host phone can send everyone back to the lobby at any time from the menu (**Everyone back to the lobby**); the TV follows.
- The PIN stays the same until the server restarts, or until you choose **New PIN** or **Unpair all phones** in the **Console**
  tab of the admin page (or run `npm run admin -- console new-pin` / `console unpair`). A new PIN does not disconnect phones that
  are already paired; unpairing does.
- Anyone who knows the PIN becomes host and admin, so share it only with people you trust. The PIN is only shown on the TV.
- Only the machine itself (the TV browser on `localhost`) can open the TV room. A laptop on the Wi-Fi cannot take it over. (To test away from the TV, set `CONSOLE_SCREEN_ANY=1`; do not leave it on at a party.)
- If the TV's browser reloads, it comes back to the same room. If the room closes, it opens a new one.
- The TV needs HDMI audio set as the Pi's output (use `raspi-config`, **System Options**, **Audio**).
- Without `--kiosk` you can still turn console mode on by hand: set `CONSOLE_MODE=1` and open `http://localhost/tv` on the TV.

## The files in `deploy/`

| File | What it is |
|---|---|
| `party-box.service` | systemd unit; can use port 80 without root |
| `party-kiosk.service` | full-screen browser on the TV (`cage` + `chromium`); installed by `--kiosk` |
| `install.sh` | does the steps above |
| `hostapd.conf` | the Wi-Fi network |
| `dnsmasq.conf` | addresses for phones; every name points at the box |
| `avahi-partygame.service` | announces `partygame.local` |

## The server side

- `/tv` (console mode) is the TV page; `/console` is the phone page that pairs with the PIN.
- `GET /qr/<ROOM>` returns the room's join link as a QR image (SVG). The link uses `server.publicUrl`, or the address the
  request came in on.
- `server.captivePortal` answers the connectivity checks phones and laptops make (`/generate_204`, `/hotspot-detect.html`,
  `/connecttest.txt`, `/ncsi.txt`) and redirects other host names to the game.

See the settings in [Configuration](manual/configuration.md).

## Problems

- **The phone does not open the game by itself.** Open any `http://` page (not `https://`); a captive portal cannot
  redirect secure pages. Turn off mobile data.
- **`partygame.local` does not open on Android.** Older Android versions do not understand `.local`; open `http://192.168.4.1`.
- **The TV says "Console mode is off".** Set `CONSOLE_MODE=1` (`--kiosk` does this) and restart the server; the TV retries by itself.
- **HTTPS.** Do not set `TLS_CERT`/`TLS_KEY` on a party box: the redirect needs plain HTTP ([HTTPS](manual/https.md)).
- **The Wi-Fi does not start.** Check `systemctl status hostapd` and that `country_code` in `hostapd.conf` is yours.
