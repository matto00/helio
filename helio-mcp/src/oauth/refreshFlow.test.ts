import { createHash } from "node:crypto";
import {
  REDIRECT_URI,
  REFRESH_CLIENT,
  authorizeUrl,
  callback,
  fullFlow,
  jsonOf,
  mcpPost,
  pendingRequest,
  pkce,
  register,
  startBackend,
  startMcp,
  tokenRequest,
  type McpHarness,
  type StubBackend,
} from "../testing/httpHarness.js";
import { open as openSeal } from "./seal.js";

const open = <T extends Record<string, unknown>>(
  keys: Parameters<typeof openSeal>[0],
  kind: string,
  token: string,
): T => openSeal<T>(keys, kind as Parameters<typeof openSeal>[1], token);

jest.setTimeout(20_000);

const PAT = "helio_pat_alice";
const sha = (v: string): string => createHash("sha256").update(v).digest("hex");
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };

let backend: StubBackend;
let mcp: McpHarness;

beforeEach(async () => {
  backend = await startBackend();
  backend.pats.set(PAT, "live");
  mcp = await startMcp(backend);
});
afterEach(async () => {
  await mcp.close();
  await backend.close();
});

const refreshFlow = () => fullFlow(mcp, PAT, {}, REFRESH_CLIENT);
const refresh = (clientId: string, token: string, extra: Record<string, string> = {}) =>
  tokenRequest(mcp, {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: token,
    ...extra,
  });

async function codeFor(clientId: string): Promise<{ code: string; verifier: string }> {
  const { verifier, challenge } = pkce();
  const auth = await fetch(authorizeUrl(mcp, clientId, challenge), { redirect: "manual" });
  const cb = await callback(mcp, { request: pendingRequest(auth), pat: PAT });
  const code = new URL(cb.headers.get("location") ?? "").searchParams.get("code") ?? "";
  return { code, verifier };
}

