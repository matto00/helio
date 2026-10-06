/**
 * Throwaway-user bootstrap for the isolated verify run (HEL-1297): register on the isolated backend,
 * mint the bootstrap PAT with that session, revoke it again. The user lives and dies with the dedicated DB.
 */

/** Cookie-authenticated writes need the CSRF header (AuthDirectives.requireCsrfHeader). */
const CSRF = { "X-Helio-Requested-With": "1" };

export interface Bootstrap {
  email: string;
  userId: string;
  cookie: string;
  patId: string;
  pat: string;
}

export async function register(
  baseUrl: string,
  email: string,
  password: string,
): Promise<{ userId: string; cookie: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName: "HEL-1297 verify" }),
  });
  if (res.status !== 201) throw new Error(`register failed: HTTP ${res.status}`);
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("helio_session="));
  const cookie = setCookie?.split(";")[0];
  const user = ((await res.json()) as { user?: { id?: string } }).user;
  if (!cookie || !user?.id)
    throw new Error("register: response lacked the session cookie or user id");
  return { userId: user.id, cookie };
}

export async function mintBootstrapPat(
  baseUrl: string,
  cookie: string,
  runId: string,
): Promise<{ id: string; token: string }> {
  const res = await fetch(`${baseUrl}/api/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...CSRF },
    body: JSON.stringify({ name: `HEL-1297 isolated bootstrap ${runId}`, expiresInDays: 1 }),
  });
  const body = (await res.json()) as { id?: string; token?: string };
  if (res.status >= 300 || !body.id || !body.token) {
    throw new Error(`mint bootstrap PAT failed: HTTP ${res.status}`);
  }
  return { id: body.id, token: body.token };
}

/** Revokes by exact id and confirms the token no longer authenticates (401). Returns a failure or null. */
export async function revokePat(baseUrl: string, b: Bootstrap): Promise<string | null> {
  const del = await fetch(`${baseUrl}/api/tokens/${b.patId}`, {
    method: "DELETE",
    headers: { Cookie: b.cookie, ...CSRF },
  });
  if (del.status >= 300) return `bootstrap PAT ${b.patId}: revoke returned HTTP ${del.status}`;
  const probe = await fetch(`${baseUrl}/api/pipelines`, {
    headers: { Authorization: `Bearer ${b.pat}` },
  });
  return probe.status === 401
    ? null
    : `bootstrap PAT ${b.patId}: still authenticates after revoke (HTTP ${probe.status})`;
}
