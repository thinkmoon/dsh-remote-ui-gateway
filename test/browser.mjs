import http from "node:http";
import { chromium } from "playwright";
import { createGateway } from "../src/server.mjs";
import { sessionKey } from "../src/auth.mjs";
import { isTrustedApiRequest } from "./fence.mjs";

const PASSWORD = "browser-secret";
const TRUSTED = ["gw.dsh.test"];

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve) => {
    server.listen(0, host, () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
}

const upstream = http.createServer((req, res) => {
  if (req.url === "/api/ping") {
    const trusted = isTrustedApiRequest(req, TRUSTED);
    res.writeHead(trusted ? 200 : 403, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ trusted, host: req.headers.host ?? null, origin: req.headers.origin ?? null }));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><title>remote gui</title>
<button id="ping">ping</button><pre id="out"></pre>
<script>
document.getElementById("ping").onclick = async () => {
  const response = await fetch("/api/ping");
  const body = await response.json();
  document.getElementById("out").textContent = response.status + " " + body.host;
};
</script>`);
});

const upstreamPort = await listen(upstream);
const gateway = createGateway({
  target: new URL(`http://127.0.0.1:${upstreamPort}`),
  password: PASSWORD,
  sessionKey: sessionKey(PASSWORD),
  sessionTtlMs: 60_000,
  log() {},
});
const port = await listen(gateway);

const browser = await chromium.launch({
  headless: true,
  args: ["--host-resolver-rules=MAP gw.dsh.test 127.0.0.1, MAP evil.dsh.test 127.0.0.1"],
});

/**
 * @param {string} host
 */
async function session(host) {
  const page = await browser.newPage();
  const base = `http://${host}:${port}`;
  await page.goto(base + "/");
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector("#ping");
  await page.click("#ping");
  await page.waitForFunction(() => document.getElementById("out")?.textContent?.includes(" "));
  const text = await page.locator("#out").innerText();
  await page.close();
  return text;
}

const allowed = await session("gw.dsh.test");
const denied = await session("evil.dsh.test");
await browser.close();
gateway.close();
upstream.close();

if (allowed !== `200 gw.dsh.test:${port}`) {
  throw new Error(`trusted host was not admitted: ${JSON.stringify(allowed)}`);
}
if (denied !== `403 evil.dsh.test:${port}`) {
  throw new Error(`unlisted host was not refused: ${JSON.stringify(denied)}`);
}
console.log("playwright: trusted host admitted, unlisted host refused by the DSH 0.2 fence");
