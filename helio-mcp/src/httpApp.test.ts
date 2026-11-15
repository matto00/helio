import { request as httpRequest } from "node:http";
import { gzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HelioAuthError, HelioHttpClient } from "./httpClient.js";
import type { HelioApi } from "./helioApi.js";
import { createServer } from "./server.js";
import {
  INIT,
  fullFlow,
  mcpPost,
  startBackend,
  startMcp,
  type McpHarness,
  type StubBackend,
} from "./testing/httpHarness.js";

jest.setTimeout(20_000);

let backend: StubBackend;
let mcp: McpHarness;

async function boot(env: Record<string, string> = {}): Promise<void> {
  backend = await startBackend();
  backend.pats.set("helio_pat_alice", "live");
  backend.pats.set("helio_pat_bob", "live");
  mcp = await startMcp(backend, env);
}
afterEach(async () => {
  await mcp.close();
  await backend.close();
});

const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };
const callTool = (name: string, args: unknown = {}): unknown => ({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name, arguments: args },
});

function resourceMetadataUrl(mcpUrl: string): string {
  return `${mcpUrl}/.well-known/oauth-protected-resource/mcp`;
}

describe("401 on /mcp", () => {
  beforeEach(() => boot());

  it("answers a missing, tampered or garbage token with WWW-Authenticate", async () => {
    const { accessToken } = await fullFlow(mcp, "helio_pat_alice");
    const tampered = accessToken.slice(0, -2) + (accessToken.endsWith("AA") ? "BB" : "AA");
    for (const token of [undefined, tampered, "garbage"]) {
      const res = await mcpPost(mcp, token, LIST);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain(
        `resource_metadata="${resourceMetadataUrl(mcp.url)}"`,
      );
    }
    expect(backend.dashboardRequests).toHaveLength(0);
  });

  it("answers an expired access token with 401", async () => {
    const { accessToken } = await fullFlow(mcp, "helio_pat_alice");
    mcp.skewMs = 91 * 24 * 3600 * 1000;
    expect((await mcpPost(mcp, accessToken, LIST)).status).toBe(401);
  });

  it("refuses an oversized unauthenticated POST with 401, not 413", async () => {
    const big = Buffer.alloc(33 * 1024 * 1024, 0x20);
    const res = await mcpPost(mcp, undefined, big.toString("latin1"));
    expect(res.status).toBe(401);
  });

  it("answers GET and DELETE with 405 + Allow: POST when authorized, 401 when not", async () => {
    const { accessToken } = await fullFlow(mcp, "helio_pat_alice");
    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(`${mcp.url}/mcp`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect((await fetch(`${mcp.url}/mcp`, { method })).status).toBe(401);
    }
  });
});

describe("tools", () => {
  beforeEach(() => boot());

  it("lists exactly the tools a stdio client sees", async () => {
    const { accessToken } = await fullFlow(mcp, "helio_pat_alice");
    const res = await mcpPost(mcp, accessToken, LIST);
    expect(res.status).toBe(200);
    const names = ((await res.json()) as { result: { tools: { name: string }[] } }).result.tools
      .map((t) => t.name)
      .sort();

    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createServer({} as HelioApi);
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    const expected = (await client.listTools()).tools.map((t) => t.name).sort();
    await client.close();
    expect(names).toEqual(expected);
    expect(names.length).toBeGreaterThan(10);
  });

  it("binds each token to its own PAT (two users do not cross)", async () => {
    const alice = await fullFlow(mcp, "helio_pat_alice");
    const bob = await fullFlow(mcp, "helio_pat_bob");
    const text = async (token: string): Promise<string> =>
      JSON.stringify(await (await mcpPost(mcp, token, callTool("list_dashboards"))).json());
    const [a, b] = await Promise.all([text(alice.accessToken), text(bob.accessToken)]);
    expect(a).toContain("dash-of-helio_pat_alice");
    expect(a).not.toContain("helio_pat_bob");
    expect(b).toContain("dash-of-helio_pat_bob");
    expect(b).not.toContain("helio_pat_alice");
  });

  it("initialises", async () => {
    const { accessToken } = await fullFlow(mcp, "helio_pat_alice");
    expect((await mcpPost(mcp, accessToken, INIT)).status).toBe(200);
  });
});

