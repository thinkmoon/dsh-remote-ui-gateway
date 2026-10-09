# dsh-remote-gateway

[English](README.md) | [中文](README.zh.md)

Remote access to the [DSH](https://www.npmjs.com/package/@deepseek-ai/dsh) Web GUI, as a plugin that starts with `dsh web`. DSH stays on loopback. The gateway is the only process on the network, and DSH 0.2 admits the session through its own `trustedHosts` fence.

```sh
dsh plugin --profile web add dsh-remote-gateway   # or link:<local checkout>
dsh web                                     # gateway listens on 0.0.0.0:8642
```

## What makes it different

**The trust fence stays on.** DSH 0.2 admits `/api` only when `Host` is loopback or listed in `trustedHosts`, a present `Origin` matches that Host, and `Sec-Fetch-Site` is not `cross-site`. This gateway forwards those headers unchanged and appends your public names to the connection row, beside the LAN addresses and `--trusted-host` values DSH already derived. A name you did not list is still refused. DNS rebinding and cross-site browser requests keep hitting the same check they hit locally.

**DSH never leaves loopback.** `dsh web --host 0.0.0.0` is rejected on purpose: the harness can run shell commands. The gateway is a separate listener (default `0.0.0.0:8642`) with its own password. Binding DSH to the network is still refused.

**The whole GUI, including the live socket.** HTTP bodies are piped, not buffered, so large uploads and SSE pass through. WebSocket upgrades (`/api/events.mux`, `/api/events.host`) are raw bidirectional tunnels. There is no second UI and no pairing protocol to keep in sync with DSH releases.

**Repeat visits are fast.** Upstream DSH sends no cache headers, so a remote browser re-downloads the JS/CSS bundle every time. The gateway adds a content-aware `Cache-Control` policy: hash-addressed assets are immutable for a year, other static files revalidate after five minutes, HTML is `no-store`.

**It is a plugin, not a sidecar.** It starts and stops with `dsh web`, follows `--port 0`, and uses a soft inject so profiles without `webServer` still boot. A busy gateway port disables only the gateway. Runtime code is Node core (`node:http`, `node:crypto`, `node:net`, `node:tls`).

```
remote browser ──HTTPS──> dsh-remote-gateway (0.0.0.0:8642, password)
                               │  Host, Origin, Sec-Fetch-Site unchanged
                               ▼
                        DSH web (127.0.0.1:<dshPort>)
                        trustedHosts includes the public names
```

## Also included

- Password page, HMAC-SHA256 `HttpOnly; SameSite=Lax` cookie (default 7 days), and `Authorization: Bearer` for scripts. WebSocket upgrades use the same session.
- Per-IP login limit (10 attempts / 10 minutes), timing-safe password compare, open-redirect guard on `next`, gateway cookie withheld from upstream, secret file mode `0600`.

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
dsh plugin --profile web add link:/path/to/dsh-remote-gateway
dsh web
```

Peers match DSH 0.2: `@deepseek-ai/cordis@~4.0.4` and `@deepseek-ai/schemastery@~3.18.4`.

Password resolution: plugin `password` → `$DSH_REMOTE_GATEWAY_PASSWORD` (then `$DSH_GATEWAY_PASSWORD`) → `~/.dsh-remote-gateway/secret` (then `~/.dsh-gateway/secret`). First run generates a random password, logs the path once, and writes the file as `0600`.

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

A concrete non-loopback bind address is published automatically. `0.0.0.0` is not a client Host, so DNS names and public IPs go in `trustedHosts`. A port-less entry matches any port; `host:port` is exact. A value that is not a bare authority fails plugin load.

### In front of TLS

- **Cloudflare Tunnel** — point `cloudflared` at `http://127.0.0.1:8642`. Caddy, nginx, and Traefik work the same way: TLS ends at the proxy, the gateway stays on loopback or the LAN.
- **LAN / VPS** — put TLS in front. Over plaintext HTTP the password and session cookie travel in cleartext.

Put the name browsers actually send (`harness.example`, or `harness.example:443` when the port is part of the authority) into `trustedHosts`.

## How it works

| Concern | Approach |
| --- | --- |
| Remote admission | Browser `Host` / `Origin` / `Sec-Fetch-Site` pass through. `connection.trustedHosts` is the web-runtime list plus `remoteGateway.trustedHosts` |
| Auth | scrypt-derived key signs `<exp>.<hmac>` session tokens |
| WebSockets | Handshake replayed upstream, then a byte pipe in both directions |
| Caching | Hash-addressed assets immutable for a year; other static files revalidate after 5 minutes; HTML is `no-store` |
| Lifetime | Listener is a cordis effect on `webServer`; disposal closes it |

## Security

- A logged-in gateway session is a local DSH browser session, including agent shell tools. Keep a strong password and TLS in front.
- Changing the password invalidates every session (the signing key is derived from it).
- Do not publish the plaintext gateway port on the internet.

## Requirements

- Node.js >= 20
- DSH (`@deepseek-ai/dsh`) 0.2 with the `web` profile

## License

MIT
