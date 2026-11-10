/**
 * Express app factory for the Streamable HTTP entry point (HEL-1709, designs D1, D5, D6).
 *
 * Importable from Jest (no `listen`). Request pipeline on `/mcp`, in this fixed order so an
 * anonymous request is refused before any body is read:
 *   bearer auth -> PAT liveness -> large-body slot -> JSON body (32 MiB) -> stateless transport.
 */

import { createHash } from "node:crypto";
import cors from "cors";
import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { HelioHttpClient } from "./httpClient.js";
import { HelioApi } from "./helioApi.js";
import { createServer } from "./server.js";
import type { HttpConfig } from "./httpConfig.js";
import { HelioOAuthProvider } from "./oauth/provider.js";
import { createConsentRouter } from "./oauth/routes.js";
import { checkPat } from "./oauth/patCheck.js";

/** Cloud Run caps HTTP/1 request bodies at 32 MiB, so `/mcp` matches it (stdio keeps 64 MiB). */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;
/** Bodies above this (or chunked / content-encoded) take a large-body slot. */
export const LARGE_BODY_BYTES = 8 * 1024 * 1024;
const LIVENESS_CACHE_MAX = 10_000;

export const CONNECTOR_AUTH_HINT =
  "Unauthorized (401): the Helio access behind this connector was revoked or has expired. " +
  "Reconnect the connector to sign in again.";

export interface HttpAppOptions {
  /** One-line logger (stderr in production). Receives only method/path/status and error names. */
  readonly log?: (line: string) => void;
  readonly now?: () => number;
}

/** Per-instance LRU of "this token's PAT was accepted by the backend at time T". */
class LivenessCache {
  private readonly entries = new Map<string, number>();

  isFresh(key: string, now: number, ttlMs: number): boolean {
    const at = this.entries.get(key);
    if (at === undefined) return false;
    if (now - at >= ttlMs) {
      this.entries.delete(key);
      return false;
    }
    // Refresh recency without moving the verification time.
    this.entries.delete(key);
    this.entries.set(key, at);
    return true;
  }

  record(key: string, now: number): void {
    this.entries.delete(key);
    this.entries.set(key, now);
    if (this.entries.size > LIVENESS_CACHE_MAX) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  forget(key: string): void {
    this.entries.delete(key);
  }
}

function jsonRpcError(code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

export function createHttpApp(config: HttpConfig, options: HttpAppOptions = {}): Express {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? Date.now;
  const provider = new HelioOAuthProvider(config, now);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.resourceUrl);
  const liveness = new LivenessCache();
  const ttlMs = config.livenessTtlSeconds * 1000;
  let slotsInUse = 0;

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // One line per request: method, path (never the query, which carries sealed values), status.
  app.use((req, res, next) => {
    res.on("finish", () =>
      log(`helio-mcp: ${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode}`),
    );
    next();
  });

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: config.publicUrl,
      baseUrl: config.publicUrl,
      resourceServerUrl: config.resourceUrl,
      authorizationOptions: { rateLimit: { windowMs: 15 * 60_000, limit: 300 } },
      tokenOptions: { rateLimit: { windowMs: 15 * 60_000, limit: 300 } },
      clientRegistrationOptions: { rateLimit: { windowMs: 60 * 60_000, limit: 60 } },
    }),
  );

  // The SDK serves only the `/mcp`-suffixed document; some clients ask for the root one.
  app.get("/.well-known/oauth-protected-resource", cors(), (_req, res) => {
    res.json({ resource: config.resourceUrl.href, authorization_servers: [config.publicUrl.href] });
  });

  app.use(createConsentRouter(config, provider));

  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl,
    expectedResource: config.resourceUrl,
  });

  const livenessGate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = req.auth;
    const pat = typeof auth?.extra?.pat === "string" ? auth.extra.pat : undefined;
    if (!auth || !pat) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    const key = createHash("sha256").update(auth.token).digest("hex");
    if (liveness.isFresh(key, now(), ttlMs)) return next();
    const status = await checkPat(config.apiBaseUrl, pat);
    if (status === "rejected") {
      liveness.forget(key);
      res.set(
        "WWW-Authenticate",
        `Bearer error="invalid_token", error_description="The connector's access was revoked", resource_metadata="${resourceMetadataUrl}"`,
      );
      res.status(401).json({
        error: "invalid_token",
        error_description: "The connector's access was revoked",
      });
      return;
    }
    // Deliberate: only a 401 revokes. 429 / 5xx / timeout say nothing about the PAT, and a non-401 4xx
    // ("refused", e.g. a scoped PAT's 403) cannot arise for a token the callback issued (it refuses
    // them before issuing a code); either way we serve and let the tool call decide. Only "live" is
    // cached, so these re-check on the next request (a bounded 3 s cost, never a forced re-consent).
    if (status === "live") liveness.record(key, now());
    next();
  };

  const largeBodyGate = (req: Request, res: Response, next: NextFunction): void => {
    const length = Number(req.headers["content-length"] ?? 0);
    const encoding = String(req.headers["content-encoding"] ?? "identity")
      .toLowerCase()
      .trim();
    const chunked = String(req.headers["transfer-encoding"] ?? "")
      .toLowerCase()
      .includes("chunked");
    const large =
      chunked || !(length <= LARGE_BODY_BYTES) || (encoding !== "" && encoding !== "identity");
    if (!large) return next();
    if (slotsInUse >= config.largeBodySlots) {
      res.set("Retry-After", "5");
      res.status(429).json(jsonRpcError(-32000, "Server busy with large requests; retry shortly"));
      return;
    }
    slotsInUse += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      slotsInUse -= 1;
    };
    res.once("close", release);
    next();
  };

  const handleMcp = async (req: Request, res: Response): Promise<void> => {
    const pat = String(req.auth?.extra?.pat ?? "");
    const api = new HelioApi(
      new HelioHttpClient({
        baseUrl: config.apiBaseUrl,
        pat,
        authErrorHint: CONNECTOR_AUTH_HINT,
      }),
    );
    const server = createServer(api);
    // Transport errors can quote the request body: log the error name only.
    server.server.onerror = (err) => log(`helio-mcp: transport error: ${err.name}`);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  const notAllowed = (_req: Request, res: Response): void => {
    res.set("Allow", "POST");
    res.status(405).json(jsonRpcError(-32000, "Method not allowed: this server offers no stream"));
  };

  app.post(
    "/mcp",
    bearer,
    livenessGate,
    largeBodyGate,
    express.json({ limit: MAX_BODY_BYTES }),
    (req, res, next) => {
      handleMcp(req, res).catch(next);
    },
  );
  app.all("/mcp", bearer, livenessGate, notAllowed);

  const onError: ErrorRequestHandler = (err: unknown, _req, res, next) => {
    const e = err as { status?: number; statusCode?: number; name?: string };
    const status = e.status ?? e.statusCode ?? 500;
    // Name and status only: an error stack or message can quote a body snippet.
    log(`helio-mcp: error ${e.name ?? "Error"} status=${status}`);
    if (res.headersSent) {
      next(err);
      return;
    }
    if (status === 413) res.status(413).json(jsonRpcError(-32000, "Request body too large"));
    else if (status === 400) res.status(400).json(jsonRpcError(-32700, "Parse error"));
    else if (status >= 400 && status < 500)
      res.status(status).json(jsonRpcError(-32000, "Bad request"));
    else res.status(500).json(jsonRpcError(-32603, "Internal server error"));
  };
  app.use(onError);

  return app;
}
