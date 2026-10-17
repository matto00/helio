// HEL-1581 — compiling a compute expression once per step (the parse cannot vary by row), and the
// function/operator/literal tables that check 3 holds to `compute-expression-functions.json`.

import { cellOfVal, evalExpr } from "./interpreter";
import { DOLLAR_PREFIX_REQUIRED, FUNCTION_ARITY, parseExpression, type Expr } from "./parser";
import { EvalError } from "./types";
import type { Row, Value } from "../value";

/** Every function the TypeScript evaluator implements, alphabetical (check 3). */
export const SUPPORTED_FUNCTIONS: readonly string[] = Object.keys(FUNCTION_ARITY).sort();
/** The comparison and boolean operators the strict parser accepts (check 3). */
export const SUPPORTED_OPERATORS: readonly string[] = [
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "and",
  "or",
  "not",
];
/** The reserved boolean literals (check 3). */
export const BOOLEAN_LITERALS: readonly string[] = ["true", "false"];

export type CompiledExpression =
  | { kind: "ok"; run: (row: Row) => Value }
  /** A strict parse problem: the step's `requiredConfigProblems` reports it. */
  | { kind: "parseError"; message: string }
  /** The strict parse failed only for a missing `$` prefix: the server retries the legacy grammar. */
  | { kind: "legacy" }
  /** The expression calls a function the TypeScript evaluator does not implement. */
  | { kind: "unknownFunction"; name: string };

const cache = new Map<string, CompiledExpression>();
const CACHE_LIMIT = 500;

function evaluator(expr: Expr): (row: Row) => Value {
  return (row) => {
    try {
      return cellOfVal(evalExpr(expr, row));
    } catch (e) {
      if (e instanceof EvalError) return null;
      throw e;
    }
  };
}

export function compileExpression(source: string): CompiledExpression {
  const hit = cache.get(source);
  if (hit) return hit;
  const parsed = parseExpression(source);
  let result: CompiledExpression;
  if (parsed.ok) result = { kind: "ok", run: evaluator(parsed.expr) };
  else if (parsed.unknownFunction !== undefined)
    result = { kind: "unknownFunction", name: parsed.unknownFunction };
  else if (parsed.error === DOLLAR_PREFIX_REQUIRED) result = { kind: "legacy" };
  else result = { kind: "parseError", message: parsed.error };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(source, result);
  return result;
}
