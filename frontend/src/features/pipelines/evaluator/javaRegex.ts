// HEL-1581 — the `stringops extractRegex` regex allowlist (design Decision 1a). A Java `Pattern` is
// evaluated client-side only when it tokenizes completely under the allowlist below; any other token,
// any tokenizer failure, or a translation that `new RegExp(source, "u")` rejects declines the step as
// `unsafeRegex`. It never becomes an error and never crashes.
//
// Invariant (the precondition of decline-not-error): every pattern the allowlist accepts is a valid
// Java `Pattern`. A Java-invalid pattern is therefore always declined, and the server reports the real
// Java error. An allowlist entry later found to accept a Java-invalid pattern is an allowlist defect.

export type JavaRegex = { ok: true; regex: RegExp; groupCount: number } | { ok: false };

const MAX_QUANTIFIER_BOUND = 2147483647n;
const SPACE_CLASS_BODY = " \\t\\n\\x0B\\f\\r";
const DOT = "[^\\n\\r\\u0085\\u2028\\u2029]";
const DOLLAR = "(?=(?:\\r\\n|[\\n\\r\\u0085\\u2028\\u2029])?$)(?!(?<=\\r)\\n$)";
const ESCAPED_META = new Set([
  ".",
  "*",
  "+",
  "?",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "|",
  "^",
  "$",
  "\\",
  "/",
]);
const SIMPLE_ESCAPES = new Set(["t", "n", "r", "f", "d", "D", "w", "W"]);

class Decline extends Error {}

type Atom = "none" | "atom" | "group" | "anchor" | "quantified";

function isSurrogate(c: number): boolean {
  return c >= 0xd800 && c <= 0xdfff;
}

/** Parses `{n}`, `{n,}` or `{n,m}` at `i` (the `{`); returns the end index (past `}`). */
function parseBraceQuantifier(p: string, i: number): number {
  const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(p.slice(i));
  if (!m) throw new Decline();
  const low = BigInt(m[1]);
  if (low > MAX_QUANTIFIER_BOUND) throw new Decline();
  if (m[2] !== undefined && m[3] !== "") {
    const high = BigInt(m[3]);
    if (high > MAX_QUANTIFIER_BOUND || high < low) throw new Decline();
  }
  return i + m[0].length;
}

/** One class member's code point (a literal or an escaped metacharacter), or a class escape. */
function readClassEnd(
  p: string,
  i: number,
): { text: string; codePoint: number; next: number; range: boolean } {
  const c = p[i];
  if (c === "\\") {
    const e = p[i + 1];
    if (e === undefined) throw new Decline();
    if (ESCAPED_META.has(e))
      return { text: `\\${e}`, codePoint: e.codePointAt(0)!, next: i + 2, range: true };
    if (e === "-") return { text: "\\-", codePoint: 45, next: i + 2, range: true };
    if (SIMPLE_ESCAPES.has(e)) return { text: `\\${e}`, codePoint: -1, next: i + 2, range: false };
    if (e === "s") return { text: SPACE_CLASS_BODY, codePoint: -1, next: i + 2, range: false };
    throw new Decline();
  }
  if (c === "]" || c === "[" || c === "&" || c === "-") throw new Decline();
  const cp = p.codePointAt(i)!;
  if (isSurrogate(cp)) throw new Decline();
  const width = cp > 0xffff ? 2 : 1;
  return { text: p.slice(i, i + width), codePoint: cp, next: i + width, range: true };
}

function parseClass(p: string, start: number): { source: string; next: number } {
  let i = start + 1;
  let source = "[";
  if (p[i] === "^") {
    source += "^";
    i++;
  }
  const first = i;
  for (;;) {
    const c = p[i];
    if (c === undefined) throw new Decline();
    if (c === "]") {
      if (i === first) throw new Decline();
      return { source: `${source}]`, next: i + 1 };
    }
    if (c === "-") {
      if (i === first || p[i + 1] === "]") {
        source += "\\-";
        i++;
        continue;
      }
      throw new Decline();
    }
    const lo = readClassEnd(p, i);
    i = lo.next;
    if (p[i] === "-" && p[i + 1] !== "]" && p[i + 1] !== undefined) {
      if (!lo.range) throw new Decline();
      const hi = readClassEnd(p, i + 1);
      if (!hi.range || hi.codePoint < lo.codePoint) throw new Decline();
      source += `${lo.text}-${hi.text}`;
      i = hi.next;
    } else {
      source += lo.text;
    }
  }
}

function translate(p: string): { source: string; groupCount: number } {
  let source = "";
  let groupCount = 0;
  let depth = 0;
  let last = "none" as Atom;
  let i = 0;
  const atom = (text: string, next: number, kind: Atom = "atom"): void => {
    source += text;
    i = next;
    last = kind;
  };
  while (i < p.length) {
    const c = p[i];
    switch (c) {
      case "\\": {
        const e = p[i + 1];
        if (e === undefined) throw new Decline();
        if (ESCAPED_META.has(e)) atom(`\\${e}`, i + 2);
        else if (e === "-") atom("-", i + 2);
        else if (SIMPLE_ESCAPES.has(e)) atom(`\\${e}`, i + 2);
        else if (e === "s") atom(`[${SPACE_CLASS_BODY}]`, i + 2);
        else if (e === "S") atom(`[^${SPACE_CLASS_BODY}]`, i + 2);
        else throw new Decline();
        break;
      }
      case ".":
        atom(DOT, i + 1);
        break;
      case "^":
        atom("^", i + 1, "anchor");
        break;
      case "$":
        atom(DOLLAR, i + 1, "anchor");
        break;
      case "(":
        if (p[i + 1] === "?") throw new Decline();
        groupCount++;
        depth++;
        atom("(", i + 1, "none");
        break;
      case ")":
        if (depth === 0) throw new Decline();
        depth--;
        atom(")", i + 1, "group");
        break;
      case "|":
        atom("|", i + 1, "none");
        break;
      case "[": {
        const cls = parseClass(p, i);
        atom(cls.source, cls.next);
        break;
      }
      case "*":
      case "+":
      case "?":
      case "{": {
        if (last !== "atom") throw new Decline();
        const end = c === "{" ? parseBraceQuantifier(p, i) : i + 1;
        source += p.slice(i, end);
        i = end;
        if (p[i] === "?") {
          source += "?";
          i++;
        } else if (p[i] === "+") throw new Decline();
        last = "quantified";
        break;
      }
      case "]":
      case "}":
        throw new Decline();
      default: {
        const cp = p.codePointAt(i)!;
        if (isSurrogate(cp)) throw new Decline();
        const width = cp > 0xffff ? 2 : 1;
        atom(p.slice(i, i + width), i + width);
      }
    }
  }
  if (depth !== 0) throw new Decline();
  return { source, groupCount };
}

const cache = new Map<string, JavaRegex>();

/** Translates a Java pattern into a `u`-mode RegExp when the pattern is inside the allowlist. */
export function compileJavaRegex(pattern: string): JavaRegex {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let result: JavaRegex;
  try {
    const { source, groupCount } = translate(pattern);
    result = { ok: true, regex: new RegExp(source, "u"), groupCount };
  } catch {
    result = { ok: false };
  }
  cache.set(pattern, result);
  return result;
}
