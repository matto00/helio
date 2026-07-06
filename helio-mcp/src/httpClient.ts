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

export class HelioHttpClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: HelioConfig) {
    this.baseUrl = config.baseUrl;
    this.authHeader = `Bearer ${config.pat}`;
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

  private async send<T>(
    method: "GET" | "POST" | "PATCH",
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

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
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
    if (!response.ok) {
      throw new HelioApiError(response.status, url, await this.describeError(response));
    }
    // 204 No Content (e.g. some DELETEs) — return undefined as T.
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
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
