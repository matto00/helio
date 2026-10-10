package com.helio.domain.engine

import spray.json._
import ExpressionInterpreter.{evalExpr, valToJs}
import ExpressionParser.{BinOp, Call, Expr, FieldRef, Neg, NumLit, StrLit, isDollarPrefixError, parse, parseLegacy}
import ExpressionTypeInference.inferTypeOf

/** Errors that can occur during expression evaluation at row-processing time. */
sealed trait EvaluationError {
  def message: String
}
object EvaluationError {
  final case class DivisionByZero(expr: String) extends EvaluationError {
    def message: String = s"Division by zero in expression: $expr"
  }
  final case class UnknownField(name: String, availableColumns: Set[String] = Set.empty) extends EvaluationError {
    def message: String = ExpressionEvaluator.unknownFieldMessage(name, availableColumns)
  }
  final case class ParseError(msg: String) extends EvaluationError {
    def message: String = s"Parse error: $msg"
  }
  final case class TypeError(msg: String) extends EvaluationError {
    def message: String = s"Type error: $msg"
  }
}

/**
 * Recursive-descent expression evaluator. Grammar is documented in full at
 * `docs/compute-expression-grammar.md` (shared contract with the frontend); summary:
 *   - Numeric literals, double-quoted string literals
 *   - `$`-prefixed field references (`$col`) — REQUIRED for the strict grammar (see below)
 *   - Arithmetic: +, -, *, / (with correct precedence) and prefix unary `-` (HEL-1403; binds tighter
 *     than `*`/`/`, repeatable, strict grammar only); `-`/`*`/`/` are numeric-strict,
 *     `+` is coercion-permissive (string concatenation if either side is a string)
 *   - Function calls: `concat`, `substring`, `lower`, `upper`, `length`, and the numeric
 *     `floor`, `ceil`, `round(x[, digits])`, `mod`, `abs` (strict numeric, null-propagating)
 *   - Parenthesised sub-expressions
 *   - No external library dependencies
 *
 * Grammar (strict):
 *   expr   → term   (('+' | '-') term)*
 *   term   → unary (('*' | '/') unary)*
 *   unary  → '-' unary | factor
 *   factor → NUMBER | STRING | '$' IDENT | IDENT '(' args ')' | '(' expr ')'
 *   args   → (expr (',' expr)*)?
 *
 * ── Strict vs. legacy-tolerant (design.md Decision 4) ──────────────────────────
 * `parse()` — used by `validate()` — is STRICT-ONLY and never falls back: a bare
 * identifier (not `$`-prefixed, not a function call) is always a parse error. This
 * is deliberate: `validate()` is the entry point for live UI feedback and schema
 * inference (`PipelineAnalyzeService.inferCompute`), and must always enforce the
 * `$`-required grammar for anyone asking "is this well-formed" — including brand-new
 * user input, not just legacy data.
 *
 * `evaluate()` (row-execution, used by `ComputeStep.apply` and
 * `SourceService.applyComputedFields`) and `validateTolerant()` (its sole production caller,
 * `DataTypeService`, was retired outright by HEL-904 — no callers remain in
 * `backend/src/main`, though `ExpressionEvaluatorSpec` still exercises it directly; kept for
 * the strict/legacy-tolerant contract this file documents) retry via a
 * frozen, verbatim copy of the pre-existing bare-identifier parser (`parseLegacy`)
 * when strict parsing fails specifically because a column reference lacks its `$`
 * prefix. This lets already-persisted expressions keep running/saving unmodified
 * with zero data migration, while all *new* validation stays strict.
 */
object ExpressionEvaluator {


  /** Every function name `checkArity`/`applyFn` accepts, alphabetical. Drives the unknown-function
   *  message; `ExpressionEvaluatorSpec` probes it against the dispatcher in both directions. */
  private[engine] val SupportedFunctions: Vector[String] =
    Vector("abs", "ceil", "coalesce", "concat", "floor", "length", "lower", "mod", "round", "substring", "upper")

  /** The numeric-in/numeric-out subset of `SupportedFunctions` (all infer `"float"`); the infer/apply
   *  parity test iterates it, so a new numeric function must be classified here. */
  private[engine] val NumericFunctions: Vector[String] = Vector("abs", "ceil", "floor", "mod", "round")

