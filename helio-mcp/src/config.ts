/**
 * Runtime configuration, resolved once from the environment.
 *
 * - `HELIO_API_BASE_URL` — base URL of a running Helio backend
 *   (default `http://localhost:8080`).
 * - `HELIO_PAT` — a Personal Access Token (`helio_pat_…`) minted via
 *   `POST /api/tokens` (HEL-148 Phase 1). Required; we fail fast with a clear
 *   message when it is absent so the server never starts half-authenticated.
 */

export interface HelioConfig {
  readonly baseUrl: string;
  readonly pat: string;
}

const DEFAULT_BASE_URL = "http://localhost:8080";
const PAT_PREFIX = "helio_pat_";

/** Read + validate config, or throw a message suitable for printing to stderr. */
export function loadConfig(env: Record<string, string | undefined> = process.env): HelioConfig {
  const baseUrl = (env.HELIO_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  const pat = env.HELIO_PAT?.trim();
  if (!pat) {
    throw new Error(
      "HELIO_PAT is not set. Mint a Personal Access Token with " +
        "`POST /api/tokens` (see helio-mcp/README.md) and export it, e.g.\n" +
        "  export HELIO_PAT=helio_pat_xxxxxxxx",
    );
  }
  if (!pat.startsWith(PAT_PREFIX)) {
    throw new Error(
      `HELIO_PAT does not look like a Helio token (expected a "${PAT_PREFIX}" prefix). ` +
        "Re-check the value you exported.",
    );
  }

  return { baseUrl, pat };
}
