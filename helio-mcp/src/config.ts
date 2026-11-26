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
  /** HTTP mode only: replaces the stdio 401 remediation text (which tells the user to edit
   *  `HELIO_PAT`, meaningless for a remote connector). Never set by `loadConfig`. */
  readonly authErrorHint?: string;
}

const DEFAULT_BASE_URL = "http://localhost:8080";
const PAT_PREFIX = "helio_pat_";

/** The server-side `HELIO_API_BASE_URL` rule, shared by `loadConfig` and `loadHttpConfig`: an absolute
 *  `http:`/`https:` URL with no query or fragment; returned with trailing slashes stripped. The message
 *  names the variable and the offending part only, never the value (it may carry credentials). */
export function validateApiBaseUrl(raw: string): string {
  const expected = "e.g. https://helio.example or https://host/helio";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`HELIO_API_BASE_URL must be an absolute http(s) URL, ${expected}.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `HELIO_API_BASE_URL must be an absolute http(s) URL, ${expected} (its scheme is "${url.protocol}").`,
    );
  }
  // `?`/`#` on the raw value: `new URL("https://h/?")` reports an empty `search`.
  if (/[?#]/.test(raw)) {
    const part = raw.includes("?") ? "a query string" : "a fragment";
    throw new Error(`HELIO_API_BASE_URL must not contain ${part}, ${expected}.`);
  }
  return raw.replace(/\/+$/, "");
}

/** Read + validate config, or throw a message suitable for printing to stderr. */
export function loadConfig(env: Record<string, string | undefined> = process.env): HelioConfig {
  const baseUrl = validateApiBaseUrl(env.HELIO_API_BASE_URL?.trim() || DEFAULT_BASE_URL);

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