  /** HEL-888 design.md Decision 1. The write/run-path static predicate:
   *  is `expr` parseable at all — under the same strict-then-legacy grammar
   *  `evaluate` falls back through — regardless of what row it will later be
   *  evaluated against? This is `evaluate`'s parse arm with the evaluation
   *  step removed, so it cannot diverge from run-time parseability by
   *  construction (also see the comment on `evaluate` below, and the
   *  cross-check in `ExpressionEvaluatorSpec`'s agreement test).
   *
   *  Deliberately NOT `validate`: `validate` additionally requires a `$`
   *  prefix on every column reference (no legacy fallback), so a bare
   *  identifier expression that still evaluates correctly today (e.g.
   *  `price * qty`) would 422 on its next edit. Only unparseability — which
   *  cannot vary by row and cannot be true under one grammar but not the
   *  other's *result* (only tried in a different order) — is promoted here.
   *
   *  @return `None` if `expr` parses under either grammar; `Some(message)`
   *          with the parser's own description otherwise. An empty/blank
   *          `expr` is intentionally treated as a parse problem by `parse`
   *          ("Expression is empty") — callers that must treat blank as a
   *          savable draft (write-path `validateRawConfig`) check
   *          `expr.trim.isEmpty` themselves before calling this.
   */
  def parseProblem(expr: String): Option[String] =
    parse(expr) match {
      case Right(_)                              => None
      case Left(msg) if isDollarPrefixError(msg) => parseLegacy(expr).left.toOption
      case Left(msg)                             => Some(msg)
    }

  /** Design D4: an unresolved dotted reference must lead the caller to the right
   *  fix rather than suggest path traversal was attempted. A dotted reference is
   *  matched as ONE literal column name produced by nested-JSON flattening — never
   *  split or traversed — so the message says exactly that and lists the columns
   *  that ARE available, instead of the generic "Unknown field" wording alone. */
  private[engine] def unknownFieldMessage(name: String, available: Set[String]): String =
    if (name.contains('.')) {
      val availList =
        if (available.isEmpty) "no columns are available"
        else s"available columns: ${available.toVector.sorted.mkString(", ")}"
      s"Unknown field: $name — '$name' is matched as a single literal column name produced by " +
        s"nested-JSON flattening, not traversed as a path; check that a column named exactly " +
        s"'$name' exists ($availList)"
    } else {
      s"Unknown field: $name"
    }

  /**
   * Validate expression syntax and field references without evaluating. STRICT:
   * `$`-prefixed column refs are required; a bare identifier is always rejected,
   * even if it matches a known field name. This is the entry point for live UI
   * feedback and schema inference (`PipelineAnalyzeService.inferCompute`) — see
   * design.md Decision 4 for why this never falls back to the legacy grammar.
   *
   * @param expr       Raw expression string
   * @param fieldNames Set of available field names
   * @return `Right(())` if valid; `Left(message)` with a description of the problem
   */
  def validate(expr: String, fieldNames: Set[String]): Either[String, Unit] =
    parse(expr).flatMap(ast => checkRefs(ast, fieldNames))

  /**
   * Same as `validate`, but legacy-tolerant: if strict parsing fails specifically
   * because a column reference lacks its `$` prefix, retries via the frozen
   * `parseLegacy` grammar. Its sole production caller, `DataTypeService` (`validateExpression`,
   * `applyUpdate`'s `exprError` check), was retired outright by HEL-904 — no callers remain in
   * `backend/src/main`, though `ExpressionEvaluatorSpec` still exercises this method directly.
   * Preserved bare-identifier-accepting validation behavior
   * for DataType computed fields, whose save path hard-blocked the whole request on
   * validation failure, unlike the pipeline compute step (design.md Decision 4,
   * "DataTypeService boundary").
   */
  def validateTolerant(expr: String, fieldNames: Set[String]): Either[String, Unit] =
    parse(expr) match {
      case Right(ast) => checkRefs(ast, fieldNames)
      case Left(msg) if isDollarPrefixError(msg) =>
        parseLegacy(expr).flatMap(ast => checkRefs(ast, fieldNames))
      case Left(msg) => Left(msg)
    }

