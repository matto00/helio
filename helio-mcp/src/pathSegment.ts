/**
 * HEL-1160 -- turns an agent-supplied id into exactly one opaque, percent-encoded URL path segment.
 * `encodeURIComponent` alone is not enough (`..` survives it), so traversal and delimiter characters are
 * rejected outright with a typed error before any request is built.
 */

export class HelioInvalidIdError extends Error {
  override readonly name = "HelioInvalidIdError";
  constructor(
    readonly value: unknown,
    readonly label: string,
  ) {
    super(
      `Invalid ${label} ${JSON.stringify(value)}: an id must be a single path segment ` +
        `(no "/", "?", "#", "\\", and not "", "." or "..")`,
    );
  }
}

const FORBIDDEN = /[/?#\\]/;

export function pathSegment(value: string, label = "id"): string {
  if (
    typeof value !== "string" ||
    value === "" ||
    value === "." ||
    value === ".." ||
    FORBIDDEN.test(value)
  ) {
    throw new HelioInvalidIdError(value, label);
  }
  return encodeURIComponent(value);
}
