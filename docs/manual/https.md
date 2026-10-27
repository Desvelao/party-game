# HTTPS

By default the server speaks plain HTTP. Turn on HTTPS when you want the page and the connection between the
phones and the server to be encrypted, for example on the internet or when a browser asks for a secure connection.
The game and its WebSocket use the same port, so once HTTPS is on, everyone opens `https://<server-address>:8080/`.

HTTPS is off until you set a certificate **and** its key. Setting only one stops the server at start-up with a message.

Serving over HTTPS with a certificate your devices trust is also what lets people [install the game as an app](install-app.md).

## Turn it on

| File key | Environment variable | What it is |
|---|---|---|
| `server.tlsCert` | `TLS_CERT` | path of the certificate file (PEM) |
| `server.tlsKey` | `TLS_KEY` | path of the private key file (PEM) that goes with it |

1. Get a certificate and key (see the three ways below).
2. Set both, in `config.yaml`:

   ```yaml
   server:
     tlsCert: /etc/party-game/cert.pem
     tlsKey: /etc/party-game/key.pem
   ```

   or with the environment variables `TLS_CERT` and `TLS_KEY`.
3. Check the file with `npm run config:check -- -c config.yaml`: it names a missing or unreadable file.
4. Restart the server. The start-up log says `listening on https://...`.

## Get a certificate

### On your home network: mkcert

[mkcert](https://github.com/FiloSottile/mkcert) makes certificates that your own devices trust.

1. Install mkcert on the computer that runs the server, then run `mkcert -install` once.
2. Create the files for the server's name and address, for example
   `mkcert -cert-file cert.pem -key-file key.pem 192.168.1.20 party.local localhost`.
3. Point `server.tlsCert` and `server.tlsKey` at `cert.pem` and `key.pem`.
4. To avoid the warning on a phone, copy mkcert's root certificate (the `rootCA.pem` in the folder shown by
   `mkcert -CAROOT`) to the phone and install it as a trusted certificate authority.

### A self-signed certificate

Quick and free, but browsers show a warning that you have to accept on every device.

```
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=party.local" \
  -addext "subjectAltName=DNS:party.local,IP:192.168.1.20" -keyout key.pem -out cert.pem
```

Replace the name and the address with yours, then set `server.tlsCert` and `server.tlsKey` to the two files. On the
warning page of the browser, choose to continue (the exact words depend on the browser).

### On the internet: Let's Encrypt

Let's Encrypt gives free certificates that every browser trusts, for a name that points at your server.

1. Get a certificate with [certbot](https://certbot.eff.org/) (or another ACME client) for your domain.
2. Point `server.tlsCert` at `fullchain.pem` and `server.tlsKey` at `privkey.pem` (certbot keeps them under
   `/etc/letsencrypt/live/<your-domain>/`; the user that runs the game must be able to read them).
3. Certificates last 90 days. Renew them with certbot and restart the server afterwards, because the files are read
   only at start-up.

If you already run a reverse proxy such as nginx or Caddy, you can instead let it handle HTTPS and keep the game on
plain HTTP behind it, see [Deployment](deployment.md#behind-a-reverse-proxy).

## With Docker

The compose files keep certificates in a volume called `party-game-certs` (inside the container: `/app/certs`).

**Self-signed, nothing to prepare.** Start with the variable set and the container makes a certificate the first time:

```
TLS_SELF_SIGNED=1 docker compose -f docker-compose.prod.yml up -d
```

Put it in the `.env` file next to the compose file to keep it on. The certificate is stored in the volume and reused
when the container restarts. It is valid for `localhost`; to add the name or address players use, set
`TLS_HOSTNAME` (for example `party.local`) and, for more, `TLS_ALT_NAMES` (a comma separated list such as
`192.168.1.20,party.local`). To make a new certificate, remove the volume
(`docker volume rm <project>_party-game-certs` after `docker compose down`).

**Your own files.**

1. Put `cert.pem` and `key.pem` in a folder next to the compose file, for example `certs/`.
2. In the compose file, replace the line `- party-game-certs:/app/certs` with `- ./certs:/app/certs:ro`.
3. Set `TLS_CERT=/app/certs/cert.pem` and `TLS_KEY=/app/certs/key.pem` in the `.env` file.
4. Run `docker compose -f docker-compose.prod.yml up -d`.

For the development setup (`docker-compose.yml`), run
`TLS_SELF_SIGNED=1 SERVER_TARGET=https://server:8080 docker compose up --build`. You still open
`http://localhost:5173`; the development page talks to the server over HTTPS behind the scenes.

The container's health check works with or without HTTPS, and accepts a self-signed certificate.

## Command-line tools

`npm run admin`, `npm run loadtest` and the other tools take the address as a URL, so use `https://` or `wss://`.
With a self-signed certificate they refuse it unless you give them the certificate:
`NODE_EXTRA_CA_CERTS=cert.pem npm run admin -- --url https://localhost:8080 ...`.

## If something is wrong

| Problem | Cause | Fix |
|---|---|---|
| Server stops at start-up: "TLS needs both ..." | only one of the two settings is set | set both or neither |
| Server stops: "cannot read the TLS certificate file ..." | wrong path, or the file is not readable by the user running the game | check the path and permissions; in Docker the path is inside the container |
| The browser warns about the certificate | self-signed or from an unknown authority | accept it once per device, or use mkcert (and install its root certificate) or Let's Encrypt |
| The page loads but the game never connects | the page is HTTPS but something in front forwards plain HTTP, or the proxy does not forward WebSocket upgrades | see [Deployment](deployment.md#behind-a-reverse-proxy) |
| `http://` no longer answers | HTTPS replaces HTTP on the same port | use `https://` |
