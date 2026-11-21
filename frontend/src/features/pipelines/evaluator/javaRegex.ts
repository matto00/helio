// HEL-1581 — the `stringops extractRegex` regex allowlist (design Decision 1a). A Java `Pattern` is
// evaluated client-side only when it tokenizes completely under the allowlist below; any other token,
// any tokenizer failure, or a translation that `new RegExp(source, "u")` rejects declines the step as
// `unsafeRegex`. It never becomes an error and never crashes.
//
// Invariant (the precondition of decline-not-error): every pattern the allowlist accepts is a valid
// Java `Pattern`. A Java-invalid pattern is therefore always declined, and the server reports the real
// Java error. An allowlist entry later found to accept a Java-invalid pattern is an allowlist defect.
//
// HEL-1683: a pattern that tokenizes is still declined when its structure permits super-linear backtracking
// (javaRegexCost.ts), because the browser's regex engine would run it on the main thread; the server evaluates it under
// its own per-step regex time budget instead.

import {
  isBacktrackBounded,
  MAX_CLASS_RANGES,
  widestClass,
  regexWorkModel,
  type AtomItem,
  type Item,
  type RegexWork,
} from "./javaRegexCost";
import {
  Decline,
  ESCAPED_META,
  isSurrogate,
  parseClass,
  SIMPLE_ESCAPES,
  SPACE_CLASS_BODY,
} from "./javaRegexClass";
import {
  complementSet,
  DOT_SET,
  pointSet,
  simpleEscapeSet,
  SPACE,
  type Ranges,
} from "./javaRegexSets";

export type JavaRegex =
  | { ok: true; regex: RegExp; groupCount: number; work: RegexWork }
  | { ok: false };

const MAX_QUANTIFIER_BOUND = 2147483647n;
const DOT = "[^\\n\\r\\u0085\\u2028\\u2029]";
const DOLLAR = "(?=(?:\\r\\n|[\\n\\r\\u0085\\u2028\\u2029])?$)(?!(?<=\\r)\\n$)";

type Atom = "none" | "atom" | "group" | "anchor" | "quantified";

interface Quantifier {
  end: number;
  min: number;
  max: number;
}

/** Parses `{n}`, `{n,}` or `{n,m}` at `i` (the `{`); returns the end index (past `}`) and the bounds. */
function parseBraceQuantifier(p: string, i: number): Quantifier {
  const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(p.slice(i));
  if (!m) throw new Decline();
  const low = BigInt(m[1]);
  if (low > MAX_QUANTIFIER_BOUND) throw new Decline();
  let max = Number(low);
  if (m[2] !== undefined) {
    max = Number.POSITIVE_INFINITY;
    if (m[3] !== "") {
      const high = BigInt(m[3]);
      if (high > MAX_QUANTIFIER_BOUND || high < low) throw new Decline();
      max = Number(high);
    }
  }
  return { end: i + m[0].length, min: Number(low), max };
}

function translate(p: string): { source: string; groupCount: number; tree: Item[][] } {
  let source = "";
  let groupCount = 0;
  let last = "none" as Atom;
  let i = 0;
  // The alternation tree: one frame per open group, each holding its alternatives (sequences of items).
  const frames: Item[][][] = [[[]]];
  const sequence = (): Item[] => {
    const alts = frames[frames.length - 1];
    return alts[alts.length - 1];
  };
  const atom = (text: string, next: number, kind: Atom = "atom", item?: Item): void => {
    source += text;
    i = next;
    last = kind;
    if (item !== undefined) sequence().push(item);
  };
  const single = (text: string, next: number, set: Ranges): void =>
    atom(text, next, "atom", { kind: "atom", set, min: 1, max: 1 });
  while (i < p.length) {
    const c = p[i];
    switch (c) {
      case "\\": {
        const e = p[i + 1];
        if (e === undefined) throw new Decline();
        if (ESCAPED_META.has(e)) single(`\\${e}`, i + 2, pointSet(e.codePointAt(0)!));
        else if (e === "-") single("-", i + 2, pointSet(45));
        else if (SIMPLE_ESCAPES.has(e)) single(`\\${e}`, i + 2, simpleEscapeSet(e)!);
        else if (e === "s") single(`[${SPACE_CLASS_BODY}]`, i + 2, SPACE);
        else if (e === "S") single(`[^${SPACE_CLASS_BODY}]`, i + 2, complementSet(SPACE));
        else throw new Decline();
        break;
      }
      case ".":
        single(DOT, i + 1, DOT_SET);
        break;
      case "^":
        atom("^", i + 1, "anchor", { kind: "anchor", dollar: false });
        break;
      case "$":
        atom(DOLLAR, i + 1, "anchor", { kind: "anchor", dollar: true });
        break;
      case "(":
        if (p[i + 1] === "?") throw new Decline();
        groupCount++;
        frames.push([[]]);
        atom("(", i + 1, "none");
        break;
      case ")": {
        if (frames.length === 1) throw new Decline();
        const alts = frames.pop()!;
        atom(")", i + 1, "group", { kind: "group", alts });
        break;
      }
      case "|":
        frames[frames.length - 1].push([]);
        atom("|", i + 1, "none");
        break;
      case "[": {
        const cls = parseClass(p, i);
        single(cls.source, cls.next, cls.set);
        break;
      }
      case "*":
      case "+":
      case "?":
      case "{": {
        if (last !== "atom") throw new Decline();
        const bounds = quantifierAt(p, i);
        source += p.slice(i, bounds.end);
        i = bounds.end;
        if (p[i] === "?") {
          source += "?";
          i++;
        } else if (p[i] === "+") throw new Decline();
        const seq = sequence();
        seq[seq.length - 1] = {
          ...(seq[seq.length - 1] as AtomItem),
          min: bounds.min,
          max: bounds.max,
        };
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
        single(p.slice(i, i + width), i + width, pointSet(cp));
      }
    }
  }
  if (frames.length !== 1) throw new Decline();
  return { source, groupCount, tree: frames[0] };
}

/** The bounds of the quantifier character at `i`: `*`, `+`, `?` or a `{...}` form. */
function quantifierAt(p: string, i: number): Quantifier {
  switch (p[i]) {
    case "*":
      return { end: i + 1, min: 0, max: Number.POSITIVE_INFINITY };
    case "+":
      return { end: i + 1, min: 1, max: Number.POSITIVE_INFINITY };
    case "?":
      return { end: i + 1, min: 0, max: 1 };
    default:
      return parseBraceQuantifier(p, i);
  }
}

const cache = new Map<string, JavaRegex>();

/** Translates a Java pattern into a `u`-mode RegExp when the pattern is inside the allowlist. */
export function compileJavaRegex(pattern: string): JavaRegex {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let result: JavaRegex;
  try {
    const { source, groupCount, tree } = translate(pattern);
    if (!isBacktrackBounded(tree) || widestClass(tree) > MAX_CLASS_RANGES) throw new Decline();
    result = { ok: true, regex: new RegExp(source, "u"), groupCount, work: regexWorkModel(tree) };
  } catch {
    result = { ok: false };
  }
  cache.set(pattern, result);
  return result;
}
