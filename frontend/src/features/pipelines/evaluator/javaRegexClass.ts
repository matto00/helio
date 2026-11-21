// HEL-1581 -- the character-class parser of the `stringops extractRegex` regex allowlist (javaRegex.ts, design Decision 1a),
// split out of javaRegex.ts by HEL-1697. A class outside the allowlist throws `Decline`, which declines the step.

import {
  complementSet,
  pointSet,
  rangeSet,
  simpleEscapeSet,
  SPACE,
  unionSets,
  type Ranges,
} from "./javaRegexSets";

export class Decline extends Error {}

export const SPACE_CLASS_BODY = " \\t\\n\\x0B\\f\\r";
export const ESCAPED_META = new Set([
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
export const SIMPLE_ESCAPES = new Set(["t", "n", "r", "f", "d", "D", "w", "W"]);

export function isSurrogate(c: number): boolean {
  return c >= 0xd800 && c <= 0xdfff;
}

/** One class member's code point (a literal or an escaped metacharacter), or a class escape. */
function readClassEnd(
  p: string,
  i: number,
): { text: string; codePoint: number; next: number; range: boolean; set: Ranges } {
  const c = p[i];
  if (c === "\\") {
    const e = p[i + 1];
    if (e === undefined) throw new Decline();
    if (ESCAPED_META.has(e))
      return {
        text: `\\${e}`,
        codePoint: e.codePointAt(0)!,
        next: i + 2,
        range: true,
        set: pointSet(e.codePointAt(0)!),
      };
    if (e === "-")
      return { text: "\\-", codePoint: 45, next: i + 2, range: true, set: pointSet(45) };
    if (SIMPLE_ESCAPES.has(e))
      return {
        text: `\\${e}`,
        codePoint: -1,
        next: i + 2,
        range: false,
        set: simpleEscapeSet(e)!,
      };
    if (e === "s")
      return { text: SPACE_CLASS_BODY, codePoint: -1, next: i + 2, range: false, set: SPACE };
    throw new Decline();
  }
  if (c === "]" || c === "[" || c === "&" || c === "-") throw new Decline();
  const cp = p.codePointAt(i)!;
  if (isSurrogate(cp)) throw new Decline();
  const width = cp > 0xffff ? 2 : 1;
  return {
    text: p.slice(i, i + width),
    codePoint: cp,
    next: i + width,
    range: true,
    set: pointSet(cp),
  };
}

export function parseClass(
  p: string,
  start: number,
): { source: string; next: number; set: Ranges } {
  let i = start + 1;
  let source = "[";
  const members: Ranges[] = [];
  let negated = false;
  if (p[i] === "^") {
    source += "^";
    negated = true;
    i++;
  }
  const first = i;
  for (;;) {
    const c = p[i];
    if (c === undefined) throw new Decline();
    if (c === "]") {
      if (i === first) throw new Decline();
      const union = unionSets(members);
      return { source: `${source}]`, next: i + 1, set: negated ? complementSet(union) : union };
    }
    if (c === "-") {
      if (i === first || p[i + 1] === "]") {
        source += "\\-";
        members.push(pointSet(45));
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
      members.push(rangeSet(lo.codePoint, hi.codePoint));
      i = hi.next;
    } else {
      source += lo.text;
      members.push(lo.set);
    }
  }
}
