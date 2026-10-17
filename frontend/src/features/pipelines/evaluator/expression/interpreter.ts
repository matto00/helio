// HEL-1581 — port of `ExpressionInterpreter.scala`: row evaluation and function dispatch over the
// parsed AST. A per-row failure throws `EvalError`; the compute step turns it into a `null` cell.

import { Integral, type Row, type Value, javaDoubleToString } from "../value";
import { doubleToInt } from "../javaNumbers";
import { addDays, dateTrunc, secondsBetween } from "./dateFunctions";
import { roundHalfUp } from "./decimal";
import type { Expr } from "./parser";
import { EvalError, type Val } from "./types";

const hasOwn = Object.prototype.hasOwnProperty;

/** A row cell as the expression sees it (`anyToJsValue` then `JsNumber`): a non-finite double is null. */
function valOfCell(v: Value): Val {
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? (v === 0 ? 0 : v) : null;
  if (v instanceof Integral) return v.value;
  return v;
}

const typeName = (v: Val): string =>
  v === null
    ? "null"
    : typeof v === "number"
      ? "number"
      : typeof v === "string"
        ? "string"
        : "boolean";

/** `numStr`: a whole number prints without `.0` (saturating at Long's range, as `toLong` does). */
export function numStr(v: number): string {
  if (Number.isNaN(v) || !Number.isFinite(v)) return javaDoubleToString(v);
  if (Number.isInteger(v)) {
    if (v >= 2 ** 63) return "9223372036854775807";
    if (v <= -(2 ** 63)) return "-9223372036854775808";
    return BigInt(v).toString();
  }
  return javaDoubleToString(v);
}

function concatStr(v: Val): string {
  if (v === null) return "";
  if (typeof v === "number") return numStr(v);
  return typeof v === "boolean" ? String(v) : v;
}

function evalBool(expr: Expr, row: Row): boolean | null {
  const v = evalExpr(expr, row);
  if (v === null || typeof v === "boolean") return v;
  throw new EvalError(`Expected a boolean but got ${typeName(v)}`);
}

function compare(op: string, l: Val, r: Val): Val {
  if (l === null || r === null) return null;
  if (typeof l === "number" && typeof r === "number") {
    switch (op) {
      case "=":
        return l === r;
      case "!=":
        return l !== r;
      case "<":
        return l < r;
      case "<=":
        return l <= r;
      case ">":
        return l > r;
      default:
        return l >= r;
    }
  }
  if (typeof l === "string" && typeof r === "string") {
    const c = l < r ? -1 : l > r ? 1 : 0;
    switch (op) {
      case "=":
        return c === 0;
      case "!=":
        return c !== 0;
      case "<":
        return c < 0;
      case "<=":
        return c <= 0;
      case ">":
        return c > 0;
      default:
        return c >= 0;
    }
  }
  if (typeof l === "boolean" && typeof r === "boolean" && (op === "=" || op === "!=")) {
    return op === "=" ? l === r : l !== r;
  }
  throw new EvalError(`Operator '${op}' cannot compare ${typeName(l)} with ${typeName(r)}`);
}

function applyOp(op: string, l: Val, r: Val): Val {
  if (l === null || r === null) return null;
  if (typeof l === "number" && typeof r === "number") {
    switch (op) {
      case "+":
        return l + r;
      case "-":
        return l - r;
      case "*":
        return l * r;
      default:
        if (r === 0) throw new EvalError("Division by zero");
        return l / r;
    }
  }
  const textual = (v: Val): boolean => typeof v === "string" || typeof v === "boolean";
  if (op === "+" && (textual(l) || textual(r))) return concatStr(l) + concatStr(r);
  throw new EvalError(`Operator '${op}' cannot be applied to ${typeName(l)} and ${typeName(r)}`);
}

const TEXT_ARG_FUNCTIONS = new Set(["substring", "lower", "upper", "length"]);

function numericUnary(name: string, v: Val, f: (n: number) => number): Val {
  if (typeof v !== "number")
    throw new EvalError(`${name} requires a numeric argument, got ${typeName(v)}`);
  return f(v) + 0;
}

