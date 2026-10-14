/**
 * Which HTML file answers a request path, for the dev and preview servers.
 * `firebase.json` encodes the same rule for production (real files first, then `** -> /app.html`),
 * and `scripts/check-landing-build.mjs` pins that config, so the three servers agree on what `/`
 * and a deep link serve.
 *
 * Returns the shell to serve, or `null` when the request is not a page navigation (a built file,
 * the API, or a Vite internal) and must be served as-is.
 */
const PASS_THROUGH_PREFIXES = ["/api/", "/health", "/@", "/src/", "/node_modules/"];

export function shellHtmlFor(pathname: string): "index.html" | "app.html" | null {
  if (pathname === "/" || pathname === "/index.html") return "index.html";
  if (pathname === "/app.html") return null;
  if (PASS_THROUGH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (lastSegment.includes(".")) return null;
  return "app.html";
}

/**
 * Mirrors the Accept check Vite's own HTML fallback applies (missing, empty, `text/html` or
 * a wildcard), so a `curl` or `request.get` deep link gets `app.html` just like a browser does.
 */
export function acceptsHtml(accept: string | undefined): boolean {
  if (accept === undefined || accept === "") return true;
  return accept.includes("text/html") || accept.includes("*/*");
}
