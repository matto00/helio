/**
 * Test harness for the HTTP entry point: a stub Helio backend, helio-mcp on an ephemeral port,
 * and a scripted OAuth flow. Keys are generated per run; nothing here is a real credential.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../httpApp.js";
import { loadHttpConfig, type HttpConfig } from "../httpConfig.js";

export interface StubBackend {
  readonly url: string;
  /** PAT -> accepted? Missing = 401. */
  readonly pats: Map<string, "live" | "revoked" | "scoped">;
  /** When set, `/api/tokens` answers this status (or hangs on 0) for every PAT. */
  tokensOverride: number | undefined;
  readonly tokenChecks: string[];
  readonly dashboardRequests: string[];
  close(): Promise<void>;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

export async function startBackend(): Promise<StubBackend> {
  const pats = new Map<string, "live" | "revoked" | "scoped">();
  const sockets = new Set<import("node:net").Socket>();
  const backend: StubBackend = {
    url: "",
    pats,
    tokensOverride: undefined,
    tokenChecks: [],
    dashboardRequests: [],
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  const server = createServer((req, res) => {
    const pat = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    const state = pats.get(pat);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    };
    if (req.url?.startsWith("/api/tokens")) {
      backend.tokenChecks.push(pat);
      if (backend.tokensOverride === 0) return; // hang
      if (backend.tokensOverride !== undefined)
        return json(backend.tokensOverride, { message: "x" });
      if (state === "live") return json(200, []);
      if (state === "scoped") return json(403, { message: "scoped" });
      return json(401, { message: "Unauthorized" });
    }
    if (state !== "live") return json(401, { message: "Unauthorized" });
    if (req.url?.startsWith("/api/dashboards")) {
      backend.dashboardRequests.push(pat);
      return json(200, {
        items: [{ id: `dash-of-${pat}`, name: `Dashboard of ${pat}` }],
        total: 1,
        offset: 0,
        limit: 200,
      });
    }
    return json(404, { message: "not found" });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  const port = await listen(server);
  (backend as { url: string }).url = `http://127.0.0.1:${port}`;
  return backend;
}

export interface McpHarness {
  readonly url: string;
  readonly config: HttpConfig;
  readonly logs: string[];
  readonly appUrl: string;
  /** Added to the app's clock, to age seals in tests. */
  skewMs: number;
  close(): Promise<void>;
}

export async function startMcp(
  backend: StubBackend,
  env: Record<string, string> = {},
): Promise<McpHarness> {
  const server = createServer();
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}`;
  const appUrl = "http://localhost:5173";
  const config = loadHttpConfig({
    HELIO_MCP_PUBLIC_URL: url,
    HELIO_APP_URL: appUrl,
    HELIO_API_BASE_URL: backend.url,
    HELIO_MCP_TOKEN_KEY: randomBytes(32).toString("base64"),
    ...env,
  });
  const logs: string[] = [];
  const harness = { skewMs: 0 };
  const app = createHttpApp(config, {
    log: (line) => logs.push(line),
    now: () => Date.now() + harness.skewMs,
  });
  server.on("request", app);
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return {
    url,
    config,
    logs,
    appUrl,
    get skewMs() {
      return harness.skewMs;
    },
    set skewMs(v: number) {
      harness.skewMs = v;
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export const REDIRECT_URI = "http://127.0.0.1:9/cb";

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export async function register(
  mcp: McpHarness,
  metadata: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(`${mcp.url}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [REDIRECT_URI],
      client_name: "Test client",
      ...metadata,
    }),
  });
}

export function authorizeUrl(
  mcp: McpHarness,
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {},
): string {
  const u = new URL(`${mcp.url}/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", "st-1");
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.href;
}

/** `request` value from the consent-page redirect an `/authorize` call answered with. */
export function pendingRequest(res: Response): string {
  const loc = res.headers.get("location") ?? "";
  const u = new URL(loc);
  return u.searchParams.get("request") ?? "";
}

export async function callback(mcp: McpHarness, fields: Record<string, string>): Promise<Response> {
  return fetch(`${mcp.url}/oauth/callback`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

export async function tokenRequest(
  mcp: McpHarness,
  fields: Record<string, string>,
): Promise<Response> {
  return fetch(`${mcp.url}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/** Whole flow for `pat`: register -> authorize -> consent-equivalent callback -> token. */
export async function fullFlow(
  mcp: McpHarness,
  pat: string,
  authorizeExtra: Record<string, string> = {},
): Promise<{ accessToken: string; clientId: string }> {
  const reg = (await (await register(mcp)).json()) as { client_id: string };
  const { verifier, challenge } = pkce();
  const auth = await fetch(authorizeUrl(mcp, reg.client_id, challenge, authorizeExtra), {
    redirect: "manual",
  });
  const cb = await callback(mcp, { request: pendingRequest(auth), pat });
  const code = new URL(cb.headers.get("location") ?? "").searchParams.get("code") ?? "";
  const tok = (await (
    await tokenRequest(mcp, {
      grant_type: "authorization_code",
      client_id: reg.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    })
  ).json()) as { access_token: string };
  return { accessToken: tok.access_token, clientId: reg.client_id };
}

export function mcpPost(
  mcp: McpHarness,
  token: string | undefined,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${mcp.url}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  },
};

/** A loosely-typed JSON body, for assertions on wire shapes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jsonOf(res: Response): Promise<Record<string, any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await res.json()) as Record<string, any>;
}
