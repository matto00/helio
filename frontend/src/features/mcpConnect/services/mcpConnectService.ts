// HEL-1709 -- talks to helio-mcp (not the Helio API) on behalf of the MCP connector consent page.
//
// Deliberately NOT `httpClient`: that client sets `withCredentials`, a custom CSRF header and a 401
// interceptor that signs the user out, any of which would fail CORS against helio-mcp's
// credential-less `/oauth/pending` or sign the user out over a foreign service's answer. A plain
// `fetch` with `credentials: "omit"` and no custom headers is a "simple" CORS request.

export interface PendingInfo {
  /** The connector client's self-declared name; absent when it registered without one. */
  clientName?: string;
  /** Host (with port, if any) the authorization result will be sent to. */
  redirectHost: string;
  /** Unix seconds at which the pending request expires. */
  expiresAt: number;
}

export class PendingRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingRequestError";
  }
}

export async function fetchPendingInfo(origin: string, request: string): Promise<PendingInfo> {
  let response: Response;
  try {
    response = await fetch(`${origin}/oauth/pending?request=${encodeURIComponent(request)}`, {
      method: "GET",
      credentials: "omit",
    });
  } catch {
    throw new PendingRequestError("Could not reach the connector service.");
  }
  if (!response.ok) {
    throw new PendingRequestError("This connection request is invalid or has expired.");
  }
  const body = (await response.json()) as Partial<PendingInfo>;
  if (typeof body.redirectHost !== "string" || typeof body.expiresAt !== "number") {
    throw new PendingRequestError("The connector service sent an unexpected response.");
  }
  return {
    clientName: typeof body.clientName === "string" ? body.clientName : undefined,
    redirectHost: body.redirectHost,
    expiresAt: body.expiresAt,
  };
}

/**
 * Hand the decision back to helio-mcp by an off-screen form POST (a full navigation, so the
 * browser follows helio-mcp's redirect to the client). The PAT therefore travels only in a request
 * body to `origin`; it is never put in a URL, storage or a log.
 */
export function postDecision(origin: string, fields: Record<string, string>): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = `${origin}/oauth/callback`;
  form.style.position = "absolute";
  form.style.left = "-9999px";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/** `MCP connector: <client> (<host>)`: control characters stripped, at most 100 characters. */
export function connectorTokenName(clientName: string | undefined, redirectHost: string): string {
  // eslint-disable-next-line no-control-regex
  const strip = (v: string) => v.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  const name = strip(clientName ?? "") || "An MCP client";
  return strip(`MCP connector: ${name} (${strip(redirectHost)})`).slice(0, 100);
}

/** True when this document is rendered inside another page (a clickjacking attempt). */
export function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true; // a cross-origin top window throws: that is a frame
  }
}
