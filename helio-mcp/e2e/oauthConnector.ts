/**
 * HEL-1709 task 6.1: the MCP SDK's own OAuth client against the real Helio backend and the built HTTP
 * entry (`dist/http.js`), end to end:
 *
 *   register (DCR) -> authorize -> consent-equivalent calls -> token -> listTools ->
 *   create_content_panel (markdown) -> panel read back over REST as that user -> a second user cannot see
 *   it -> revoke the PAT: a tool error inside the liveness window, then 401 after it -> 401 checks.
 *
 * Usage (backend on BACKEND_URL, default http://localhost:8080; `npm run build` first):
 *   BACKEND_URL=http://localhost:10048 npx tsx e2e/oauthConnector.ts
 *
 * The "consent page" is replaced by what it does: mint a named 90-day PAT with the user's session cookie,
 * then POST it to /oauth/callback (the real browser pass is e2e/connectMcpBrowser in the repo-root e2e/).
 * Throwaway users are registered per run; the sealing key is generated per run; no token, PAT or key is
 * printed.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const BACKEND = (process.env.BACKEND_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const MCP_PORT = 19000 + Math.floor(Math.random() * 500);
const MCP = `http://127.0.0.1:${MCP_PORT}`;
const APP = process.env.APP_URL ?? "http://localhost:5173";
const REDIRECT = "http://127.0.0.1:9/cb";
const CSRF = { "X-Helio-Requested-With": "1" };
const TTL_SECONDS = 2;

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

interface Session {
  userId: string;
  cookie: string;
}

async function registerUser(label: string): Promise<Session> {
  const email = `hel1709-${label}-${randomBytes(4).toString("hex")}@example.com`;
  const res = await fetch(`${BACKEND}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: randomBytes(12).toString("hex"), displayName: label }),
  });
  if (res.status !== 201) throw new Error(`register failed: HTTP ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .find((c) => c.startsWith("helio_session="))
    ?.split(";")[0];
  const user = ((await res.json()) as { user?: { id?: string } }).user;
  if (!cookie || !user?.id) throw new Error("register: no session cookie or user id");
  return { userId: user.id, cookie };
}

/** Every PAT this run mints, so the `finally` can revoke them all (CONTRIBUTING.md, HEL-846 rule 2). */
const minted: { session: Session; id: string }[] = [];

async function revokeMinted(): Promise<void> {
  for (const { session, id } of minted) {
    try {
      const res = await fetch(`${BACKEND}/api/tokens/${id}`, {
        method: "DELETE",
        headers: { Cookie: session.cookie, ...CSRF },
      });
      // 204 revoked now, 404 already revoked (alice's, by the revocation check): both are fine.
      console.log(`cleanup: PAT ${id} revoke -> HTTP ${res.status}`);
    } catch (err) {
      console.log(`cleanup: PAT ${id} revoke failed: ${(err as Error).message}`);
    }
  }
}

