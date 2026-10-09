import z from "@deepseek-ai/schemastery";
import { sessionKey } from "./auth.mjs";
import { resolveStoredPassword } from "./password.mjs";
import { createGateway } from "./server.mjs";
import { collectTrustedHosts } from "./trusted-hosts.mjs";

/**
 * dsh-remote-gateway — password-gated reverse proxy that forwards the
 * browser's Host and Origin unchanged and publishes those names on
 * `remoteGateway.trustedHosts` for the DSH 0.2 connection fence.
 * @module dsh-remote-gateway
 */

/** @typedef {import("@deepseek-ai/cordis").Context} Context */

/**
 * @typedef {Context & { webServer?: { port?: number } }} GatewayContext
 * @typedef {import("@deepseek-ai/cordis").Logger} Logger
 */

export const name = "dsh-remote-gateway";

export const Config = z.object({
  enabled: z.boolean().default(true),
  host: z.string().default("0.0.0.0"),
  port: z.natural().max(65535).default(8642),
  password: z.string().default(""),
  sessionTtlMs: z.natural().default(7 * 86_400_000),
  trustedHosts: z.array(z.string()).default([]),
});

/**
 * @param {Context} ctx
 * @param {ReturnType<typeof Config>} [config]
 */
export function apply(ctx, config = Config({})) {
  /** @type {Logger} */
  const logger = /** @type {any} */ (ctx).logger("dsh-remote-gateway");
  const trustedHosts = config.enabled ? collectTrustedHosts(config.trustedHosts, config.host) : [];
  /** @type {any} */ (ctx).provide("remoteGateway", { trustedHosts });
  if (!config.enabled) {
    logger.info("disabled by config");
    return;
  }
  if (trustedHosts.length > 0) {
    logger.info(`publishing trusted hosts: ${trustedHosts.join(", ")}`);
  }
  // Soft inject: web profiles provide webServer; headless/desktop profiles do not.
  // A static inject would stall the fiber on those profiles (DSH 0.2+).
  /** @type {any} */ (ctx).inject(["webServer"], async (/** @type {GatewayContext} */ webCtx) => {
    const webPort = webCtx.webServer?.port;
    if (webPort === undefined) {
      throw new Error("dsh-remote-gateway: webServer is not listening (no port)");
    }
    const { password, generated, file } = resolveStoredPassword(config.password);
    const server = createGateway({
      target: new URL(`http://127.0.0.1:${webPort}`),
      password,
      sessionKey: sessionKey(password),
      sessionTtlMs: config.sessionTtlMs,
      log: (level, message) => {
        if (level === "info") logger.info(message);
        else logger.warn(message);
      },
    });
    try {
      await new Promise((resolve, reject) => {
        const onError = (/** @type {NodeJS.ErrnoException} */ err) => reject(err);
        server.once("error", onError);
        server.listen(config.port, config.host, () => {
          server.removeListener("error", onError);
          resolve(undefined);
        });
      });
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      if (code === "EADDRINUSE") {
        logger.error(`port ${config.port} is busy — gateway disabled (stop the other listener or set another port); DSH keeps running`);
        return;
      }
      throw err;
    }
    webCtx.effect(() => () => server.close(), "dsh-remote-gateway: listener");
    const address = server.address();
    const shownPort = typeof address === "object" && address !== null ? address.port : config.port;
    logger.info(`listening on http://${config.host}:${shownPort} -> http://127.0.0.1:${webPort}`);
    if (generated) {
      logger.info(`password generated and stored at ${file} (mode 0600); set the plugin config "password" or DSH_REMOTE_GATEWAY_PASSWORD to override`);
    }
  });
}
