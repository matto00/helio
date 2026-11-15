/**
 * Stateless sealing for the OAuth artefacts helio-mcp hands to clients (HEL-1709, design D2).
 *
 * Every client id, pending request, authorization code and access token is an AES-256-GCM
 * ciphertext, so any Cloud Run instance can open one with no shared store. Each kind has its own
 * HKDF subkey, so a ciphertext of one kind can never be accepted as another.
 *
 * Wire format: `v1.<iv>.<ciphertext+tag>`, both parts base64url. The plaintext is JSON with a
 * `kind` and, for every kind except `client`, an `exp` in Unix SECONDS (the SDK's bearer check
 * compares seconds; milliseconds would never expire).
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export type SealKind = "client" | "pending" | "code" | "access";

/** Kinds that never expire: a registered connector must not silently turn into `invalid_client`. */
const NON_EXPIRING: ReadonlySet<SealKind> = new Set<SealKind>(["client"]);

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const PENDING_TTL_SECONDS = 10 * 60;
export const CODE_TTL_SECONDS = 60;
export const ACCESS_TTL_SECONDS = 90 * 24 * 60 * 60;

/** Raised for any seal that cannot be opened; the message never carries seal content. */
export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

export interface SealKeys {
  /** 32-byte current key: the only one new seals use. */
  readonly current: Buffer;
  /** Optional prior key, tried on open only (rotation window). */
  readonly previous?: Buffer | undefined;
}

function subkey(master: Buffer, kind: SealKind): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `helio-mcp/${kind}`, 32));
}

function nowSeconds(now: number): number {
  return Math.floor(now / 1000);
}

/** Seal `payload` as `kind`. Non-client kinds get `exp = now + ttlSeconds` (seconds). */
export function seal(
  keys: SealKeys,
  kind: SealKind,
  payload: Record<string, unknown>,
  ttlSeconds: number,
  now: number = Date.now(),
): string {
  const body: Record<string, unknown> = { ...payload, kind };
  if (!NON_EXPIRING.has(kind)) body.exp = nowSeconds(now) + ttlSeconds;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", subkey(keys.current, kind), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${iv.toString("base64url")}.${Buffer.concat([ct, tag]).toString("base64url")}`;
}

function tryOpen(master: Buffer, kind: SealKind, iv: Buffer, data: Buffer): string | undefined {
  try {
    const decipher = createDecipheriv("aes-256-gcm", subkey(master, kind), iv);
    decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(data.subarray(0, data.length - TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return undefined;
  }
}

/** Open a seal of `kind`; throws `SealError` when it is malformed, tampered, the wrong kind or expired. */
export function open<T extends Record<string, unknown> = Record<string, unknown>>(
  keys: SealKeys,
  kind: SealKind,
  token: string,
  now: number = Date.now(),
): T {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) throw new SealError("malformed seal");
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const data = Buffer.from(parts[2] ?? "", "base64url");
  if (iv.length !== IV_BYTES || data.length <= TAG_BYTES) throw new SealError("malformed seal");

  let text = tryOpen(keys.current, kind, iv, data);
  if (text === undefined && keys.previous) text = tryOpen(keys.previous, kind, iv, data);
  if (text === undefined) throw new SealError("seal did not open");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SealError("malformed seal");
  }
  if (typeof parsed !== "object" || parsed === null) throw new SealError("malformed seal");
  const obj = parsed as Record<string, unknown>;
  if (obj.kind !== kind) throw new SealError("wrong seal kind");
  if (!NON_EXPIRING.has(kind)) {
    if (typeof obj.exp !== "number" || obj.exp < nowSeconds(now))
      throw new SealError("seal expired");
  }
  return obj as T;
}
