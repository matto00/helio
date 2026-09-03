/**
 * MCP E2E: an MCP-only client authors a working REST source against an unauthenticated host,
 * from a workspace with ZERO Connectors, using only MCP tools (HEL-886, design.md Decision 8).
 *
 * THREE EXPLICITLY SEPARATED PHASES (Decision 8 / AC5's "no out-of-band HTTP call" claim):
 *
 *   SETUP (out-of-band, pre-measurement) — registers a run-unique throwaway user via
 *   `POST /api/auth/register`, then mints a PAT via `POST /api/tokens` using that user's
 *   session cookie. This user's Connector list is genuinely empty by construction, so
 *   `list_connectors` returning empty + the discoverability hint is a REAL precondition, true
 *   on every run, with no cross-run interference in the shared dev Postgres. Connectors carry
 *   no `tag` column (`WorkspaceTeardownService` never touches them, no `delete_connector` tool
 *   exists) so a tag-based script would orphan a row per run AND destroy its own
 *   zero-Connector precondition on run 2 — a fresh throwaway user is the actual mechanism, not
 *   a scripting convenience.
 *
 *   MEASURED — spawns the MCP server under that PAT and reaches the backend ONLY through the
 *   spawned child process over stdio: list_connectors (empty + hint) -> create_connector ->
 *   create_rest_data_source -> create_pipeline -> run_pipeline -> get_output_rows, all as MCP
 *   tool calls. This phase holds no HTTP client and issues no PAT-bearing fetch of its own —
 *   the setup/teardown phases that do issue HTTP are separate functions run before/after this
 *   window and are excluded from it by construction, not by assertion about the script's own
 *   source.
 *
 *   TEARDOWN (out-of-band, post-measurement) — deletes the created Connector via
 *   `DELETE /api/connectors/:id`. The data source, pipeline, Output, throwaway user and its PAT
 *   are NOT reclaimed — all are partitioned under the disposable per-run user, so none can
 *   affect a later run or a human's workspace. The claim is "nothing leaks across runs", not
 *   "nothing is left behind".
 *
 * REAL PUBLIC EGRESS IS REQUIRED (Decision 8 / skeptic-design-2 CR1): HEL-879's
 * `checkCreateTimeEgress` rejects loopback/link-local/private addresses, so a local stub HTTP
 * server cannot be the create_connector target at all — a credential-less REST Connector
 * against a REACHABLE host is the literal thing AC1/AC5 require this script to prove. The
 * measured phase targets `https://api.sleeper.app` (`/v1/state/nfl`, no credential, the same
 * API family as the HEL-857 rebuild that produced this ticket). This script PREFLIGHTS
 * reachability of that host before the measured phase and exits NON-ZERO with a diagnosable
 * message when it is unreachable -- it never downgrades to a static source, never skips, and
 * never reports success on an absent network (a failed run, not a passed one).
 *
 * Run with HELIO_API_BASE_URL pointing at a running backend:
 *
 *   npm run build
 *   HELIO_API_BASE_URL=http://localhost:8080 node dist-e2e/connector-authoring.js
 *
 * (Compile via `npx tsc e2e/connector-authoring.ts --outDir dist-e2e --module nodenext
 * --target es2022 --moduleResolution nodenext`, mirroring `sleeper-rebuild.ts`'s own
 * standalone-script precedent.)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/index.js");

const SLEEPER_BASE_URL = "https://api.sleeper.app";
const SLEEPER_ENDPOINT = "/v1/state/nfl";

type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

function hasContent(
  result: ToolCallResult,
): result is Extract<ToolCallResult, { content: unknown }> {
  return Array.isArray((result as { content?: unknown }).content);
}

function textOf(r: ToolCallResult): string {
  if (!hasContent(r)) return "";
  return r.content.find((c) => c.type === "text")?.text ?? "";
}

function firstTextOf(r: ToolCallResult): string {
  return textOf(r);
}

function isErrorOf(r: ToolCallResult): boolean {
  return hasContent(r) ? Boolean(r.isError) : false;
}

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

function fail(msg: string): never {
  process.stderr.write(`connector-authoring: FAIL: ${msg}\n`);
  process.exit(1);
}

/** Reads the `helio_session` cookie out of a `Set-Cookie` response header. */
function extractSessionCookie(setCookieHeader: string | null): string {
  if (!setCookieHeader) fail("register response carried no Set-Cookie header");
  const match = /helio_session=[^;]+/.exec(setCookieHeader!);
  if (!match) fail(`Set-Cookie header carried no helio_session value: ${setCookieHeader}`);
  return match[0];
}