  private def checkRefs(expr: Expr, names: Set[String]): Either[String, Unit] = expr match {
    case NumLit(_) | StrLit(_) => Right(())
    case FieldRef(name) =>
      if (names.contains(name)) Right(()) else Left(unknownFieldMessage(name, names))
    case BinOp(_, l, r) =>
      checkRefs(l, names).flatMap(_ => checkRefs(r, names))
    case Neg(e) => checkRefs(e, names)
    case Call(_, args) =>
      args.foldLeft[Either[String, Unit]](Right(())) { (acc, a) =>
        acc.flatMap(_ => checkRefs(a, names))
      }
  }

  /**
   * Compute the result type (`"float"` or `"string"` — HEL-895/638/906 cycle-3: a canonical
   * `DataFieldType` wire value, not the non-canonical `"number"` this used to emit) of `expr`
   * by walking its AST against a map of field name -> type, without evaluating against real
   * row data. Used by `PipelineAnalyzeService.inferCompute` to derive a compute step's output
   * field type from the expression itself, instead of trusting the (possibly stale) wire
   * `type`. Only called after `validate(expr, fieldTypes.keySet)` succeeds.
   */
  def inferType(expr: String, fieldTypes: Map[String, String]): Either[String, String] =
    parse(expr).flatMap(ast => inferTypeOf(ast, fieldTypes))

  /** HEL-1403: `(field, contexts)` for each text-typed (`string`/`string-body`/`boolean`) field the
   *  STRICT parse of `expr` uses where a number is required (see `ExpressionNumericContexts`). A
   *  legacy/unparseable expression yields nothing. Pure and schema-only (no row reads). */
  def numericContextTextFields(expr: String, fieldTypes: Map[String, String]): Vector[(String, Vector[String])] =
    parse(expr).toOption.fold(Vector.empty[(String, Vector[String])])(ExpressionNumericContexts.textFieldsInNumericContext(_, fieldTypes))

  /** An expression parsed once (HEL-888 design.md Decision 6), ready to be
   *  evaluated against any number of rows without re-parsing. The AST type
   *  is intentionally not exposed — callers get a compiled unit of behavior,
   *  not the grammar's internals. */
  final class CompiledExpression private[engine] (private val ast: Expr) {
    def eval(row: Map[String, JsValue]): Either[EvaluationError, JsValue] =
      evalExpr(ast, row).map(valToJs)
  }

  /**
   * Parse `expr` once, legacy-tolerant exactly like `evaluate` (retries via
   * `parseLegacy` when strict parsing fails only on a missing `$` prefix),
   * and return a [[CompiledExpression]] that can be evaluated against many
   * rows without re-parsing. `ComputeStep.apply` (HEL-888 D6) uses this to
   * pay the parse cost once per step rather than once per row — the parse
   * result cannot vary across rows of the same step.
   *
   * @param expr Raw expression string
   * @return `Right(CompiledExpression)` if `expr` parses; `Left(ParseError)` otherwise
   */
  def compile(expr: String): Either[EvaluationError, CompiledExpression] =
    parse(expr) match {
      case Right(ast) => Right(new CompiledExpression(ast))
      case Left(msg) if isDollarPrefixError(msg) =>
        parseLegacy(expr) match {
          case Right(ast)      => Right(new CompiledExpression(ast))
          case Left(legacyMsg) => Left(EvaluationError.ParseError(legacyMsg))
        }
      case Left(msg) => Left(EvaluationError.ParseError(msg))
    }

  /**
   * Evaluate an expression against a row. Legacy-tolerant: if strict parsing fails
   * specifically because a column reference lacks its `$` prefix, retries via the
   * frozen `parseLegacy` grammar so pre-existing persisted expressions keep
   * producing their pre-change output (design.md Decision 4).
   *
   * Implemented as `compile` + `eval` (HEL-888 D6); kept as a one-shot
   * convenience entry point for callers (`SourceService.applyComputedFields`,
   * tests) that evaluate an expression against a single row and have no
   * reason to hold onto a `CompiledExpression`. `parseProblem` above is this
   * same parse arm with evaluation removed — a change to one's parse
   * behavior belongs in both.
   *
   * @param expr  Raw expression string
   * @param row   Map of field name → JSON value for the current row
   * @return `Right(JsValue)` on success; `Left(EvaluationError)` on failure
   */
  def evaluate(expr: String, row: Map[String, JsValue]): Either[EvaluationError, JsValue] =
    compile(expr).flatMap(_.eval(row))
}
