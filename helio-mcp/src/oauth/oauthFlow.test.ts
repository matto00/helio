import {
  REDIRECT_URI,
  jsonOf,
  authorizeUrl,
  callback,
  fullFlow,
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

let backend: StubBackend;
let mcp: McpHarness;

beforeEach(async () => {
  backend = await startBackend();
  backend.pats.set("helio_pat_alice", "live");
  mcp = await startMcp(backend);
});
afterEach(async () => {
  await mcp.close();
  await backend.close();
});

async function clientId(meta: Record<string, unknown> = {}): Promise<string> {
  return ((await (await register(mcp, meta)).json()) as { client_id: string }).client_id;
}

describe("discovery and registration", () => {
  it("serves both protected-resource documents and AS metadata", async () => {
    const a = await jsonOf(await fetch(`${mcp.url}/.well-known/oauth-protected-resource`));
    const b = await jsonOf(await fetch(`${mcp.url}/.well-known/oauth-protected-resource/mcp`));
    expect(a).toMatchObject({ resource: `${mcp.url}/mcp` });
    expect(a.authorization_servers).toEqual(b.authorization_servers);
    expect(a.resource).toBe(b.resource);
    const as = await jsonOf(await fetch(`${mcp.url}/.well-known/oauth-authorization-server`));
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.registration_endpoint).toBe(`${mcp.url}/register`);
  });

  it.each([{}, { token_endpoint_auth_method: "client_secret_post" }])(
    "issues no client secret (%j) and /token works without one",
    async (meta) => {
      const res = await register(mcp, meta);
      expect(res.status).toBe(201);
      const body = await jsonOf(res);
      expect(body.client_secret).toBeUndefined();
      expect(body.client_secret_expires_at).toBeUndefined();
      expect(body.token_endpoint_auth_method).toBe("none");
      const flow = await fullFlow(mcp, "helio_pat_alice");
      expect(flow.accessToken).toBeTruthy();
    },
  );

  it("rejects a plain-http non-loopback redirect URI and accepts loopback http", async () => {
    const bad = await register(mcp, { redirect_uris: ["http://attacker.example/cb"] });
    expect(bad.status).toBe(400);
    expect((await jsonOf(bad)).error).toBe("invalid_client_metadata");
    expect((await register(mcp, { redirect_uris: ["http://localhost:3000/cb"] })).status).toBe(201);
  });

  it("rejects hosts outside the allow-list, and re-applies it at authorize", async () => {
    const strict = await startMcp(backend, { HELIO_MCP_ALLOWED_REDIRECT_HOSTS: "claude.ai" });
    try {
      const ok = await register(strict, { redirect_uris: ["https://claude.ai/cb"] });
      expect(ok.status).toBe(201);
      const no = await register(strict, { redirect_uris: ["https://evil.example/cb"] });
      expect(no.status).toBe(400);
    } finally {
      await strict.close();
    }
    // Client registered under a wide list, then the same key with a narrowed list.
    const wide = await startMcp(backend, {
      HELIO_MCP_ALLOWED_REDIRECT_HOSTS: "claude.ai,other.example",
    });
    const reg = await jsonOf(await register(wide, { redirect_uris: ["https://other.example/cb"] }));
    const narrow = await startMcp(backend, {
      HELIO_MCP_ALLOWED_REDIRECT_HOSTS: "claude.ai",
      HELIO_MCP_TOKEN_KEY: wide.config.keys.current.toString("base64"),
    });
    try {
      const u = new URL(authorizeUrl(narrow, reg.client_id, pkce().challenge));
      u.searchParams.set("redirect_uri", "https://other.example/cb");
      const res = await fetch(u, { redirect: "manual" });
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
    } finally {
      await wide.close();
      await narrow.close();
    }
  });

  it("refuses a forged client id without redirecting to the consent page", async () => {
    const res = await fetch(authorizeUrl(mcp, "forged-client-id", pkce().challenge), {
      redirect: "manual",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("refuses an over-long state and a wrong resource", async () => {
    const id = await clientId();
    const long = await fetch(authorizeUrl(mcp, id, pkce().challenge, { state: "x".repeat(1025) }), {
      redirect: "manual",
    });
    expect(long.status).toBe(400);
    expect(long.headers.get("location")).toBeNull();
    const wrong = await fetch(
      authorizeUrl(mcp, id, pkce().challenge, { resource: "https://elsewhere.example/mcp" }),
      { redirect: "manual" },
    );
    expect(wrong.status).toBe(302);
    expect(new URL(wrong.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "invalid_target",
    );
  });

  it("accepts the canonical resource with a trailing slash", async () => {
    const id = await clientId();
    const res = await fetch(
      authorizeUrl(mcp, id, pkce().challenge, { resource: `${mcp.url}/mcp/` }),
      { redirect: "manual" },
    );
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/connect/mcp");
  });
});

describe("authorize, callback and token", () => {
  it("redirects to the consent page and serves CORS-restricted pending info", async () => {
    const id = await clientId({ client_name: "Claude\u0007 " + "n".repeat(100) });
    const res = await fetch(authorizeUrl(mcp, id, pkce().challenge), { redirect: "manual" });
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.origin).toBe(mcp.appUrl);
    expect(loc.pathname).toBe("/connect/mcp");
    const info = await fetch(`${mcp.url}/oauth/pending?request=${pendingRequest(res)}`, {
      headers: { Origin: mcp.appUrl },
    });
    expect(info.headers.get("access-control-allow-origin")).toBe(mcp.appUrl);
    expect(info.headers.get("access-control-allow-credentials")).toBeNull();
    const body = await jsonOf(info);
    expect(body.redirectHost).toBe("127.0.0.1:9");
    expect(body.clientName.length).toBeLessThanOrEqual(40);
    expect(body.clientName.includes("\u0007")).toBe(false);
    expect(typeof body.expiresAt).toBe("number");
    const other = await fetch(`${mcp.url}/oauth/pending?request=${pendingRequest(res)}`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(other.headers.get("access-control-allow-origin")).toBe(mcp.appUrl);
    expect((await fetch(`${mcp.url}/oauth/pending?request=junk`)).status).toBe(400);
  });

  it("completes the flow WITHOUT resource and /mcp then succeeds", async () => {
    const { accessToken } = await fullFlow(mcp, "helio_pat_alice");
    const res = await mcpPost(mcp, accessToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "t", version: "0" },
      },
    });
    expect(res.status).toBe(200);
  });

  it("denial redirects with access_denied and state; mints no code", async () => {
    const id = await clientId();
    const auth = await fetch(authorizeUrl(mcp, id, pkce().challenge), { redirect: "manual" });
    const cb = await callback(mcp, { request: pendingRequest(auth), deny: "1" });
    const loc = new URL(cb.headers.get("location") ?? "");
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("state")).toBe("st-1");
    expect(loc.searchParams.get("code")).toBeNull();
  });

  it("rejects an invalid, a scoped and an unreachable-backend PAT with an escaped error page", async () => {
    backend.pats.set("helio_pat_scoped", "scoped");
    const id = await clientId({ client_name: "<script>alert(1)</script>" });
    const auth = await fetch(authorizeUrl(mcp, id, pkce().challenge), { redirect: "manual" });
    const request = pendingRequest(auth);
    for (const pat of ["helio_pat_unknown", "helio_pat_scoped", "not-a-pat"]) {
      const res = await callback(mcp, { request, pat });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers.get("location")).toBeNull();
      const html = await res.text();
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("MCP connector:");
      expect(res.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("refuses an expired pending request at the callback and the info endpoint", async () => {
    const id = await clientId();
    const auth = await fetch(authorizeUrl(mcp, id, pkce().challenge), { redirect: "manual" });
    const request = pendingRequest(auth);
    mcp.skewMs = 11 * 60_000;
    try {
      const cb = await callback(mcp, { request, pat: "helio_pat_alice" });
      expect(cb.status).toBe(400);
      expect(cb.headers.get("location")).toBeNull();
      expect((await fetch(`${mcp.url}/oauth/pending?request=${request}`)).status).toBe(400);
    } finally {
      mcp.skewMs = 0;
    }
  });

  async function codeFor(
    verifierOverride?: string,
  ): Promise<{ id: string; code: string; verifier: string }> {
    const id = await clientId();
    const { verifier, challenge } = pkce();
    const auth = await fetch(authorizeUrl(mcp, id, challenge), { redirect: "manual" });
    const cb = await callback(mcp, { request: pendingRequest(auth), pat: "helio_pat_alice" });
    const code = new URL(cb.headers.get("location") ?? "").searchParams.get("code") ?? "";
    return { id, code, verifier: verifierOverride ?? verifier };
  }

  it("rejects a wrong verifier and a replayed code", async () => {
    const wrong = await codeFor();
    const bad = await tokenRequest(mcp, {
      grant_type: "authorization_code",
      client_id: wrong.id,
      code: wrong.code,
      code_verifier: "x".repeat(50),
      redirect_uri: REDIRECT_URI,
    });
    expect(bad.status).toBe(400);
    expect((await jsonOf(bad)).error).toBe("invalid_grant");

    const c = await codeFor();
    const form = {
      grant_type: "authorization_code",
      client_id: c.id,
      code: c.code,
      code_verifier: c.verifier,
      redirect_uri: REDIRECT_URI,
    };
    expect((await tokenRequest(mcp, form)).status).toBe(200);
    const replay = await tokenRequest(mcp, form);
    expect(replay.status).toBe(400);
  });

  it("accepts an omitted redirect_uri at /token but not a different one; no refresh grant", async () => {
    const c = await codeFor();
    const mismatch = await tokenRequest(mcp, {
      grant_type: "authorization_code",
      client_id: c.id,
      code: c.code,
      code_verifier: c.verifier,
      redirect_uri: "http://127.0.0.1:9/other",
    });
    expect(mismatch.status).toBe(400);
    const c2 = await codeFor();
    const ok = await tokenRequest(mcp, {
      grant_type: "authorization_code",
      client_id: c2.id,
      code: c2.code,
      code_verifier: c2.verifier,
    });
    expect(ok.status).toBe(200);
    const body = await jsonOf(ok);
    expect(body.refresh_token).toBeUndefined();
    expect(body.expires_in).toBe(90 * 24 * 3600);
    const refresh = await tokenRequest(mcp, {
      grant_type: "refresh_token",
      client_id: c2.id,
      refresh_token: "x",
    });
    expect(refresh.status).toBe(400);
  });

  it("refuses a code issued to another client", async () => {
    const c = await codeFor();
    const otherId = await clientId();
    const res = await tokenRequest(mcp, {
      grant_type: "authorization_code",
      client_id: otherId,
      code: c.code,
      code_verifier: c.verifier,
      redirect_uri: REDIRECT_URI,
    });
    expect(res.status).toBe(400);
  });

  it("does not accept an authorization code as an access token", async () => {
    const c = await codeFor();
    const res = await mcpPost(mcp, c.code, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
  });
});