/** SETUP (out-of-band): register a run-unique throwaway user, mint a PAT via its session
 *  cookie. This is the ONLY place in the script besides teardown that issues an HTTP request
 *  directly -- both run outside the measured window (Decision 8). */
async function setupThrowawayUserAndPat(baseUrl: string): Promise<string> {
  const email = `hel-886-e2e-${randomUUID()}@example.invalid`;
  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple 1!", displayName: null }),
  });
  if (!registerRes.ok) fail(`register failed: ${registerRes.status} ${await registerRes.text()}`);
  const cookie = extractSessionCookie(registerRes.headers.get("set-cookie"));

  const tokenRes = await fetch(`${baseUrl}/api/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      // Session-cookie-authenticated writes require this CSRF header (AuthDirectives.scala
      // design.md D4) -- a PAT-bearer call does not, but this setup phase authenticates via
      // the just-registered session cookie to mint the PAT the measured phase then uses.
      "X-Helio-Requested-With": "1",
    },
    body: JSON.stringify({ name: "hel-886-e2e", expiresInDays: null }),
  });
  if (!tokenRes.ok) fail(`token mint failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const tokenBody = (await tokenRes.json()) as { token: string };
  return tokenBody.token;
}

/** TEARDOWN (out-of-band): delete the created Connector by id. Does NOT reclaim the data
 *  source/pipeline/Output/user/PAT -- see the file header for why that's accepted. */