describe("authorization-server metadata", () => {
  it("states the grant list explicitly and serves it with CORS", async () => {
    const res = await fetch(`${mcp.url}/.well-known/oauth-authorization-server`);
    const body = await jsonOf(res);
    expect(body.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(body.token_endpoint).toBe(`${mcp.url}/token`);
    expect(body.revocation_endpoint).toBeUndefined();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("advertises no grant the token endpoint refuses", async () => {
    const meta = await jsonOf(await fetch(`${mcp.url}/.well-known/oauth-authorization-server`));
    const { clientId, refreshToken } = await refreshFlow();
    expect(refreshToken).toBeTruthy();
    for (const grant of meta.grant_types_supported as string[]) {
      const res =
        grant === "refresh_token"
          ? await refresh(clientId, refreshToken ?? "")
          : await tokenRequest(mcp, { grant_type: grant, client_id: clientId });
      expect((await jsonOf(res)).error).not.toBe("unsupported_grant_type");
    }
  });
});

describe("code exchange issues a refresh token", () => {
  it("returns a one-hour access token and a sealed refresh token for a refresh-capable client", async () => {
    const flow = await refreshFlow();
    expect(flow.refreshToken).toBeTruthy();
    expect(backend.families.size).toBe(1);
    const family = [...backend.families.values()][0];
    const body = open<Record<string, unknown>>(mcp.config.keys, "refresh", flow.refreshToken ?? "");
    expect(Object.keys(body).sort()).toEqual(
      ["clientIdHash", "exp", "familyId", "jti", "kind", "pat", "resource"].sort(),
    );
    expect(body.familyId).toBe(family?.id);
    expect(family?.currentJtiHash).toBe(sha(String(body.jti)));
    expect(JSON.stringify([...backend.families.values()])).not.toContain(String(body.jti));
    expect(body.clientIdHash).toBe(sha(flow.clientId));
  });

  it("reports expires_in 3600 and seals a one-hour access token", async () => {
    const client = await jsonOf(await register(mcp, REFRESH_CLIENT));
    const { code, verifier } = await codeFor(client.client_id);
    const res = await tokenRequest(mcp, {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    });
    const body = await jsonOf(res);
    expect(body.expires_in).toBe(3600);
    const access = open<{ exp: number }>(mcp.config.keys, "access", body.access_token);
    expect(access.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(3600);
    expect(access.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(3590);
  });

  it("issues no refresh token and creates no family for a client without the grant", async () => {
    const flow = await fullFlow(mcp, PAT);
    expect(flow.refreshToken).toBeUndefined();
    expect(backend.families.size).toBe(0);
    expect(backend.familyBodies).toHaveLength(0);
  });

  it("seals the canonical resource even when the client sent none, and caps exp at the family expiry", async () => {
    backend.familyExpiresAt = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    const flow = await refreshFlow();
    const family = [...backend.families.values()][0];
    expect(family?.resource).toBe(`${mcp.url}/mcp`);
    const body = open<{ resource: string; exp: number }>(
      mcp.config.keys,
      "refresh",
      flow.refreshToken ?? "",
    );
    expect(body.resource).toBe(`${mcp.url}/mcp`);
    expect(body.exp).toBe(Math.floor(Date.parse(backend.familyExpiresAt) / 1000));
  });

  it("seals exp 30 days out when the family outlives that", async () => {
    const flow = await refreshFlow();
    const body = open<{ exp: number }>(mcp.config.keys, "refresh", flow.refreshToken ?? "");
    const days = (body.exp - Math.floor(Date.now() / 1000)) / 86400;
    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThanOrEqual(30);
  });

  it("answers invalid_grant with no tokens when the backend says the PAT is revoked (401)", async () => {
    backend.familyOverride.create = 401;
    const flow = await refreshFlow();
    expect(flow.accessToken).toBeUndefined();
  });

  it.each([
    [400, "400"],
    [403, "403"],
    [404, "404"],
    [429, "429"],
    [500, "500"],
    [503, "503"],
    ["reset", "network error"],
    ["hang", "timeout"],
  ] as const)(
    "still issues the access token, without a refresh token, when family creation fails (%s %s)",
    async (override, _label) => {
      backend.familyOverride.create = override;
      const flow = await refreshFlow();
      expect(flow.accessToken).toBeTruthy();
      expect(flow.refreshToken).toBeUndefined();
      expect((await mcpPost(mcp, flow.accessToken, LIST)).status).toBe(200);
      expect(mcp.logs.join("\n")).not.toContain(PAT);
    },
  );
});

describe("refresh grant", () => {
  it("rotates: a new pair works and the old refresh token is refused", async () => {
    const flow = await refreshFlow();
    const res = await refresh(flow.clientId, flow.refreshToken ?? "");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.expires_in).toBe(3600);
    expect(body.refresh_token).toBeTruthy();
    expect(body.refresh_token).not.toBe(flow.refreshToken);
    expect((await mcpPost(mcp, body.access_token, LIST)).status).toBe(200);
    expect([...backend.families.values()][0]?.generation).toBe(1);
    const again = await refresh(flow.clientId, flow.refreshToken ?? "");
    expect(again.status).toBe(400);
    expect((await jsonOf(again)).error).toBe("invalid_grant");
  });

  it("treats reuse as theft: refuses the newest token and revokes the PAT", async () => {
    const flow = await refreshFlow();
    const next = await jsonOf(await refresh(flow.clientId, flow.refreshToken ?? ""));
    const replay = await refresh(flow.clientId, flow.refreshToken ?? "");
    expect((await jsonOf(replay)).error).toBe("invalid_grant");
    const newest = await refresh(flow.clientId, next.refresh_token);
    expect(newest.status).toBe(400);
    expect((await jsonOf(newest)).error).toBe("invalid_grant");
    expect(backend.pats.has(PAT)).toBe(false);
  });

  it("refuses another client's refresh token and rotates nothing", async () => {
    const flow = await refreshFlow();
    const other = await fullFlow(mcp, PAT, {}, REFRESH_CLIENT);
    const before = [...backend.families.values()].map((f) => f.generation);
    const res = await refresh(other.clientId, flow.refreshToken ?? "");
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid_grant");
    expect([...backend.families.values()].map((f) => f.generation)).toEqual(before);
    expect((await refresh(flow.clientId, flow.refreshToken ?? "")).status).toBe(200);
  });

  it("refuses a foreign resource with invalid_target and rotates nothing", async () => {
    const flow = await refreshFlow();
    const res = await refresh(flow.clientId, flow.refreshToken ?? "", {
      resource: "https://elsewhere.example/mcp",
    });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid_target");
    expect([...backend.families.values()][0]?.generation).toBe(0);
  });

  it("accepts the canonical resource with a trailing slash", async () => {
    const flow = await refreshFlow();
    const res = await refresh(flow.clientId, flow.refreshToken ?? "", {
      resource: `${mcp.url}/mcp/`,
    });
    expect(res.status).toBe(200);
  });

  it("refuses an expired refresh token without calling the backend", async () => {
    const flow = await refreshFlow();
    const calls = backend.familyBodies.length;
    mcp.skewMs = 31 * 24 * 3600 * 1000;
    const res = await refresh(flow.clientId, flow.refreshToken ?? "");
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid_grant");
    expect(backend.familyBodies).toHaveLength(calls);
  });

  it("refuses a tampered refresh token", async () => {
    const flow = await refreshFlow();
    const token = flow.refreshToken ?? "";
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    const res = await refresh(flow.clientId, tampered);
    expect((await jsonOf(res)).error).toBe("invalid_grant");
  });

  it("refuses an access token presented as a refresh token", async () => {
    const flow = await refreshFlow();
    const res = await refresh(flow.clientId, flow.accessToken);
    expect((await jsonOf(res)).error).toBe("invalid_grant");
  });

  it("answers invalid_grant when the backend says the PAT is gone (401)", async () => {
    const flow = await refreshFlow();
    backend.pats.set(PAT, "revoked");
    const res = await refresh(flow.clientId, flow.refreshToken ?? "");
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error).toBe("invalid_grant");
    expect(JSON.stringify(body)).not.toContain(PAT);
  });

  it("answers 500 server_error when the backend drops the connection, and the same token works on retry", async () => {
    const flow = await refreshFlow();
    backend.familyOverride.rotate = "reset";
    const res = await refresh(flow.clientId, flow.refreshToken ?? "");
    expect(res.status).toBe(500);
    expect((await jsonOf(res)).error).toBe("server_error");
    backend.familyOverride.rotate = undefined;
    expect((await refresh(flow.clientId, flow.refreshToken ?? "")).status).toBe(200);
  });

  it.each([400, 403, 418])(
    "maps an unexpected backend status %s to 500 server_error",
    async (code) => {
      const flow = await refreshFlow();
      backend.familyOverride.rotate = code;
      const res = await refresh(flow.clientId, flow.refreshToken ?? "");
      expect(res.status).toBe(500);
      expect((await jsonOf(res)).error).toBe("server_error");
    },
  );

  it.each([
    [404, "unknown family"],
    [409, "expired"],
  ])("maps a backend %s (%s) to invalid_grant", async (code) => {
    const flow = await refreshFlow();
    backend.familyOverride.rotate = code;
    const res = await refresh(flow.clientId, flow.refreshToken ?? "");
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid_grant");
  });

  it("keeps working after a backend 429, and never logs token material", async () => {
    const flow = await refreshFlow();
    backend.familyOverride.rotate = 429;
    expect((await refresh(flow.clientId, flow.refreshToken ?? "")).status).toBe(500);
    backend.familyOverride.rotate = undefined;
    expect((await refresh(flow.clientId, flow.refreshToken ?? "")).status).toBe(200);
    const logs = mcp.logs.join("\n");
    expect(logs).not.toContain(flow.refreshToken ?? "x");
    expect(logs).not.toContain(PAT);
  });
});
