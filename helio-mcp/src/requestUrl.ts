/**
 * The one place a base URL and a request path are joined (HEL-1160 origin check, HEL-1161 prefix check).
 * `requestPathGuard.test.ts` fails when any other module builds a request URL by joining strings.
 */

/** A request path or base URL that would send the request somewhere other than the configured API. */
export class HelioRequestUrlError extends Error {
  override readonly name = "HelioRequestUrlError";
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`Refusing request path ${JSON.stringify(path)}: ${reason}`);
  }
}

/** True when `path` holds a backslash, an ASCII control character or a space. WHATWG URL parsing
 *  strips tab/newline and reads `\` as `/` for http(s), so these could turn `/\evil.example/x` into a
 *  same-origin path; no legitimate request path contains one (`pathSegment` encodes ids). */
function hasForbiddenCharacter(path: string): boolean {
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code === 0x5c || code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** `baseUrl` + `path` (+ `query`) as an absolute URL beneath the base's origin and path prefix, or a
 *  `HelioRequestUrlError`. A base with and without a trailing slash gives the same URL. */
export function buildRequestUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  if (path.startsWith("//")) {
    throw new HelioRequestUrlError(path, "a protocol-relative path is not allowed");
  }
  if (hasForbiddenCharacter(path)) {
    throw new HelioRequestUrlError(
      path,
      "a path may not contain a backslash, a control character or a space",
    );
  }
  let base: URL;
  try {
    // `?` and `#` are checked on the raw value: `new URL("https://h/?")` reports an empty `search`.
    if (/[?#]/.test(baseUrl)) throw new Error("query or fragment");
    base = new URL(`${baseUrl.replace(/\/+$/, "")}/`);
  } catch {
    throw new HelioRequestUrlError(path, "the API base URL is not an absolute http(s) URL");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new HelioRequestUrlError(path, "the API base URL is not an absolute http(s) URL");
  }
  // Resolve the BARE path (one leading `/` removed), never `"./" + path`: under `./` a path such as
  // `/https://evil.example/x` would resolve same-origin inside the prefix and be sent, making the
  // origin check unreachable.
  const url = new URL(path.startsWith("/") ? path.slice(1) : path, base);
  if (url.origin !== base.origin) {
    throw new HelioRequestUrlError(path, `it resolves to ${url.origin}, not ${base.origin}`);
  }
  if (!url.pathname.startsWith(base.pathname)) {
    throw new HelioRequestUrlError(path, `it resolves outside the base path ${base.pathname}`);
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