async function teardownConnector(baseUrl: string, pat: string, connectorId: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/connectors/${connectorId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${pat}` },
  });
  if (!res.ok && res.status !== 404) {
    log(`WARNING: teardown of connector ${connectorId} failed: ${res.status} ${await res.text()}`);
  }
}

/** Decision 8 / skeptic-design-2 CR1: preflights egress to the measured phase's public target
 *  AND that CONNECTOR_MASTER_KEY is set server-side (`credential: ""` still goes through
 *  `secretBackend.encrypt`, so an unset key 500s on the first measured step, skeptic-design-3).
 *  Exits non-zero with a named cause on either failure -- never downgrades, never skips. */
async function preflight(baseUrl: string): Promise<void> {
  try {
    const res = await fetch(`${SLEEPER_BASE_URL}${SLEEPER_ENDPOINT}`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      fail(
        `preflight: ${SLEEPER_BASE_URL}${SLEEPER_ENDPOINT} responded ${res.status} -- this script ` +
          "requires real public-internet egress to a reachable unauthenticated host (Decision 8); " +
          "it never downgrades to a static source and never reports success without it.",
      );
    }
  } catch (err) {
    fail(
      `preflight: could not reach ${SLEEPER_BASE_URL}${SLEEPER_ENDPOINT} (${(err as Error).message}) -- ` +
        "this script requires real public-internet egress (Decision 8): the target host must be " +
        "reachable from this environment. It never downgrades to a static source and never " +
        "reports success on an absent network.",
    );
  }

  // A missing CONNECTOR_MASTER_KEY makes the backend's credential-write path fail hard, even
  // for the literal-empty credential create_connector sends -- surfacing that named cause here
  // (rather than an opaque 500 partway through the measured phase) is the whole point of a
  // preflight. There is no read endpoint for this env var, so we probe the actual code path:
  // a throwaway create_connector-shaped call would require a full setup phase just to check
  // this, so instead this asserts CONNECTOR_MASTER_KEY is set in THIS process's own env when
  // the backend is being run in-process by the same worktree's dev harness (documented
  // requirement, not inferred) -- if it is unset here, the backend process (started
  // separately) is overwhelmingly likely to be missing it too, per this worktree's CLAUDE.md.
  if (!process.env.CONNECTOR_MASTER_KEY) {
    fail(
      "preflight: CONNECTOR_MASTER_KEY is not set in this process's environment. " +
        "create_connector's literal-empty credential still goes through secretBackend.encrypt " +
        "server-side, so an unset key 500s on the first measured step -- set CONNECTOR_MASTER_KEY " +
        "(see CLAUDE.md) before running this script rather than chasing an opaque 500.",
    );
  }

  void baseUrl; // reachability of the Helio backend itself is proven by setup's own fetch calls.
}

async function main(): Promise<void> {
  const baseUrl = process.env.HELIO_API_BASE_URL ?? "http://localhost:8080";

  await preflight(baseUrl);

  log("SETUP: registering a throwaway user + minting a PAT (out-of-band, pre-measurement)...");
  const pat = await setupThrowawayUserAndPat(baseUrl);
  log("SETUP: done.");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { HELIO_API_BASE_URL: baseUrl, HELIO_PAT: pat, PATH: process.env.PATH ?? "" },
  });
  const client = new Client({ name: "helio-mcp-e2e-connector-authoring", version: "0.1.0" });
  await client.connect(transport);

  let connectorId: string | undefined;

  try {
    log("\nMEASURED: reaching the backend ONLY via the spawned MCP child process over stdio.");

    const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const res = await client.callTool({ name, arguments: args });
      if (isErrorOf(res)) fail(`${name} failed: ${firstTextOf(res)}`);
      return JSON.parse(firstTextOf(res)) as T;
    };

    // 1. list_connectors on a genuinely-empty, fresh-user workspace: empty + discoverability hint.
    const listRes = await client.callTool({ name: "list_connectors", arguments: {} });
    if (isErrorOf(listRes)) fail(`list_connectors failed: ${firstTextOf(listRes)}`);
    const connectors = JSON.parse(firstTextOf(listRes)) as unknown[];
    if (connectors.length !== 0) fail(`expected zero Connectors, got ${connectors.length}`);
    const hintBlock = hasContent(listRes)
      ? listRes.content.find((c) => c.type === "text" && c.text.includes("create_connector"))
      : undefined;
    if (!hintBlock) fail("list_connectors' empty result carried no create_connector hint block");
    log("  list_connectors: empty, with create_connector hint -- as expected.");

    // 2. create_connector -- the actual gap this ticket closes.
    const connector = await call<{ id: string; name: string; note: string }>("create_connector", {
      name: "Sleeper (HEL-886 e2e)",
      baseUrl: SLEEPER_BASE_URL,
    });
    connectorId = connector.id;
    if (!connector.note || !connector.note.includes("/connectors")) {
      fail("create_connector's success result carried no /connectors-naming note (Decision 4b(i))");
    }
    log(`  create_connector: id=${connector.id}`);

    // 3. create_rest_data_source against the Connector just created, with NO out-of-band HTTP.
    const source = await call<{
      source: { id: string };
      inferredSchema: unknown;
      fetchError: string | null;
    }>("create_rest_data_source", {
      name: "Sleeper NFL state (HEL-886 e2e)",
      connectorId: connector.id,
      endpoint: SLEEPER_ENDPOINT,
    });

    // 4.7c hard pass criteria (skeptic-design-2 CR2): a fetch-failed source still returns HTTP
    // success, so ALL THREE of these must hold or the run is a FAIL, not a soft warning.
    if (source.inferredSchema === null) {
      fail("create_rest_data_source: inferredSchema is null -- the initial fetch failed (AC5)");
    }
    if (source.fetchError !== null) {
      fail(`create_rest_data_source: fetchError is non-null: ${source.fetchError} (AC5)`);
    }
    log(
      `  create_rest_data_source: source=${source.source.id}, inferredSchema present, fetchError null.`,
    );

    // 5. Build + run a pipeline over the source, produce an Output, and prove it has real rows.
    const pipeline = await call<{ id: string; outputs: Array<{ id: string; name: string }> }>(
      "create_pipeline",
      {
        name: "Sleeper NFL state pipeline (HEL-886 e2e)",
        source: { sourceId: source.source.id },
        outputs: [{ kind: "table", name: "Sleeper NFL state" }],
      },
    );
    const output = pipeline.outputs[0];
    if (!output) fail("create_pipeline returned no Output");
    await call("run_pipeline", { pipelineId: pipeline.id });
    // get_output_rows returns a Paged<Record<string, unknown>> envelope ({items, total,
    // offset, limit}), not a bare {rows} shape.
    const rows = await call<{ items: unknown[] }>("get_output_rows", { outputId: output.id });
    if (rows.items.length === 0) {
      fail(
        "the Output's row set is empty after run_pipeline -- a broken source materializes no rows (AC5)",
      );
    }
    log(`  pipeline=${pipeline.id} output=${output.id} rows=${rows.items.length}`);

    log("\nAll AC5 pass criteria evaluated and satisfied. Zero direct HTTP calls in this phase.");
  } finally {
    await client.close();

    log("\nTEARDOWN: deleting the created Connector (out-of-band, post-measurement)...");
    if (connectorId) await teardownConnector(baseUrl, pat, connectorId);
    log("TEARDOWN: done.");
  }
}

main().catch((err) => {
  process.stderr.write(`connector-authoring: fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
