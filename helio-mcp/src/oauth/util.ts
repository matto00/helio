import { createHash } from "node:crypto";
import type { Response } from "express";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Remove C0/C1 control characters (and DEL). */
export function stripControl(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

/** A display-safe copy of untrusted text: control characters stripped, cut to `max` characters. */
export function displayText(value: string | undefined, max: number): string {
  return stripControl(value ?? "")
    .trim()
    .slice(0, max);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.has(hostname.toLowerCase());
}

/**
 * True when `uri` is `https:` or loopback `http:` and, if an allow-list is configured, a
 * non-loopback host is on it. (MCP requires redirect URIs to be one of those two shapes; the
 * SDK itself would admit plain http.)
 */
export function redirectUriAllowed(
  uri: string,
  allowedHosts: ReadonlySet<string> | undefined,
): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol === "http:") return loopback;
  if (url.protocol !== "https:") return false;
  return loopback || !allowedHosts || allowedHosts.has(url.hostname.toLowerCase());
}

/** Headers every HTML page helio-mcp serves must carry: no framing, no sub-resources. */
export function applyHtmlSecurityHeaders(res: Response): void {
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

/** A minimal error page; `message` and every part of `detail` are HTML-escaped here. */
export function sendErrorPage(
  res: Response,
  status: number,
  title: string,
  message: string,
  detail?: string,
): void {
  applyHtmlSecurityHeaders(res);
  res
    .status(status)
    .type("html")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
        `<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>` +
        (detail ? `<p>${escapeHtml(detail)}</p>` : "") +
        `</body></html>`,
    );
}

/** The PAT name the consent page gives a connector token (mirrors the frontend's naming). */
export function connectorTokenName(clientName: string | undefined, redirectHost: string): string {
  const name = displayText(clientName, 40) || "An MCP client";
  return stripControl(`MCP connector: ${name} (${redirectHost})`).slice(0, 100);
}
