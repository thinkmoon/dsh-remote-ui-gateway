import { networkInterfaces } from "node:os";

/**
 * Authorities handed to DSH's `connection.trustedHosts`.
 * A port-less name matches any port; `host:port` is exact.
 * Shape matches client-connection 0.2: bare canonical authority only.
 *
 * An all-interfaces bind publishes each non-loopback IPv4 address, so a LAN
 * browser's Host is already trusted. Cloudflare (and any other public name)
 * is an extra configured entry on the same list.
 * @param {string[]} configured
 * @param {string} bindHost
 * @returns {string[]}
 */
export function collectTrustedHosts(configured, bindHost) {
  /** @type {string[]} */
  const hosts = [];
  for (const entry of implicitAuthorities(bindHost)) pushHost(hosts, entry);
  for (const entry of configured) {
    assertTrustedAuthority(entry);
    pushHost(hosts, entry);
  }
  return hosts;
}

/**
 * @param {string[]} hosts
 * @param {string} entry
 */
function pushHost(hosts, entry) {
  if (!hosts.includes(entry)) hosts.push(entry);
}

/**
 * @param {string} bindHost
 * @returns {string[]}
 */
function implicitAuthorities(bindHost) {
  if (bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "[::]") return lanIpv4Addresses();
  const bind = implicitBindAuthority(bindHost);
  return bind === undefined ? [] : [bind];
}

/**
 * @returns {string[]}
 */
function lanIpv4Addresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface !== undefined && iface.family === "IPv4" && !iface.internal)
    .map((iface) => iface.address);
}

/**
 * A concrete non-loopback bind is a host clients can put in Host.
 * 0.0.0.0 / :: and loopback are not public names.
 * @param {string} bindHost
 * @returns {string | undefined}
 */
function implicitBindAuthority(bindHost) {
  if (bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "[::]") return undefined;
  if (bindHost === "localhost" || bindHost === "::1" || bindHost === "[::1]") return undefined;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bindHost)) return undefined;
  assertTrustedAuthority(bindHost);
  return bindHost;
}

/**
 * @param {string} entry
 */
function assertTrustedAuthority(entry) {
  let parsed;
  try {
    parsed = new URL(`http://${entry}`);
  } catch {
    parsed = undefined;
  }
  const canonical = parsed === undefined ? undefined : canonicalAuthority(entry, parsed);
  if (parsed !== undefined && canonical === entry.toLowerCase()) return;
  throw new Error(`dsh-remote-gateway: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`);
}

/**
 * @param {string} entry
 * @param {URL} entryUrl
 * @returns {string}
 */
function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
  return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
