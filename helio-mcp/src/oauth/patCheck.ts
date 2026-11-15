/**
 * Asks the Helio backend whether a PAT is still accepted, via `GET /api/tokens` (PAT-callable;
 * a scoped PAT is refused with a non-200). Used by the consent callback (before issuing a code)
 * and by the `/mcp` liveness gate (design D4, D5).
 */

export type PatStatus =
  /** 200: accepted. */
  | "live"
  /** 401: revoked, expired or unknown. */
  | "rejected"
  /** Any other 4xx (for example a scoped PAT's 403): not a usable connector credential. */
  | "refused"
  /** 429, 5xx, network error or timeout: the backend gave no answer about the PAT. */
  | "unknown";

export async function checkPat(
  apiBaseUrl: string,
  pat: string,
  timeoutMs = 3000,
): Promise<PatStatus> {
  try {
    const res = await fetch(`${apiBaseUrl}/api/tokens`, {
      method: "GET",
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Drain so the socket is released; the body is never read or logged.
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 200) return "live";
    if (res.status === 401) return "rejected";
    if (res.status === 429 || res.status >= 500) return "unknown";
    return "refused";
  } catch {
    return "unknown";
  }
}
