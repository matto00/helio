/**
 * Configuration for the Streamable HTTP entry point (HEL-1709, design D6).
 *
 * Errors name the offending variable and never echo its value (the key and URLs may be secret
 * or secret-adjacent), so a message is safe to print to the host's logs.
 */

import type { SealKeys } from "./oauth/seal.js";

export interface HttpConfig {
  /** Public origin of this service, e.g. `https://mcp.helioapp.dev` (no path). */
  readonly publicUrl: URL;
  /** The canonical resource this server protects: `<publicUrl>/mcp`. */
  readonly resourceUrl: URL;
  /** Origin of the Helio web app that hosts the consent page. */
  readonly appUrl: URL;
  /** Base URL of the Helio backend. */
  readonly apiBaseUrl: string;
  readonly keys: SealKeys;
  readonly port: number;
  readonly livenessTtlSeconds: number;
  readonly largeBodySlots: number;
  /** Lower-cased hosts a client's redirect URI may use; `undefined` = no restriction. */
  readonly allowedRedirectHosts: ReadonlySet<string> | undefined;
}

export const DEFAULT_LIVENESS_TTL_SECONDS = 300;
export const DEFAULT_LARGE_BODY_SLOTS = 2;
const MAX_LARGE_BODY_SLOTS = 16;

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function origin(name: string, raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL.`);
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${name} must be an https origin (http is allowed only for localhost).`);
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username) {
    throw new Error(`${name} must be an origin only: no path, query, fragment or credentials.`);
  }
  return new URL(url.origin);
}

function key(name: string, raw: string): Buffer {
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32 || buf.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw new Error(`${name} must be the base64 encoding of exactly 32 bytes.`);
  }
  return buf;
}

function intInRange(env: Env, name: string, min: number, max: number, dflt: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return dflt;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  const n = Number(raw);
  if (n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return n;
}

/** Read + validate the HTTP-mode configuration, or throw a message naming the bad variable. */
export function loadHttpConfig(env: Env = process.env): HttpConfig {
  const publicUrl = origin("HELIO_MCP_PUBLIC_URL", required(env, "HELIO_MCP_PUBLIC_URL"));
  const appUrl = origin("HELIO_APP_URL", required(env, "HELIO_APP_URL"));
  const apiBaseUrl = required(env, "HELIO_API_BASE_URL").replace(/\/+$/, "");
  try {
    new URL(apiBaseUrl);
  } catch {
    throw new Error("HELIO_API_BASE_URL is not a valid URL.");
  }
  const current = key("HELIO_MCP_TOKEN_KEY", required(env, "HELIO_MCP_TOKEN_KEY"));
  const prevRaw = env.HELIO_MCP_TOKEN_KEY_PREVIOUS?.trim();
  const previous = prevRaw ? key("HELIO_MCP_TOKEN_KEY_PREVIOUS", prevRaw) : undefined;

  const hostsRaw = env.HELIO_MCP_ALLOWED_REDIRECT_HOSTS?.trim();
  const hosts = hostsRaw
    ? hostsRaw
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
    : [];

  return {
    publicUrl,
    resourceUrl: new URL("/mcp", publicUrl),
    appUrl,
    apiBaseUrl,
    keys: { current, previous },
    port: intInRange(env, "PORT", 1, 65535, 8080),
    livenessTtlSeconds: intInRange(
      env,
      "HELIO_MCP_LIVENESS_TTL_SECONDS",
      1,
      3600,
      DEFAULT_LIVENESS_TTL_SECONDS,
    ),
    largeBodySlots: intInRange(
      env,
      "HELIO_MCP_LARGE_BODY_SLOTS",
      1,
      MAX_LARGE_BODY_SLOTS,
      DEFAULT_LARGE_BODY_SLOTS,
    ),
    allowedRedirectHosts: hosts.length > 0 ? new Set(hosts) : undefined,
  };
}
