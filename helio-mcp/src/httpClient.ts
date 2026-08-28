/**
 * Thin typed HTTP client over the Helio REST API.
 *
 * Mirrors the conventions of `frontend/src/services/httpClient.ts`:
 * - a single client instance carries the `Authorization: Bearer <token>`
 *   default header (there, `setAuthToken`; here, the PAT from config);
 * - a 401 is treated as a distinct, actionable condition rather than a generic
 *   failure (there, the interceptor clears auth + redirects to /login; here —
 *   with no UI to redirect — we throw a typed `HelioAuthError` carrying a
 *   remediation message so the MCP tool surfaces "your PAT is invalid/revoked"
 *   instead of an opaque 401).
 *
 * A 429 is the one status this client retries (HEL-495). The backend's
 * rate-limiting directive budgets `RATE_LIMIT_REQUESTS_PER_WINDOW` requests per
 * PAT per fixed window and refuses the overflow with a `Retry-After`
 * delta-seconds header. Agent-driven runs are bursty by nature — helio-news
 * creates a source + pipeline + run + panel + bind for every panel on every
 * board — so without this a long run dies partway through on a condition that
 * resolves itself in seconds. Retrying is safe even for writes: a rate-limited
 * request is refused by the directive *before* the route runs, so nothing was
 * created to duplicate.
 *
 * Deliberately dependency-light: uses the Node built-in `fetch` (Node >= 18)
 * rather than axios, so the wrapper stays thin and the package has no runtime
 * HTTP dependency to pin.
 */

import type { HelioConfig } from "./config.js";

/** Base error for any non-2xx Helio response. */
export class HelioApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "HelioApiError";
  }
}

/** 401 specifically — the PAT is missing/expired/revoked. */
export class HelioAuthError extends HelioApiError {
  constructor(url: string) {
    super(
      401,
      url,
      "Unauthorized (401): the Helio PAT was rejected. It may be revoked, " +
        "expired, or wrong. Mint a fresh token via POST /api/tokens and update HELIO_PAT.",
    );
    this.name = "HelioAuthError";
  }
}

/** Max retries after the initial attempt before a 429 is surfaced to the caller. */
const MAX_RATE_LIMIT_RETRIES = 5;
/** Backoff when a 429 arrives without a usable `Retry-After`: 1s, 2s, 4s, … */
const BASE_BACKOFF_MS = 1_000;
/** Ceiling on any single wait, so a stray large `Retry-After` cannot stall a run. */
const MAX_BACKOFF_MS = 60_000;

/** The request shape `dispatch` builds. Spelled structurally rather than as
 *  `RequestInit` for the same reason the `dispatch` doc gives: the DOM-only
 *  type names aren't declared as globals under this package's `lib`, so naming
 *  them trips `no-undef` even though `fetch` accepts this structurally. */
export interface HelioRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string | FormData;
}

/** Seams for tests: the real `fetch` and a real timer in production. */
export interface HelioHttpClientDeps {
  fetchImpl: (url: string, init: HelioRequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  warn: (message: string) => void;
}

const defaultDeps: HelioHttpClientDeps = {
  fetchImpl: (url, init) => fetch(url, init),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  warn: (message: string) => console.error(message),
};

export class HelioHttpClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly deps: HelioHttpClientDeps;

  constructor(config: HelioConfig, deps: Partial<HelioHttpClientDeps> = {}) {
    this.baseUrl = config.baseUrl;
    this.authHeader = `Bearer ${config.pat}`;
    this.deps = { ...defaultDeps, ...deps };
  }

