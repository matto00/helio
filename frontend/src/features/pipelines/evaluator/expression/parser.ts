// HEL-1581 — port of the STRICT parser in `ExpressionParser.scala` (the `$`-required grammar of
// `docs/compute-expression-grammar.md`). The frozen legacy bare-identifier parser is deliberately not
// ported: a strict failure that is the "needs a '$' prefix" error declines the step as
// `legacyExpression` (the server then retries the legacy grammar).
//
// The control flow mirrors the Scala `Either` threading exactly, including the quirk that a failure
// inside parentheses is replaced by "Expected closing ')'" unless it is the nesting-limit error.

import { javaTrim } from "../javaNumbers";
import { tokenize, type Token } from "./tokenizer";

export type Expr =
  | { k: "num"; v: number }
  | { k: "str"; s: string }
  | { k: "bool"; b: boolean }
  | { k: "ref"; name: string }
  | { k: "bin"; op: "+" | "-" | "*" | "/"; l: Expr; r: Expr }
  | { k: "neg"; e: Expr }
  | { k: "cmp"; op: "=" | "!=" | "<" | "<=" | ">" | ">="; l: Expr; r: Expr }
  | { k: "and"; l: Expr; r: Expr }
  | { k: "or"; l: Expr; r: Expr }
  | { k: "not"; e: Expr }
  | { k: "call"; name: string; args: Expr[] };

export type Parsed =
  | { ok: true; expr: Expr }
  | { ok: false; error: string; unknownFunction?: string };

/** The exact message the strict parser returns for a bare (non-`$`, non-call) identifier. */
export const DOLLAR_PREFIX_REQUIRED = "Column references require a '$' prefix";
export const TRUNC_UNITS = [
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "quarter",
  "year",
] as const;
const UNITS_MESSAGE = `date_trunc unit must be a string literal, one of: ${TRUNC_UNITS.join(", ")}`;

const MAX_NESTING_DEPTH = 100;
const MAX_TREE_DEPTH = 200;
const NESTING_MSG = `Expression is nested too deeply (at most ${MAX_NESTING_DEPTH} levels)`;
const TREE_DEPTH_MSG = `Expression tree is too deep (at most ${MAX_TREE_DEPTH} levels)`;
const KEYWORDS = new Set(["and", "or", "not", "true", "false"]);

/** The arity rule of every function the TypeScript evaluator implements; a name absent here is unknown. */
export type ArityCheck = (argc: number) => string | undefined;
const exactly =
  (n: number, text: string): ArityCheck =>
  (argc) =>
    argc === n ? undefined : text;
export const FUNCTION_ARITY: Record<string, ArityCheck> = {
  concat: (argc) => (argc >= 1 ? undefined : "concat requires at least 1 argument"),
  substring: exactly(3, "substring requires 3 arguments"),
  lower: exactly(1, "lower requires 1 argument"),
  upper: exactly(1, "upper requires 1 argument"),
  length: exactly(1, "length requires 1 argument"),
  floor: exactly(1, "floor requires 1 argument"),
  ceil: exactly(1, "ceil requires 1 argument"),
  abs: exactly(1, "abs requires 1 argument"),
  coalesce: (argc) => (argc >= 2 ? undefined : "coalesce requires at least 2 arguments"),
  if: exactly(3, "if requires 3 arguments (condition, then, else)"),
  mod: exactly(2, "mod requires 2 arguments"),
  seconds_between: exactly(2, "seconds_between requires 2 arguments"),
  date_trunc: exactly(2, "date_trunc requires 2 arguments"),
  add_days: exactly(2, "add_days requires 2 arguments"),
  round: (argc) => (argc === 1 || argc === 2 ? undefined : "round requires 1 or 2 arguments"),
};

type R<T> = { ok: true; v: T } | { ok: false; e: string; unknownFunction?: string };
const ok = <T>(v: T): R<T> => ({ ok: true, v });
const err = (e: string, unknownFunction?: string): R<never> => ({ ok: false, e, unknownFunction });

function keywordOf(t: Token): string | undefined {
  if (t.t === "ident" || t.t === "fn") {
    const lower = t.name.toLowerCase();
    return KEYWORDS.has(lower) ? lower : undefined;
  }
  return undefined;
}

