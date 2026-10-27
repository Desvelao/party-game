# Install the game as an app

You can add the game to a phone's home screen or to a computer's app list. It then opens in its own window with no
browser address bar, with the game's icon. It is the same game: the server still has to be running and reachable,
and nothing is available offline.

## What you need first

The browser only offers to install a page that it considers secure:

- the address must start with `https://` (or be `localhost` on the server's own computer), and
- the certificate must be **trusted by that device**. A self-signed certificate (the `TLS_SELF_SIGNED=1` option) is
  fine for trying the server, but the browser will not install from a page with a certificate warning.

On a plain `http://192.168...` address the browser only offers "Add shortcut", which is a bookmark and not an app.

So, before installing, turn on [HTTPS](https.md) with a trusted certificate: mkcert with its root certificate installed
on each phone, Let's Encrypt for a real domain, or a reverse proxy with a public certificate. Use a stable name for the
server (for example `party.local`): the installed app remembers the address, and it stops working if the address changes.

## Which browsers can install

| Browser | Can install? | How |
|---|---|---|
| Chrome, Chromium, Edge on a computer | yes | install icon in the address bar, or the **Install app** button in the main menu |
| Chrome on Android | yes | **Install app** button, or the browser menu, then **Install app** |
| Safari on iPhone and iPad | yes | **Share**, then **Add to Home Screen** |
| Firefox on Android | yes | browser menu, then **Install** |
| Firefox on a computer | no | Firefox for Linux and macOS cannot install web apps (and Windows only pins a tab); use Chrome, Chromium or Edge, or pin the tab |

The **Install app** button only appears when your browser offers the install, so you will not see it in Firefox on a computer.

## Install

**Android (Chrome) and computers (Chrome, Edge):**

1. Open the game's `https://` address.
2. Tap **Install app** in the main menu, or use the browser's own install button (an icon in the address bar on a computer,
   **Install app** in the Chrome menu on a phone).
3. Confirm. The game appears on the home screen or in the app list.

**iPhone and iPad (Safari):**

1. Open the game's `https://` address in Safari.
2. Tap **Share**, then **Add to Home Screen**.
3. The main menu shows this reminder in place of an install button.

An app added on iOS has its own storage, separate from Safari: it does not see the profile saved in the browser. Move
your profile with the transfer code (**Profile**, then **Show QR / transfer code**, when your server offers it) or your recovery link.

## Good to know

- The name under the icon is the server's name (`branding.name`, see [Configuration](configuration.md)). If the
  operator renames the game, installed apps pick up the new name after the browser refreshes the app's details.
- Invite links and QR codes usually open in the browser, not in the installed app. The game works the same there.
- In the installed window there is no address bar or back button. The top bar (**Play**, **Rooms**, **Status**,
  **Top**, **Profile**) takes you between pages. The admin page (**Admin** at the bottom of the main menu) has no bar:
  operators are better off using a normal browser tab for it.
- The game never caches its screens. After a server update the app loads the new version the next time it opens.
- If the server is down when you open the app, you see "Server not reachable" with **Try again**.

## If something is wrong

| Problem | Cause | Fix |
|---|---|---|
| No **Install app** button and the browser offers only "Add shortcut" | the page is `http://`, or the certificate is not trusted | use [HTTPS](https.md) with a trusted certificate |
| Firefox on a computer shows no install icon and no button | Firefox on a computer cannot install web apps | use Chrome, Chromium or Edge, or pin the tab |
| The button disappeared | the app is already installed on this device, or you dismissed the browser's offer | open the installed app; clear the site's data to see the offer again |
| The installed app shows an old name or icon | the browser has not refreshed the app's details yet | wait a day, or uninstall and install again |
| The installed app says "Server not reachable" | the server is off, or its address changed | start the server; if the address changed, install again from the new address |
