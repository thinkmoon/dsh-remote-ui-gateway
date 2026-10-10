# dsh-remote-ui-gateway

[![npm version](https://badge.fury.io/js/dsh-remote-ui-gateway.svg)](https://www.npmjs.com/package/dsh-remote-ui-gateway)

[English](README.md) | [中文](README.zh.md)

Remote access to the [DSH](https://www.npmjs.com/package/@deepseek-ai/dsh) Web GUI, as a plugin that starts with `dsh web`. DSH stays on loopback. The gateway is the only process on the network, and DSH 0.2 admits the session through its own `trustedHosts` fence.

```sh
dsh plugin --profile web add dsh-remote-ui-gateway   # or link:<local checkout>
dsh web                                     # gateway listens on 0.0.0.0:8642
```

## What makes it different

**The gateway authenticates on its own, in front of DSH.** Remote traffic hits a login page or `Authorization: Bearer` first. A pass issues a gateway session: scrypt derives the key, HMAC-SHA256 signs an expiring `HttpOnly; SameSite=Lax` cookie (default 7 days). That cookie is never forwarded upstream, and WebSocket upgrades face the same gate. Changing the gateway password drops gateway sessions only; DSH credentials stay put. Logins are limited per IP (10 attempts / 10 minutes), and the password compare is timing-safe.

**One login covers the whole GUI, including DSH's own browser session.** After the gateway's password check, the gateway exchanges DSH's one-time launch token — a fresh value on every `dsh web` start, read inside the gateway process — for the Host-bound DSH browser cookie, and sets it on your remote browser. The token itself never reaches the browser. When DSH's LAN device pairing is enabled, the gateway also completes the pairing handshake on loopback (`/api/pair/issue` + `/api/pair/accept`) and hands your browser the device cookie directly, so you never have to open the desktop pairing link.

**LAN and Cloudflare are the same path.** The gateway listens on `0.0.0.0:8642`. An all-interfaces bind publishes this machine's LAN IPv4 addresses into `trustedHosts`, so a phone can open `http://<lan-address>:8642` and pass the fence. A Cloudflare Tunnel points `https://your.name` at `http://127.0.0.1:8642`; add that name to the same `trustedHosts` list. Each browser keeps its real `Host` and `Origin`. One password, one session, no separate forwarding mode for the LAN and the tunnel.

**The trust fence stays on.** DSH 0.2 admits `/api` only when `Host` is loopback or listed in `trustedHosts`, a present `Origin` matches that Host, and `Sec-Fetch-Site` is not `cross-site`. This gateway forwards those headers unchanged and appends your public names to the connection service's `trustedHosts` at runtime, beside the LAN addresses and `--trusted-host` values DSH already derived. A name you did not list is still refused. DNS rebinding and cross-site browser requests keep hitting the same check they hit locally.

**DSH never leaves loopback.** `dsh web --host 0.0.0.0` is rejected on purpose: the harness can run shell commands. The gateway is a separate listener (default `0.0.0.0:8642`) with its own password. Binding DSH to the network is still refused.

**The whole GUI, including the live socket.** HTTP bodies are piped, not buffered, so large uploads and SSE pass through. WebSocket upgrades (`/api/events.mux`, `/api/events.host`) are raw bidirectional tunnels. Cookie minting and pairing ride DSH's own loopback APIs, so there is no second UI and no private protocol to keep in sync with DSH releases.

**Repeat visits are fast.** Upstream DSH sends no cache headers, so a remote browser re-downloads the JS/CSS bundle every time. The gateway adds a content-aware `Cache-Control` policy: hash-addressed assets are immutable for a year, other static files revalidate after five minutes, HTML is `no-store`.

**It is a plugin, not a sidecar.** It starts and stops with `dsh web`, follows `--port 0`, and uses a soft inject so profiles without `webServer` still boot. A busy gateway port disables only the gateway. Runtime code is Node core (`node:http`, `node:crypto`, `node:net`, `node:tls`).

```
remote browser ──HTTPS──> dsh-remote-ui-gateway (0.0.0.0:8642, password)
                                │  Host, Origin, Sec-Fetch-Site unchanged
                                ▼
                         DSH web (127.0.0.1:<dshPort>)
                         trustedHosts includes the public names
```

## Also included

- DSH browser cookie minted in-gateway from the one-time launch token; the token changes on every start and never reaches the browser.
- Device pairing completed on loopback when DSH's LAN pairing is on: the remote browser gets the `dsh_pair` device cookie (1 year, `HttpOnly`) straight from the gateway login. When pairing is off or the API is absent, requests pass through untouched.
- Open-redirect guard on `next`, secret file mode `0600`. First run generates a random password and logs the path once.

### Cache policy

| Response | Policy |
| --- | --- |
| HTML | `no-store` |
| Hash-addressed assets — hash paths (`/assets/`, `/dist/`, `/static/`, `/vendor/`, `/favicon`) or hash query (`?rev=<hash>`, `?v=<hash>`, …) | `public, max-age=31536000, immutable` (overrides an upstream `no-cache`; a new hash is a new URL) |
| Other static files (JS/CSS/images/fonts/wasm, by content-type or extension) | `public, max-age=300` |
| API and streams | untouched |

Applied to successful (2xx/3xx) GET/HEAD only. Non-hash responses never override an upstream policy or `ETag`.

## Install

```sh
dsh plugin --profile web add dsh-remote-ui-gateway           # from npm
dsh plugin --profile web add link:/path/to/dsh-remote-ui-gateway   # local checkout
dsh web
```

Peers match DSH 0.2: `@deepseek-ai/cordis@~4.0.4` and `@deepseek-ai/schemastery@~3.18.4`.

Password resolution: plugin `password` → `$DSH_REMOTE_UI_GATEWAY_PASSWORD` (then `$DSH_REMOTE_GATEWAY_PASSWORD`, then `$DSH_GATEWAY_PASSWORD`) → `~/.dsh-remote-ui-gateway/secret` (then `~/.dsh-remote-gateway/secret`, then `~/.dsh-gateway/secret`). First run generates a random password, logs the path once, and writes the file as `0600`.

### Configuration

In the profile's `cordis.patch.yml`:

```yaml
- id: web-gateway
  config:
    enabled: true
    host: 0.0.0.0
    port: 8642
    password: ""            # empty → resolution order above
    sessionTtlMs: 604800000 # 7 days
    trustedHosts:           # names browsers put in Host
      - harness.example
```

Listening on `0.0.0.0` or `::` publishes every non-loopback IPv4 address, so the LAN needs no hand-written entries. A single concrete bind address is published too. Put Cloudflare or other public names in `trustedHosts`. A port-less entry matches any port; `host:port` is exact. A value that is not a bare authority fails plugin load.

### In front of TLS

- **LAN** — open `http://<this-machine-lan-address>:8642`. That address is already trusted. Plain HTTP is fine on the same network; do not leave it open beyond that network.
- **Cloudflare Tunnel** — point `cloudflared` at `http://127.0.0.1:8642` and set `trustedHosts` to the name in the browser bar (`harness.example:443` when the port is part of the authority). Caddy, nginx, and Traefik work the same way: TLS ends at the proxy.

## How it works

| Concern | Approach |
| --- | --- |
| Remote admission | Browser `Host` / `Origin` / `Sec-Fetch-Site` pass through. `connection.trustedHosts` is the web-runtime list plus `remoteGateway.trustedHosts` |
| Auth | scrypt-derived key signs `<exp>.<hmac>` session tokens |
| DSH browser session | One-time launch token exchanged in-gateway for a Host-bound cookie |
| Device pairing | `/api/pair/issue` + `/api/pair/accept` replayed on loopback when DSH's LAN pairing is on |
| WebSockets | Handshake replayed upstream, then a byte pipe in both directions |
| Caching | Hash-addressed assets immutable for a year; other static files revalidate after 5 minutes; HTML is `no-store` |
| Lifetime | Listener is a cordis effect on `webServer`; disposal closes it |

## Security

- A logged-in gateway session is a local DSH browser session, including agent shell tools. Keep a strong password and TLS in front.
- The device cookie, when minted, lasts a year. Paired devices are managed from DSH's settings page.
- Changing the password invalidates every gateway session (the signing key is derived from it); DSH-side credentials and device pairing are untouched.
- Do not publish the plaintext gateway port on the internet.

## Requirements

- Node.js >= 20
- DSH (`@deepseek-ai/dsh`) 0.2 with the `web` profile

## License

MIT