describe("PAT liveness", () => {
  beforeEach(() => boot({ HELIO_MCP_LIVENESS_TTL_SECONDS: "1" }));

  it("401s with invalid_token once a revoked PAT's liveness entry is stale", async () => {
    const { accessToken } = await fullFlow(mcp, "helio_pat_alice");
    expect((await mcpPost(mcp, accessToken, LIST)).status).toBe(200);
    backend.pats.set("helio_pat_alice", "revoked");
    // Inside the window: served, and the tool call surfaces a reconnect hint.
    const inside = await mcpPost(mcp, accessToken, callTool("list_dashboards"));
    expect(inside.status).toBe(200);
    const body = JSON.stringify(await inside.json());
    expect(body).toContain("isError");
    expect(body).toContain("Reconnect the connector");
    expect(body).not.toContain("HELIO_PAT");
    mcp.skewMs = 2000;
    const after = await mcpPost(mcp, accessToken, LIST);
    expect(after.status).toBe(401);
    const header = after.headers.get("www-authenticate") ?? "";
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain(`resource_metadata="${resourceMetadataUrl(mcp.url)}"`);
  });

  it("does not 401 on a backend 5xx, 429 or timeout", async () => {
    const { accessToken } = await fullFlow(mcp, "helio_pat_alice");
    for (const override of [503, 429, 0]) {
      mcp.skewMs += 2000;
      backend.tokensOverride = override;
      const res = await mcpPost(mcp, accessToken, LIST);
      expect(res.status).toBe(200);
    }
  });
});

describe("size limits and logging", () => {
  beforeEach(() => boot({ HELIO_MCP_LARGE_BODY_SLOTS: "1" }));

  it("answers 413 above 32 MiB when authorized", async () => {
    const { accessToken } = await fullFlow(mcp, "helio_pat_alice");
    const res = await mcpPost(mcp, accessToken, "x".repeat(33 * 1024 * 1024));
    expect(res.status).toBe(413);
  });

  it("logs no body fragment for a malformed JSON body", async () => {
    const { accessToken } = await fullFlow(mcp, "helio_pat_alice");
    const res = await mcpPost(mcp, accessToken, '{"secret-marker-123": nope');
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("secret-marker-123");
    const logs = mcp.logs.join("\n");
    expect(logs).not.toContain("secret-marker-123");
    expect(logs).toContain("status=400");
    expect(logs).not.toContain(accessToken);
  });

  it("429s a second large request, including a small gzip, while a slot is held", async () => {
    const { accessToken } = await fullFlow(mcp, "helio_pat_alice");
    const port = new URL(mcp.url).port;
    const held = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/mcp",
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
      },
    });
    held.on("error", () => undefined);
    held.write("{");
    await new Promise((r) => setTimeout(r, 300));
    try {
      const chunked = await mcpPost(mcp, accessToken, "x".repeat(9 * 1024 * 1024));
      expect(chunked.status).toBe(429);
      expect(chunked.headers.get("retry-after")).toBe("5");
      const inflating = gzipSync(Buffer.alloc(9 * 1024 * 1024, 0x20));
      expect(inflating.length).toBeLessThan(100_000);
      const gz = await fetch(`${mcp.url}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          Accept: "application/json, text/event-stream",
        },
        body: inflating,
      });
      expect(gz.status).toBe(429);
      // A small identity-encoded request is unaffected by the held slot.
      expect((await mcpPost(mcp, accessToken, LIST)).status).toBe(200);
    } finally {
      held.destroy();
    }
    // The slot is released when the held connection closes.
    await new Promise((r) => setTimeout(r, 300));
    expect((await mcpPost(mcp, accessToken, "x".repeat(9 * 1024 * 1024))).status).not.toBe(429);
  });
});

describe("stdio is unchanged", () => {
  it("keeps the original HELIO_PAT remediation text when no hint is set", async () => {
    const client = new HelioHttpClient(
      { baseUrl: "http://x.invalid", pat: "helio_pat_x" },
      { fetchImpl: async () => new Response("{}", { status: 401 }) },
    );
    const err = await client.get("/api/dashboards").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HelioAuthError);
    expect((err as Error).message).toBe(
      "Unauthorized (401): the Helio PAT was rejected. It may be revoked, " +
        "expired, or wrong. Mint a fresh token via POST /api/tokens and update HELIO_PAT.",
    );
  });
});
