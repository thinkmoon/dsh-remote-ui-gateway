# dsh-remote-gateway

[English](README.md) | [中文](README.zh.md)

[DSH](https://www.npmjs.com/package/@deepseek-ai/dsh) Web GUI 的远程入口，以插件形式随 `dsh web` 启动。DSH 继续只监听 loopback。对外只暴露这个网关，远程会话由 DSH 0.2 自己的 `trustedHosts` 护栏放行。

```sh
dsh plugin --profile web add dsh-remote-gateway   # 或 link:<本地目录>
dsh web                                     # gateway 监听 0.0.0.0:8642
```

## 亮点

**网关自己有一套认证，挡在 DSH 前面。** 远程流量先过登录页或 `Authorization: Bearer`。通过后才拿到网关自己的会话：密码经 scrypt 派生密钥，HMAC-SHA256 签出带过期时间的 `HttpOnly; SameSite=Lax` cookie（默认 7 天）。这张 cookie 不会转发给 DSH，WebSocket upgrade 也走同一道门。DSH 本机的浏览器登录原样留在 loopback 后面。改网关密码只让网关会话失效，不动 DSH 自己的凭证。登录按 IP 限速（10 次 / 10 分钟），密码比较是 timing-safe 的。

**局域网和 Cloudflare 是同一条路。** 网关默认听在 `0.0.0.0:8642`。监听所有网卡时，本机的局域网 IPv4 会自动写进 `trustedHosts`，手机打开 `http://<局域网地址>:8642` 就能过护栏。Cloudflare Tunnel 把 `https://你的域名` 转到 `http://127.0.0.1:8642`，只要把这个域名加进同一份 `trustedHosts`。两处浏览器各自带着真实的 `Host` 和 `Origin`，密码和会话是同一套，不用为局域网和隧道各做一种转发。

**信任护栏继续生效。** DSH 0.2 的 `/api` 只在 `Host` 为 loopback 或列入 `trustedHosts`、附带的 `Origin` 与该 Host 一致、且 `Sec-Fetch-Site` 不是 `cross-site` 时放行。本网关原样转发这些头，并在运行时把对外名字追加到 connection 的 `trustedHosts`，与 DSH 已经推导的 LAN 地址、`--trusted-host` 并列。没写进名单的主机名仍然 403。DNS 重绑定和跨站浏览器请求打到的是同一道检查。

**DSH 不出 loopback。** `dsh web --host 0.0.0.0` 会被拒绝，因为 harness 能执行 shell。网关是单独的监听器（默认 `0.0.0.0:8642`），自带密码。DSH 本身仍然不能绑到网卡上。

**整个 GUI，包括实时通道。** HTTP 正文管道转发、不缓冲，大上传和 SSE 原样通过。WebSocket upgrade（`/api/events.mux`、`/api/events.host`）是原始双向字节隧道。没有第二套界面，也不需要一套要跟着 DSH 版本走的配对协议。

**第二次打开是快的。** 上游 DSH 不发缓存头，远程浏览器每次都重新拉整包 JS/CSS。网关按内容补上 `Cache-Control`：带内容 hash 的资源 immutable 一年，其他静态文件 5 分钟后复验证，HTML 为 `no-store`。

**它是插件，不是旁边再跑一个进程。** 随 `dsh web` 启动和退出，跟随 `--port 0`。软注入 `webServer`，没有 web 服务的 profile 照常启动。网关端口被占只关掉网关。运行时代码只有 Node 核心（`node:http`、`node:crypto`、`node:net`、`node:tls`）。

```
远程浏览器 ──HTTPS──> dsh-remote-gateway (0.0.0.0:8642, 密码)
                           │  Host、Origin、Sec-Fetch-Site 原样转发
                           ▼
                    DSH web (127.0.0.1:<dshPort>)
                    trustedHosts 包含对外主机名
```

## 一并带上的

- `next` 的开放重定向防护，密钥文件 `0600`。首次运行会生成随机密码并只把路径记入日志一次。

### 缓存策略

| 响应 | 策略 |
| --- | --- |
| HTML | `no-store` |
| 以内容 hash 寻址的资源 —— hash 路径（`/assets/`、`/dist/`、`/static/`、`/vendor/`、`/favicon`）或 hash 查询（`?rev=<hash>`、`?v=<hash>` 等） | `public, max-age=31536000, immutable`（覆盖上游 `no-cache`；hash 变了就是新 URL） |
| 其他静态文件（JS/CSS/图片/字体/wasm，按 content-type 或扩展名） | `public, max-age=300` |
| API 与流式响应 | 不干预 |

只作用于成功（2xx/3xx）的 GET/HEAD。没有 hash 的响应不会覆盖上游策略或 `ETag`。

## 安装

```sh
dsh plugin --profile web add link:/path/to/dsh-remote-gateway
dsh web
```

peer 对齐 DSH 0.2：`@deepseek-ai/cordis@~4.0.4`、`@deepseek-ai/schemastery@~3.18.4`。

密码解析顺序：插件 `password` → `$DSH_REMOTE_GATEWAY_PASSWORD`（再回退 `$DSH_GATEWAY_PASSWORD`）→ `~/.dsh-remote-gateway/secret`（再回退 `~/.dsh-gateway/secret`）。首次运行生成随机密码，把路径记入日志一次，文件权限 `0600`。

### 配置

写在 profile 的 `cordis.patch.yml`：

```yaml
- id: web-gateway
  config:
    enabled: true
    host: 0.0.0.0
    port: 8642
    password: ""            # 留空 → 走上文解析顺序
    sessionTtlMs: 604800000 # 7 天
    trustedHosts:           # 浏览器 Host 里会出现的名字
      - harness.example
```

监听 `0.0.0.0` 或 `::` 时，每块网卡的非 loopback IPv4 会自动发布，局域网不用再手写地址。单个具体绑定地址也会自动发布。Cloudflare 或公网域名写在 `trustedHosts`。不带端口的条目匹配任意端口，`host:port` 精确匹配。不是裸 authority 的值会让插件加载失败。

### TLS 放在前面

- **局域网** —— 打开 `http://<本机局域网地址>:8642`。地址已在信任名单里。同一 Wi-Fi 上的明文 HTTP 能用；离开这台机器所在的网络就不要再裸奔。
- **Cloudflare Tunnel** —— `cloudflared` 指向 `http://127.0.0.1:8642`，`trustedHosts` 写浏览器地址栏里的域名（端口属于 authority 时写 `harness.example:443`）。Caddy、nginx、Traefik 同样：TLS 在反代终结。

## 工作原理

| 关注点 | 做法 |
| --- | --- |
| 远程放行 | 浏览器的 `Host` / `Origin` / `Sec-Fetch-Site` 原样转发。`connection.trustedHosts` 是 web runtime 列表再加上 `remoteGateway.trustedHosts` |
| 认证 | scrypt 派生密钥签名 `<exp>.<hmac>` 会话令牌 |
| WebSocket | 向上游重放握手，之后字节双向管道 |
| 缓存 | hash 资源 immutable 一年；其他静态文件 5 分钟后复验证；HTML 为 `no-store` |
| 生命周期 | 监听器是挂在 `webServer` 上的 cordis effect，销毁时关闭 |

## 安全

- 登录后的网关会话等同于本地 DSH 浏览器会话，包括 agent 的 shell 工具。使用强密码，并让 TLS 挡在前面。
- 修改密码会使全部会话失效（签名密钥由密码派生）。
- 不要把网关的明文端口暴露到公网。

## 环境要求

- Node.js >= 20
- 带 `web` profile 的 DSH（`@deepseek-ai/dsh`）0.2

## 许可

MIT