  /** GET `path` (relative, e.g. `/api/dashboards`) and parse the JSON body as `T`. */
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.send<T>("GET", path, undefined, query);
  }

  /** POST a JSON body to `path` and parse the JSON response as `T`. */
  post<T>(
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    return this.send<T>("POST", path, body, query);
  }

  /** PATCH a JSON body to `path` and parse the JSON response as `T`. */
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.send<T>("PATCH", path, body);
  }

  /** PUT a JSON body to `path` and parse the JSON response as `T` (HEL-363,
   *  first caller: `PUT /api/dashboards/:id/contents`). */
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.send<T>("PUT", path, body);
  }

  /** DELETE `path`. Helio's delete endpoints answer `204 No Content`, so the
   *  response body is empty — `dispatch` returns `undefined` for a 204 rather
   *  than trying to `JSON.parse("")`. Callers default `T` to `void`. */
  delete<T = void>(path: string): Promise<T> {
    return this.send<T>("DELETE", path);
  }

  /** POST a `multipart/form-data` body (e.g. CSV upload) to `path` and parse
   *  the JSON response as `T`. `Content-Type` (with its boundary) is set by
   *  `fetch` itself when the body is a `FormData` instance — never set it
   *  manually, or the boundary will be missing and the backend's multipart
   *  unmarshaller will fail to parse the parts. */
  postMultipart<T>(path: string, form: FormData): Promise<T> {
    const url = this.buildUrl(path);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
    return this.dispatch<T>(url, { method: "POST", headers, body: form });
  }

  private send<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    return this.dispatch<T>(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** Shared request/response handling for both JSON and multipart bodies.
   *  `body` is typed as `string | FormData` (a JSON string or a multipart
   *  form) rather than the DOM-only `BodyInit`/`RequestInit` type names, which
   *  aren't declared as global values under this package's `lib` (they're
   *  TS-only ambient interfaces, so referencing them by name trips `no-undef`
   *  even though `fetch`'s own signature accepts this structurally). */
  private async dispatch<T>(url: string, init: HelioRequestInit): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.deps.fetchImpl(url, init);
      } catch (cause) {
        // Network-level failure (backend down, DNS, connection refused).
        throw new HelioApiError(
          0,
          url,
          `Could not reach the Helio backend at ${this.baseUrl}. Is it running? (${String(
            (cause as Error)?.message ?? cause,
          )})`,
        );
      }

      if (response.status === 401) {
        throw new HelioAuthError(url);
      }
      // Throttled, and there are attempts left: wait out the window and re-send.
      // Only 429 is retried — every other non-2xx is a real answer about the
      // request itself and would fail identically a second time.
      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const delay = this.retryDelayMs(response, attempt);
        // stderr, never stdout: stdout is the MCP stdio transport's JSON-RPC
        // channel and a stray line there corrupts the session. Logged because a
        // silent retry is indistinguishable from a slow backend — the 2026-08
        // news outage went three days undiagnosed for exactly that reason.
        this.deps.warn(
          `helio-mcp: 429 rate limited on ${init.method} ${url}; ` +
            `retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`,
        );
        await this.deps.sleep(delay);
        continue;
      }
      if (!response.ok) {
        throw new HelioApiError(response.status, url, await this.describeError(response));
      }
      // 204 No Content (e.g. some DELETEs) — return undefined as T.
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }
  }

  /** How long to wait before re-sending after a 429.
   *
   *  Prefers the server's own `Retry-After` (the directive sends delta-seconds
   *  — the exact remaining window), and falls back to exponential backoff when
   *  the header is absent or in the HTTP-date form we don't parse. Either way
   *  the wait is clamped to `MAX_BACKOFF_MS`. */
  private retryDelayMs(response: Response, attempt: number): number {
    const header = response.headers?.get("Retry-After");
    const seconds = header === null || header === undefined ? NaN : Number(header);
    const wanted =
      Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : BASE_BACKOFF_MS * 2 ** attempt;
    return Math.min(wanted, MAX_BACKOFF_MS);
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** Extract the backend's `{ "message": ... }` error body when present. */
  private async describeError(response: Response): Promise<string> {
    const fallback = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (body && typeof body.message === "string") {
        return `${fallback}: ${body.message}`;
      }
    } catch {
      // non-JSON body — fall through
    }
    return fallback;
  }
}
