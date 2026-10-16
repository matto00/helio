// HEL-1581 — port of `ExpressionTokenizer.scala` (the compute step's expression language). Character
// classes follow Java's `Character.isLetter` / `isDigit` on a single UTF-16 unit, so an astral letter is
// not an identifier character, exactly as on the JVM.

import { toDoubleOption } from "../javaNumbers";

export type Token =
  | { t: "num"; v: number }
  | { t: "str"; s: string }
  | { t: "ident"; name: string }
  | { t: "ref"; name: string }
  | { t: "fn"; name: string }
  | {
      t:
        | "comma"
        | "plus"
        | "minus"
        | "star"
        | "slash"
        | "lparen"
        | "rparen"
        | "eq"
        | "neq"
        | "lt"
        | "le"
        | "gt"
        | "ge"
        | "eof";
    };

export type Tokenized = { ok: true; tokens: Token[] } | { ok: false; error: string };

const LETTER = /^\p{L}$/u;
const DIGIT = /^\p{Nd}$/u;
const isLetter = (c: string): boolean => LETTER.test(c);
const isDigit = (c: string): boolean => DIGIT.test(c);
const isLetterOrDigit = (c: string): boolean => isLetter(c) || isDigit(c);

const SIMPLE: Record<string, Token> = {
  "+": { t: "plus" },
  "-": { t: "minus" },
  "*": { t: "star" },
  "/": { t: "slash" },
  "(": { t: "lparen" },
  ")": { t: "rparen" },
  ",": { t: "comma" },
  "=": { t: "eq" },
};

export function tokenize(s: string): Tokenized {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (c === "!" && s[i + 1] === "=") {
      tokens.push({ t: "neq" });
      i += 2;
    } else if (c === "<" && s[i + 1] === "=") {
      tokens.push({ t: "le" });
      i += 2;
    } else if (c === "<") {
      tokens.push({ t: "lt" });
      i++;
    } else if (c === ">" && s[i + 1] === "=") {
      tokens.push({ t: "ge" });
      i += 2;
    } else if (c === ">") {
      tokens.push({ t: "gt" });
      i++;
    } else if (Object.prototype.hasOwnProperty.call(SIMPLE, c)) {
      tokens.push(SIMPLE[c]);
      i++;
    } else if (c === '"') {
      let out = "";
      i++;
      let done = false;
      while (i < s.length && !done) {
        const ch = s[i];
        if (ch === "\\" && i + 1 < s.length) {
          const next = s[i + 1];
          if (next === '"') out += '"';
          else if (next === "\\") out += "\\";
          else if (next === "n") out += "\n";
          else if (next === "t") out += "\t";
          else out += `\\${next}`;
          i += 2;
        } else if (ch === '"') {
          done = true;
          i++;
        } else {
          out += ch;
          i++;
        }
      }
      if (!done) return { ok: false, error: "Unterminated string literal" };
      tokens.push({ t: "str", s: out });
    } else if (c === "$") {
      i++;
      if (i >= s.length || !(isLetter(s[i]) || s[i] === "_")) {
        return { ok: false, error: "Expected an identifier after '$'" };
      }
      const start = i;
      while (i < s.length && (isLetterOrDigit(s[i]) || s[i] === "_")) i++;
      while (
        i < s.length &&
        s[i] === "." &&
        i + 1 < s.length &&
        (isLetterOrDigit(s[i + 1]) || s[i + 1] === "_")
      ) {
        i++;
        while (i < s.length && (isLetterOrDigit(s[i]) || s[i] === "_")) i++;
      }
      tokens.push({ t: "ref", name: s.slice(start, i) });
    } else if (isDigit(c) || c === ".") {
      const start = i;
      while (i < s.length && (isDigit(s[i]) || s[i] === ".")) i++;
      const numStr = s.slice(start, i);
      const v = toDoubleOption(numStr);
      if (v === undefined) {
        const last = tokens[tokens.length - 1];
        if (numStr.startsWith(".") && last !== undefined && last.t === "ref") {
          return { ok: false, error: `Incomplete dotted column reference (found '${numStr}')` };
        }
        return { ok: false, error: `Invalid number literal: ${numStr}` };
      }
      tokens.push({ t: "num", v });
    } else if (isLetter(c) || c === "_") {
      const start = i;
      while (i < s.length && (isLetterOrDigit(s[i]) || s[i] === "_")) i++;
      const name = s.slice(start, i);
      tokens.push(s[i] === "(" ? { t: "fn", name } : { t: "ident", name });
    } else {
      return { ok: false, error: `Unexpected character: '${c}'` };
    }
  }
  tokens.push({ t: "eof" });
  return { ok: true, tokens };
}
