/**
 * Direct-HTTP side of the verify harness: PAT mint/revoke and the exact-id fixture ledger.
 * Deliberately NOT routed through the MCP server under test, so teardown does not depend on it
 * still being alive.
 */

export interface MintedToken {
  id: string;
  token: string;
}

export interface Ledger {
  pipelineIds: string[];
  sourceIds: string[];
}

export function newLedger(): Ledger {
  return { pipelineIds: [], sourceIds: [] };
}

async function http(
  baseUrl: string,
  bearer: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? safeParse(text) : null };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** `expiresInDays: 1` is the crash backstop: a run killed before `finally` still self-expires. */
export async function mintRunToken(
  baseUrl: string,
  bootstrapPat: string,
  runId: string,
): Promise<MintedToken> {
  const res = await http(baseUrl, bootstrapPat, "POST", "/api/tokens", {
    name: `HEL-1264 verify ${runId}`,
    expiresInDays: 1,
  });
  const created = res.json as { id?: string; token?: string };
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`mint token failed: HTTP ${res.status} ${JSON.stringify(res.json)}`);
  }
  if (!created.id || !created.token) throw new Error("mint token: response lacked id/token");
  return { id: created.id, token: created.token };
}

async function deleteAndConfirm(
  baseUrl: string,
  pat: string,
  kind: string,
  id: string,
  deletePath: string,
  getPath: string,
  log: (line: string) => void,
): Promise<string | null> {
  const del = await http(baseUrl, pat, "DELETE", deletePath);
  if (del.status >= 300 && del.status !== 404) {
    return `${kind} ${id}: DELETE returned HTTP ${del.status}`;
  }
  const after = await http(baseUrl, pat, "GET", getPath);
  if (after.status !== 404)
    return `${kind} ${id}: GET after delete returned HTTP ${after.status}, expected 404`;
  log(`  deleted ${kind} ${id} (confirmed 404)`);
  return null;
}

/** Pipelines first (a source with a rooting pipeline cannot be deleted), then sources, then the PAT. */
export async function teardown(
  baseUrl: string,
  bootstrapPat: string,
  ledger: Ledger,
  minted: MintedToken | null,
  log: (line: string) => void,
): Promise<string[]> {
  const failures: string[] = [];
  const record = (f: string | null): void => {
    if (f) failures.push(f);
  };
  for (const id of ledger.pipelineIds) {
    record(
      await deleteAndConfirm(
        baseUrl,
        bootstrapPat,
        "pipeline",
        id,
        `/api/pipelines/${id}`,
        `/api/pipelines/${id}`,
        log,
      ),
    );
  }
  // No GET /api/data-sources/:id exists (405); the declared-schema read 404s once the source is gone.
  for (const id of ledger.sourceIds) {
    record(
      await deleteAndConfirm(
        baseUrl,
        bootstrapPat,
        "data source",
        id,
        `/api/data-sources/${id}`,
        `/api/data-sources/${id}/schema`,
        log,
      ),
    );
  }
  if (minted) {
    const del = await http(baseUrl, bootstrapPat, "DELETE", `/api/tokens/${minted.id}`);
    if (del.status >= 300) {
      failures.push(`token ${minted.id}: revoke returned HTTP ${del.status}`);
    } else {
      const probe = await http(baseUrl, minted.token, "GET", "/api/pipelines");
      if (probe.status !== 401) {
        failures.push(
          `token ${minted.id}: still authenticates after revoke (HTTP ${probe.status})`,
        );
      } else {
        log(`  revoked token ${minted.id} (confirmed 401)`);
      }
    }
  }
  return failures;
}
