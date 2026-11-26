import { HelioInvalidIdError, pathSegment } from "../pathSegment.js";
import { buildRequestUrl } from "../requestUrl.js";

/**
 * Client for the two backend refresh-family routes (HEL-1713, design D3/D5). The PAT is the bearer, so
 * the backend confines every call to that PAT's own families. Only hashes of token ids and the client id
 * cross the wire; neither the refresh token nor its id is ever sent. The status mapping lives here so
 * the provider reads outcomes, not HTTP codes.
 */

export interface FamilyCreated {
  readonly familyId: string;
  /** Family (= PAT) expiry, ms since epoch. */
  readonly expiresAtMs: number;
}

export type CreateOutcome =
  | { readonly kind: "created"; readonly family: FamilyCreated }
  /** 401: the PAT is revoked or expired. */
  | { readonly kind: "revoked" }
  /** Any other status, a network error or a timeout; `detail` is a status code or error name only. */
  | { readonly kind: "unavailable"; readonly detail: string };

export type RotateOutcome =
  | { readonly kind: "rotated"; readonly expiresAtMs: number }
  /** 401: the PAT is revoked or expired. */
  | { readonly kind: "revoked" }
  /** 404 (unknown/foreign family) or 409 `expired`, `mismatch`, `reused`. */
  | { readonly kind: "refused"; readonly reason: "unknown" | "expired" | "mismatch" | "reused" }
  /** Backend unreachable or an unexpected status. */
  | { readonly kind: "unavailable"; readonly detail: string };

export interface RotateRequest {
  readonly familyId: string;
  readonly clientIdHash: string;
  readonly resource: string;
  readonly presentedJtiHash: string;
  readonly nextJtiHash: string;
}

export interface CreateRequest {
  readonly clientIdHash: string;
  readonly resource: string;
  readonly jtiHash: string;
}

export const DEFAULT_FAMILY_TIMEOUT_MS = 3000;

const REASONS = new Set(["expired", "mismatch", "reused"]);

export class FamilyClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly timeoutMs: number = DEFAULT_FAMILY_TIMEOUT_MS,
  ) {}

  async create(pat: string, request: CreateRequest): Promise<CreateOutcome> {
    const res = await this.post(pat, "/api/mcp-refresh-families", request);
    if ("error" in res) return { kind: "unavailable", detail: res.error };
    if (res.status === 401) return { kind: "revoked" };
    const family = res.status === 201 ? parseCreated(res.body) : undefined;
    if (family) return { kind: "created", family };
    return { kind: "unavailable", detail: String(res.status) };
  }

  async rotate(pat: string, request: RotateRequest): Promise<RotateOutcome> {
    const { familyId, ...body } = request;
    try {
      pathSegment(familyId, "familyId");
    } catch (err) {
      if (err instanceof HelioInvalidIdError) return { kind: "refused", reason: "unknown" };
      throw err;
    }
    const res = await this.post(
      pat,
      `/api/mcp-refresh-families/${pathSegment(familyId, "familyId")}/rotate`,
      body,
    );
    if ("error" in res) return { kind: "unavailable", detail: res.error };
    if (res.status === 401) return { kind: "revoked" };
    if (res.status === 404) return { kind: "refused", reason: "unknown" };
    if (res.status === 409) {
      const reason = (res.body as { reason?: unknown } | undefined)?.reason;
      return typeof reason === "string" && REASONS.has(reason)
        ? { kind: "refused", reason: reason as "expired" | "mismatch" | "reused" }
        : { kind: "unavailable", detail: "409" };
    }
    const expiresAtMs = res.status === 200 ? parseExpiry(res.body) : undefined;
    if (expiresAtMs !== undefined) return { kind: "rotated", expiresAtMs };
    return { kind: "unavailable", detail: String(res.status) };
  }

  private async post(
    pat: string,
    path: string,
    body: object,
  ): Promise<{ status: number; body: unknown } | { error: string }> {
    try {
      const url = buildRequestUrl(this.apiBaseUrl, path);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pat}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const parsed: unknown = await res.json().catch(() => undefined);
      return { status: res.status, body: parsed };
    } catch (err) {
      return { error: err instanceof Error ? err.name : "Error" };
    }
  }
}

function parseExpiry(body: unknown): number | undefined {
  const text = (body as { expiresAt?: unknown } | undefined)?.expiresAt;
  const ms = typeof text === "string" ? Date.parse(text) : NaN;
  return Number.isFinite(ms) ? ms : undefined;
}

function parseCreated(body: unknown): FamilyCreated | undefined {
  const familyId = (body as { familyId?: unknown } | undefined)?.familyId;
  const expiresAtMs = parseExpiry(body);
  return typeof familyId === "string" && familyId && expiresAtMs !== undefined
    ? { familyId, expiresAtMs }
    : undefined;
}