async function mintConnectorPat(s: Session): Promise<{ id: string; token: string }> {
  const res = await fetch(`${BACKEND}/api/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: s.cookie, ...CSRF },
    body: JSON.stringify({ name: "MCP connector: e2e client (127.0.0.1:9)", expiresInDays: 90 }),
  });
  const body = (await res.json()) as { id?: string; token?: string };
  if (res.status >= 300 || !body.id || !body.token) throw new Error(`mint PAT: HTTP ${res.status}`);
  minted.push({ session: s, id: body.id });
  return { id: body.id, token: body.token };
}

/** An in-memory OAuth client provider that captures the authorization redirect. */
class MemoryProvider implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined;
  stored: OAuthTokens | undefined;
  verifier = "";
  authorizationUrl: URL | undefined;
  readonly redirectUrl = REDIRECT;
  readonly clientMetadata: OAuthClientMetadata = {
    client_name: "HEL-1709 e2e client",
    redirect_uris: [REDIRECT],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
  };
  clientInformation = () => this.info;
  saveClientInformation = (i: OAuthClientInformationMixed) => {
    this.info = i;
  };
  tokens = () => this.stored;
  saveTokens = (t: OAuthTokens) => {
    this.stored = t;
  };
  redirectToAuthorization = (url: URL) => {
    this.authorizationUrl = url;
  };
  saveCodeVerifier = (v: string) => {
    this.verifier = v;
  };
  codeVerifier = () => this.verifier;
}

function transportFor(provider: MemoryProvider): StreamableHTTPClientTransport {
  const opts: StreamableHTTPClientTransportOptions = { authProvider: provider };
  return new StreamableHTTPClientTransport(new URL(`${MCP}/mcp`), opts);
}

/** Connect with the SDK's OAuth flow; `session` plays the signed-in browser user on the consent page. */
async function connectViaOAuth(
  session: Session,
  label: string,
): Promise<{ client: Client; provider: MemoryProvider; patId: string }> {
  const provider = new MemoryProvider();
  let transport = transportFor(provider);
  let client = new Client({ name: `e2e-${label}`, version: "0" });
  let needed = false;
  try {
    await client.connect(transport);
  } catch (err) {
    needed = err instanceof UnauthorizedError;
    if (!needed) throw err;
  }
  check(`${label}: first connect needs authorization (401 -> discovery -> registration)`, needed);
  const authUrl = provider.authorizationUrl;
  if (!authUrl) throw new Error("no authorization redirect captured");
  check(`${label}: client id was registered dynamically`, !!provider.info?.client_id);
  check(
    `${label}: public client, no secret issued`,
    provider.info !== undefined &&
      !("client_secret" in provider.info && provider.info.client_secret),
  );

  // /authorize was already requested by the SDK's redirect URL; replay it to reach the consent redirect.
  const hop = await fetch(authUrl, { redirect: "manual" });
  const consent = new URL(hop.headers.get("location") ?? "http://invalid");
  check(
    `${label}: /authorize redirects to the Helio consent page`,
    hop.status === 302 && consent.origin === APP && consent.pathname === "/connect/mcp",
  );
  const request = consent.searchParams.get("request") ?? "";

  const pending = await fetch(`${MCP}/oauth/pending?request=${encodeURIComponent(request)}`, {
    headers: { Origin: APP },
  });
  const info = (await pending.json()) as { clientName?: string; redirectHost?: string };
  check(
    `${label}: consent info shows client name + redirect host`,
    info.clientName === "HEL-1709 e2e client" && info.redirectHost === "127.0.0.1:9",
  );

  const pat = await mintConnectorPat(session);
  const cb = await fetch(`${MCP}/oauth/callback`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request, pat: pat.token }).toString(),
  });
  const back = new URL(cb.headers.get("location") ?? "http://invalid");
  const code = back.searchParams.get("code");
  check(
    `${label}: callback redirects to the client with a code and the original state`,
    cb.status === 302 &&
      !!code &&
      back.searchParams.get("state") === authUrl.searchParams.get("state"),
  );

  await transport.finishAuth(code ?? "");
  check(`${label}: token exchange stored an access token`, !!provider.stored?.access_token);
  await client.close().catch(() => undefined);

  transport = transportFor(provider);
  client = new Client({ name: `e2e-${label}`, version: "0" });
  await client.connect(transport);
  return { client, provider, patId: pat.id };
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

async function main(): Promise<void> {
  const key = randomBytes(32).toString("base64");
  const child: ChildProcess = spawn("node", ["dist/http.js"], {
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "production",
      PORT: String(MCP_PORT),
      HELIO_MCP_PUBLIC_URL: MCP,
      HELIO_APP_URL: APP,
      HELIO_API_BASE_URL: BACKEND,
      HELIO_MCP_TOKEN_KEY: key,
      HELIO_MCP_LIVENESS_TTL_SECONDS: String(TTL_SECONDS),
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    await new Promise((r) => setTimeout(r, 1500));

    // 401 checks first: no credential.
    const anon = await fetch(`${MCP}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const www = anon.headers.get("www-authenticate") ?? "";
    check(
      "no token: 401 with WWW-Authenticate resource_metadata",
      anon.status === 401 &&
        www.includes(`resource_metadata="${MCP}/.well-known/oauth-protected-resource/mcp"`),
    );

    const alice = await registerUser("alice");
    const a = await connectViaOAuth(alice, "alice");

    const tools = await a.client.listTools();
    const names = tools.tools.map((t) => t.name);
    check(
      "alice: listTools returns the helio tool set",
      names.includes("create_content_panel") && names.length > 10,
      `${names.length} tools`,
    );

    const dash = await a.client.callTool({
      name: "create_dashboard",
      arguments: { name: `HEL-1709 e2e ${randomBytes(3).toString("hex")}` },
    });
    const dashboardId = (JSON.parse(textOf(dash)) as { id: string }).id;
    check("alice: create_dashboard via MCP", !!dashboardId);

    const marker = `morning-brief-${randomBytes(4).toString("hex")}`;
    const panel = await a.client.callTool({
      name: "create_content_panel",
      arguments: {
        dashboardId,
        type: "markdown",
        title: "Morning brief",
        config: { content: `# Morning brief\n\n${marker}` },
      },
    });
    check(
      "alice: create_content_panel (markdown) succeeded",
      !(panel as { isError?: boolean }).isError,
      textOf(panel).slice(0, 80),
    );

    const read = await fetch(`${BACKEND}/api/dashboards/${dashboardId}/panels`, {
      headers: { Cookie: alice.cookie },
    });
    const panelsBody = await read.text();
    check(
      "alice: panel read back over REST as that user (markdown content present)",
      read.status === 200 && panelsBody.includes(marker),
      `HTTP ${read.status}`,
    );

    const bob = await registerUser("bob");
    const b = await connectViaOAuth(bob, "bob");
    const bList = textOf(await b.client.callTool({ name: "list_dashboards", arguments: {} }));
    check("bob: sees none of alice's dashboards (isolation)", !bList.includes(dashboardId));
    const bRead = await fetch(`${BACKEND}/api/dashboards/${dashboardId}/panels`, {
      headers: { Cookie: bob.cookie },
    });
    check(
      "bob: alice's dashboard panels are not readable by bob over REST",
      bRead.status === 404 || bRead.status === 403,
      `HTTP ${bRead.status}`,
    );
    await b.client.close();

    // Tampered token.
    const good = a.provider.stored?.access_token ?? "";
    const tampered = good.slice(0, -2) + (good.endsWith("AA") ? "BB" : "AA");
    const t = await fetch(`${MCP}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${tampered}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    check("tampered token: 401", t.status === 401);

    // Revocation: refresh the liveness entry, revoke, call inside the window, then past it.
    await a.client.callTool({ name: "list_dashboards", arguments: {} });
    const del = await fetch(`${BACKEND}/api/tokens/${a.patId}`, {
      method: "DELETE",
      headers: { Cookie: alice.cookie, ...CSRF },
    });
    check("alice: PAT revoked through Settings' endpoint", del.status < 300, `HTTP ${del.status}`);
    const inside = await a.client.callTool({ name: "list_dashboards", arguments: {} });
    check(
      `revoked PAT inside the ${TTL_SECONDS}s liveness window: tool error telling the user to reconnect`,
      (inside as { isError?: boolean }).isError === true && /reconnect/i.test(textOf(inside)),
      textOf(inside).slice(0, 90),
    );
    await new Promise((r) => setTimeout(r, (TTL_SECONDS + 1) * 1000));
    const after = await fetch(`${MCP}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${good}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    check(
      "revoked PAT after the window: 401 with error=invalid_token",
      after.status === 401 &&
        (after.headers.get("www-authenticate") ?? "").includes('error="invalid_token"'),
    );
    await a.client.close().catch(() => undefined);
  } finally {
    await revokeMinted();
    child.kill("SIGTERM");
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`e2e crashed: ${(err as Error).message}`);
  process.exit(2);
});