function applyFn(name: string, rawArgs: Val[]): Val {
  if (rawArgs.includes(null)) return null;
  const args =
    TEXT_ARG_FUNCTIONS.has(name) && typeof rawArgs[0] === "boolean"
      ? [String(rawArgs[0]), ...rawArgs.slice(1)]
      : rawArgs;
  switch (name) {
    case "concat":
      return args.map(concatStr).join("");
    case "substring": {
      const [s, startD, endD] = args;
      if (typeof s !== "string")
        throw new EvalError(`substring requires a string first argument, got ${typeName(s)}`);
      if (typeof startD !== "number" || typeof endD !== "number")
        throw new EvalError("substring requires numeric start/end arguments");
      const start = Math.max(0, Math.min(doubleToInt(startD), s.length));
      const end = Math.max(start, Math.min(doubleToInt(endD), s.length));
      return s.slice(start, end);
    }
    case "lower":
    case "upper":
    case "length": {
      const s = args[0];
      if (typeof s !== "string")
        throw new EvalError(`${name} requires a string argument, got ${typeName(s)}`);
      if (name === "lower") return s.toLowerCase();
      return name === "upper" ? s.toUpperCase() : s.length;
    }
    case "seconds_between":
      return secondsBetween(args[0], args[1]);
    case "date_trunc":
      return dateTrunc(args[0], args[1]);
    case "add_days":
      return addDays(args[0], args[1]);
    case "floor":
      return numericUnary(name, args[0], Math.floor);
    case "ceil":
      return numericUnary(name, args[0], Math.ceil);
    case "abs":
      return numericUnary(name, args[0], Math.abs);
    case "round": {
      const x = args[0];
      if (typeof x !== "number")
        throw new EvalError(`round requires a numeric argument, got ${typeName(x)}`);
      if (args.length === 1) return roundHalfUp(x, 0);
      const d = args[1];
      if (typeof d !== "number")
        throw new EvalError(`round requires a numeric digits argument, got ${typeName(d)}`);
      if (!Number.isInteger(d))
        throw new EvalError("round requires a whole-number digits argument");
      return roundHalfUp(x, doubleToInt(Math.max(-308, Math.min(308, d))));
    }
    case "mod": {
      const [a, b] = args;
      if (typeof a !== "number" || typeof b !== "number") {
        throw new EvalError(
          `mod requires numeric arguments, got ${typeName(typeof a === "number" ? b : a)}`,
        );
      }
      if (b === 0) throw new EvalError("Division by zero in mod");
      const r = a % b;
      return (r !== 0 && r < 0 !== b < 0 ? r + b : r) + 0;
    }
    default:
      throw new EvalError(`Unknown function: ${name}`);
  }
}

export function evalExpr(expr: Expr, row: Row): Val {
  switch (expr.k) {
    case "num":
      return expr.v;
    case "str":
      return expr.s;
    case "bool":
      return expr.b;
    case "ref": {
      if (!hasOwn.call(row, expr.name)) throw new EvalError(`Unknown field: ${expr.name}`);
      return valOfCell(row[expr.name]);
    }
    case "bin": {
      const l = evalExpr(expr.l, row);
      const r = evalExpr(expr.r, row);
      return applyOp(expr.op, l, r);
    }
    case "neg": {
      const v = evalExpr(expr.e, row);
      if (v === null) return null;
      if (typeof v === "number") return -v + 0;
      throw new EvalError(`Operator '-' cannot be applied to ${typeName(v)}`);
    }
    case "cmp": {
      const l = evalExpr(expr.l, row);
      const r = evalExpr(expr.r, row);
      return compare(expr.op, l, r);
    }
    case "and": {
      const l = evalBool(expr.l, row);
      if (l === false) return false;
      const r = evalBool(expr.r, row);
      if (r === false) return false;
      return l === true && r === true ? true : null;
    }
    case "or": {
      const l = evalBool(expr.l, row);
      if (l === true) return true;
      const r = evalBool(expr.r, row);
      if (r === true) return true;
      return l === false && r === false ? false : null;
    }
    case "not": {
      const b = evalBool(expr.e, row);
      return b === null ? null : !b;
    }
    case "call":
      return evalCall(expr.name, expr.args, row);
  }
}

function evalCall(name: string, args: Expr[], row: Row): Val {
  if (name === "if") {
    const cond = evalBool(args[0], row);
    return evalExpr(cond === true ? args[1] : args[2], row);
  }
  if (name === "coalesce") {
    for (const a of args) {
      const v = evalExpr(a, row);
      if (v !== null) return v;
    }
    return null;
  }
  return applyFn(
    name,
    args.map((a) => evalExpr(a, row)),
  );
}

/** The row cell a result `Val` becomes (`valToJs` then `jsValueToAny`): a non-finite or negative-zero double is normalized. */
export function cellOfVal(v: Val): Value {
  if (typeof v === "number") return Number.isFinite(v) ? (v === 0 ? 0 : v) : null;
  return v;
}
