import http from "node:http";

/**
 * One pairing step for every profile. Loopback `/api/pair/status` is the
 * whole decision: no such API (plugin absent) returns undefined and the
 * gateway forwards as usual; a live API is handled here. When its remote
 * pairing switch is on, a device cookie is filled in so the browser never
 * has to open the desktop pairing link. When the switch is off, the status
 * body is returned unchanged and no cookie is minted.
 * @param {URL} target
 * @param {string | undefined} cookieHeader
 * @returns {Promise<{ body: Record<string, unknown>, cookie: string | undefined } | undefined>}
 */
export async function settlePairing(target, cookieHeader) {
  const status = await requestJson(target, "GET", "/api/pair/status", undefined, cookieHeader);
  const body = status.json;
  if (status.status !== 200 || body === null || typeof body !== "object" || typeof body.requirePairingForLan !== "boolean") {
    return undefined;
  }
  if (!body.requirePairingForLan || body.paired === true) return { body, cookie: undefined };
  const cookie = await issueDeviceCookie(target);
  return { body: { ...body, paired: cookie !== undefined || body.paired === true }, cookie };
}

/**
 * @param {URL} target
 * @returns {Promise<string | undefined>}
 */
async function issueDeviceCookie(target) {
  const issued = await postJson(target, "/api/pair/issue", {});
  const token = issued.status === 200 ? issued.json?.token : undefined;
  if (typeof token !== "string" || token.length === 0) return undefined;
  const accepted = await postJson(target, "/api/pair/accept", { token });
  if (accepted.status !== 200) return undefined;
  const raw = accepted.setCookie;
  if (raw === undefined) return undefined;
  const pair = raw.split(";")[0]?.trim();
  if (pair === undefined || !pair.includes("=")) return undefined;
  return `${pair}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

/**
 * @param {URL} target
 * @param {string} path
 * @param {object} body
 */
function postJson(target, path, body) {
  return requestJson(target, "POST", path, body);
}

/**
 * @param {URL} target
 * @param {string} method
 * @param {string} path
 * @param {object | undefined} body
 * @param {string | undefined} [cookie]
 * @returns {Promise<{ status: number, json: any, setCookie: string | undefined }>}
 */
function requestJson(target, method, path, body, cookie) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        method,
        path,
        headers: {
          host: target.host,
          accept: "application/json",
          ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": String(payload.length) }),
          ...(cookie === undefined ? {} : { cookie }),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          const setCookie = res.headers["set-cookie"];
          resolve({
            status: res.statusCode ?? 0,
            json,
            setCookie: Array.isArray(setCookie) ? setCookie[0] : setCookie,
          });
        });
      },
    );
    req.on("error", () => resolve({ status: 0, json: undefined, setCookie: undefined }));
    if (payload !== undefined) req.end(payload);
    else req.end();
  });
}
