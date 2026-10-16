// HEL-1581 — the numeric parse primitives and string helpers every step shares instead of
// `Number()` / `parseFloat` / `parseInt`. The Scala engine parses with Java (`Double.parseDouble`,
// `Integer.parseInt`, `Long.parseLong`) and Scala 2.13's `toDoubleOption`; they accept forms
// JavaScript rejects (`"1d"`, `"1f"`, `"0x1p3"`, `" 1 "`) and reject forms JavaScript accepts
// (`"0x10"`, `"1_000"`, `""`). Acceptance sets here are read from the JDK / scala-library sources and
// held to the Scala oracle by the corpus.

/** Java `String.trim`: strips code units <= U+0020 only (U+00A0 and U+2003 survive). */
export function javaTrim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) <= 0x20) start++;
  while (end > start && s.charCodeAt(end - 1) <= 0x20) end--;
  return start === 0 && end === s.length ? s : s.slice(start, end);
}

const DECIMAL_BODY = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const HEX_BODY = /^0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?[pP]([+-]?\d+)$/;

function hexFloatValue(whole: string, fraction: string, binaryExponent: number): number {
  const digits = BigInt(`0x${whole}${fraction}` === "0x" ? "0x0" : `0x${whole}${fraction}`);
  if (digits === 0n) return 0;
  const exponent = binaryExponent - 4 * fraction.length;
  // Number(bigint) rounds to nearest-even; scaling by a power of two is exact short of the subnormal range.
  let value = Number(digits);
  let remaining = exponent;
  while (remaining > 1000) {
    value *= 2 ** 1000;
    remaining -= 1000;
  }
  while (remaining < -1000) {
    value *= 2 ** -1000;
    remaining += 1000;
  }
  return value * 2 ** remaining;
}

/**
 * Java `Double.parseDouble`, and the string grammar behind Scala 2.13's `toDoubleOption`
 * (`StringParsers.checkFloatFormat` is a pre-check of the same grammar): surrounding code units
 * <= U+0020 are trimmed; an optional sign; `NaN`; `Infinity`; a decimal (`1`, `1.`, `.5`, `1e5`)
 * or a hex float (`0x1p3`, `0x1.8p1`) with an optional `f`/`F`/`d`/`D` suffix. `undefined` when
 * the string is not accepted.
 */
export function parseJavaDouble(raw: string): number | undefined {
  const s = javaTrim(raw);
  if (s === "") return undefined;
  let negative = false;
  let body = s;
  if (body[0] === "+" || body[0] === "-") {
    negative = body[0] === "-";
    body = body.slice(1);
  }
  if (body === "") return undefined;
  if (body[0] === "N") return body === "NaN" ? NaN : undefined;
  if (body[0] === "I") return body === "Infinity" ? (negative ? -Infinity : Infinity) : undefined;
  const last = body[body.length - 1];
  if (last === "f" || last === "F" || last === "d" || last === "D") body = body.slice(0, -1);
  if (body.length >= 2 && body[0] === "0" && (body[1] === "x" || body[1] === "X")) {
    const m = HEX_BODY.exec(body);
    if (!m) return undefined;
    const whole = m[1];
    const fraction = m[2] ?? "";
    if (whole === "" && fraction === "") return undefined;
    const value = hexFloatValue(whole, fraction, Number(m[3]));
    return negative ? -value : value;
  }
  if (!DECIMAL_BODY.test(body)) return undefined;
  const value = Number(body);
  return negative ? -value : value;
}

/** Scala 2.13 `StringOps.toDoubleOption` (behind `PipelineRowJson.toDouble`). */
export const toDoubleOption = parseJavaDouble;

/** Java `Double.parseDouble` as used by `.toDouble` (filter's ordered operators, cast, assert). */
export const parseDouble = parseJavaDouble;

// --- Integer.parseInt / Long.parseLong --------------------------------------------------------------

const ND = /^\p{Nd}$/u;

/** `Character.digit(ch, 10)` for a BMP code unit: ASCII digits and any Unicode decimal digit (Nd). */
export function digitValue(s: string, i: number): number {
  const c = s.charCodeAt(i);
  if (c >= 48 && c <= 57) return c - 48;
  if (c < 128 || !ND.test(s[i])) return -1;
  let runStart = c;
  while (runStart > 0 && ND.test(String.fromCharCode(runStart - 1))) runStart--;
  return (c - runStart) % 10;
}

function parseJavaInteger(s: string, min: bigint, max: bigint): number | undefined {
  if (s === "") return undefined;
  let i = 0;
  let negative = false;
  if (s[0] === "-" || s[0] === "+") {
    negative = s[0] === "-";
    i = 1;
    if (s.length === 1) return undefined;
  }
  let acc = 0n;
  for (; i < s.length; i++) {
    const d = digitValue(s, i);
    if (d < 0) return undefined;
    acc = acc * 10n + BigInt(d);
    if (acc > max + 1n) return undefined;
  }
  const value = negative ? -acc : acc;
  if (value < min || value > max) return undefined;
  return Number(value);
}

const INT_MIN = -(2n ** 31n);
const INT_MAX = 2n ** 31n - 1n;
const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;

/** Java `Integer.parseInt` (`"+1"`, `"-1"`, Unicode digits; no whitespace, no `1.0`, no `0x10`). */
export const parseJavaInt = (s: string): number | undefined =>
  parseJavaInteger(s, INT_MIN, INT_MAX);
/** Java `Long.parseLong`; values beyond 2^53 lose precision (known gap). */
export const parseJavaLong = (s: string): number | undefined =>
  parseJavaInteger(s, LONG_MIN, LONG_MAX);

/** Scala `Double.toInt`: truncates toward zero, saturates, and maps NaN to 0. */
export function doubleToInt(d: number): number {
  if (Number.isNaN(d)) return 0;
  if (d >= 2147483647) return 2147483647;
  if (d <= -2147483648) return -2147483648;
  return Math.trunc(d) + 0;
}

/** Scala `Double.toLong`: truncates toward zero, saturates, and maps NaN to 0 (precision gap beyond 2^53). */
export function doubleToLong(d: number): number {
  if (Number.isNaN(d)) return 0;
  if (d >= 2 ** 63) return 2 ** 63;
  if (d <= -(2 ** 63)) return -(2 ** 63);
  return Math.trunc(d) + 0;
}

function charEqualsIgnoreCase(a: string, b: string): boolean {
  if (a === b) return true;
  const upper = (c: string): string => {
    const u = c.toUpperCase();
    return u.length === 1 ? u : c;
  };
  const ua = upper(a);
  const ub = upper(b);
  if (ua === ub) return true;
  const lower = (c: string): string => {
    const l = c.toLowerCase();
    return l.length === 1 ? l : c;
  };
  return lower(ua) === lower(ub);
}

/** Java `String.equalsIgnoreCase`. */
export function equalsIgnoreCase(s: string, target: string): boolean {
  if (s.length !== target.length) return false;
  for (let i = 0; i < s.length; i++) if (!charEqualsIgnoreCase(s[i], target[i])) return false;
  return true;
}

/** Scala `StringOps.toBoolean` (`String.equalsIgnoreCase("true" | "false")`); `undefined` otherwise. */
export function parseJavaBoolean(s: string): boolean | undefined {
  if (equalsIgnoreCase(s, "true")) return true;
  if (equalsIgnoreCase(s, "false")) return false;
  return undefined;
}