const reservedWordMsg = (word: string): string =>
  `'${word}' is a reserved word (boolean operator or literal) and cannot be used as a value or column name here`;

function treeDepth(root: Expr): number {
  let deepest = 0;
  const stack: Array<[Expr, number]> = [[root, 1]];
  while (stack.length > 0) {
    const [e, d] = stack.pop()!;
    if (d > deepest) deepest = d;
    switch (e.k) {
      case "bin":
      case "cmp":
      case "and":
      case "or":
        stack.push([e.l, d + 1], [e.r, d + 1]);
        break;
      case "neg":
      case "not":
        stack.push([e.e, d + 1]);
        break;
      case "call":
        for (const a of e.args) stack.push([a, d + 1]);
        break;
      default:
    }
  }
  return deepest;
}

const CMP_OPS: Partial<Record<Token["t"], "=" | "!=" | "<" | "<=" | ">" | ">=">> = {
  eq: "=",
  neq: "!=",
  lt: "<",
  le: "<=",
  gt: ">",
  ge: ">=",
};

class StrictParser {
  private pos = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : { t: "eof" };
  }

  private advance(): void {
    if (this.pos < this.tokens.length) this.pos++;
  }

  private nested<A>(body: () => R<A>): R<A> {
    if (this.depth >= MAX_NESTING_DEPTH) return err(NESTING_MSG);
    this.depth++;
    try {
      return body();
    } finally {
      this.depth--;
    }
  }

  parseAll(): R<Expr> {
    const expr = this.parseOr();
    if (!expr.ok) return expr;
    return this.peek().t !== "eof" ? err("Unexpected token after expression") : expr;
  }

  private atKeyword(word: string): boolean {
    return keywordOf(this.peek()) === word;
  }

  private parseOr(): R<Expr> {
    let acc = this.parseAnd();
    while (acc.ok && this.atKeyword("or")) {
      this.advance();
      const l = acc.v;
      const r = this.parseAnd();
      acc = r.ok ? ok<Expr>({ k: "or", l, r: r.v }) : r;
    }
    return acc;
  }

  private parseAnd(): R<Expr> {
    let acc = this.parseNot();
    while (acc.ok && this.atKeyword("and")) {
      this.advance();
      const l = acc.v;
      const r = this.parseNot();
      acc = r.ok ? ok<Expr>({ k: "and", l, r: r.v }) : r;
    }
    return acc;
  }

  private parseNot(): R<Expr> {
    if (!this.atKeyword("not")) return this.parseCmp();
    this.advance();
    const next = this.peek().t;
    if (next === "eof" || next === "rparen" || next === "comma") return err(reservedWordMsg("not"));
    const inner = this.nested(() => this.parseNot());
    return inner.ok ? ok<Expr>({ k: "not", e: inner.v }) : inner;
  }

  private parseCmp(): R<Expr> {
    const l = this.parseSum();
    if (!l.ok) return l;
    const op = CMP_OPS[this.peek().t];
    if (op === undefined) return l;
    const opTok = this.peek().t;
    this.advance();
    const after = this.peek().t;
    if (opTok === "eq" && after === "eq") return err("'==' is not supported; use '=' to compare");
    if (opTok === "lt" && after === "gt")
      return err("'<>' is not supported; use '!=' for not-equal");
    const r = this.parseSum();
    if (!r.ok) return r;
    if (CMP_OPS[this.peek().t] !== undefined) {
      return err(
        "Comparison operators cannot be chained; parenthesise one comparison or join them with 'and'",
      );
    }
    return ok<Expr>({ k: "cmp", op, l: l.v, r: r.v });
  }

  private parseSum(): R<Expr> {
    let acc = this.parseTerm();
    while (acc.ok && (this.peek().t === "plus" || this.peek().t === "minus")) {
      const op = this.peek().t === "plus" ? "+" : "-";
      this.advance();
      const l = acc.v;
      const r = this.parseTerm();
      acc = r.ok ? ok<Expr>({ k: "bin", op, l, r: r.v }) : r;
    }
    return acc;
  }

  private parseTerm(): R<Expr> {
    let acc = this.parseUnary();
    while (acc.ok && (this.peek().t === "star" || this.peek().t === "slash")) {
      const op = this.peek().t === "star" ? "*" : "/";
      this.advance();
      const l = acc.v;
      const r = this.parseUnary();
      acc = r.ok ? ok<Expr>({ k: "bin", op, l, r: r.v }) : r;
    }
    return acc;
  }

  private parseUnary(): R<Expr> {
    if (this.peek().t !== "minus") return this.parseFactor();
    this.advance();
    const inner = this.nested(() => this.parseUnary());
    return inner.ok ? ok<Expr>({ k: "neg", e: inner.v }) : inner;
  }

  private parseArgs(firstArgError: (m: string) => string): R<Expr[]> {
    if (this.peek().t === "rparen") return ok<Expr[]>([]);
    const first = this.parseOr();
    if (!first.ok) return { ...first, e: firstArgError(first.e) };
    const args: Expr[] = [first.v];
    while (this.peek().t === "comma") {
      this.advance();
      const next = this.parseOr();
      if (!next.ok) return next;
      args.push(next.v);
    }
    return ok(args);
  }

  private parseFactor(): R<Expr> {
    const t = this.peek();
    switch (t.t) {
      case "num":
        this.advance();
        return ok<Expr>({ k: "num", v: t.v });
      case "str":
        this.advance();
        return ok<Expr>({ k: "str", s: t.s });
      case "ref":
        this.advance();
        return ok<Expr>({ k: "ref", name: t.name });
      default:
    }
    const keyword = keywordOf(t);
    if (keyword !== undefined) {
      if (keyword === "true" || keyword === "false") {
        this.advance();
        return ok<Expr>({ k: "bool", b: keyword === "true" });
      }
      return err(reservedWordMsg(keyword));
    }
    if (t.t === "fn") return this.parseCall(t.name);
    if (t.t === "ident") return err(DOLLAR_PREFIX_REQUIRED);
    if (t.t === "lparen") {
      this.advance();
      const inner = this.nested(() => this.parseOr());
      if (!inner.ok && inner.e === NESTING_MSG) return inner;
      if (this.peek().t !== "rparen") return err("Expected closing ')'");
      this.advance();
      return inner;
    }
    if (t.t === "eof") return err("Unexpected end of expression");
    return err(`Unexpected token in expression: ${t.t}`);
  }

  private parseCall(name: string): R<Expr> {
    this.advance();
    if (this.peek().t !== "lparen") return err(`Expected '(' after function name '${name}'`);
    this.advance();
    const firstArgError =
      name === "date_trunc"
        ? (m: string) => (m === DOLLAR_PREFIX_REQUIRED ? UNITS_MESSAGE : m)
        : (m: string) => m;
    const args = this.nested(() => this.parseArgs(firstArgError));
    if (!args.ok) return args;
    if (this.peek().t !== "rparen") return err("Expected closing ')' in function call");
    this.advance();
    const arity = Object.prototype.hasOwnProperty.call(FUNCTION_ARITY, name)
      ? FUNCTION_ARITY[name]
      : undefined;
    if (arity === undefined) return err(`'${name}' is not a recognized function`, name);
    const problem = arity(args.v.length);
    if (problem !== undefined) return err(problem);
    if (name === "date_trunc") {
      const unit = args.v[0];
      if (unit.k !== "str" || !(TRUNC_UNITS as readonly string[]).includes(unit.s))
        return err(UNITS_MESSAGE);
    }
    return ok<Expr>({ k: "call", name, args: args.v });
  }
}

/** Strict parse; the result also reports a call to a function the evaluator does not implement. */
export function parseExpression(expr: string): Parsed {
  if (javaTrim(expr) === "") return { ok: false, error: "Expression is empty" };
  const tokens = tokenize(expr);
  if (!tokens.ok) return { ok: false, error: tokens.error };
  const parsed = new StrictParser(tokens.tokens).parseAll();
  if (!parsed.ok) return { ok: false, error: parsed.e, unknownFunction: parsed.unknownFunction };
  if (treeDepth(parsed.v) > MAX_TREE_DEPTH) return { ok: false, error: TREE_DEPTH_MSG };
  return { ok: true, expr: parsed.v };
}
