package com.helio.domain.engine

import spray.json._

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
 *   - Arithmetic: +, -, *, / (with correct precedence); `-`/`*`/`/` are numeric-strict,
 *     `+` is coercion-permissive (string concatenation if either side is a string)
 *   - Function calls: `concat`, `substring`, `lower`, `upper`, `length`
 *   - Parenthesised sub-expressions
 *   - No external library dependencies
 *
 * Grammar (strict):
 *   expr   → term   (('+' | '-') term)*
 *   term   → factor (('*' | '/') factor)*
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
 * `SourceService.applyComputedFields`) and `validateTolerant()` (used only by
 * `DataTypeService`, whose save path hard-blocks on validation failure) retry via a
 * frozen, verbatim copy of the pre-existing bare-identifier parser (`parseLegacy`)
 * when strict parsing fails specifically because a column reference lacks its `$`
 * prefix. This lets already-persisted expressions keep running/saving unmodified
 * with zero data migration, while all *new* validation stays strict.
 */
object ExpressionEvaluator {


  private sealed trait Token
  private object Token {
    final case class Num(v: Double)     extends Token
    final case class Str(s: String)     extends Token
    final case class Ident(name: String) extends Token
    final case class Ref(name: String)   extends Token
    final case class FnName(name: String) extends Token
    case object Comma  extends Token
    case object Plus   extends Token
    case object Minus  extends Token
    case object Star   extends Token
    case object Slash  extends Token
    case object LParen extends Token
    case object RParen extends Token
    case object EOF    extends Token
  }

  /** The exact message the strict parser returns for a bare (non-`$`, non-call)
   *  identifier. Used verbatim by `evaluate()`/`validateTolerant()` to recognize
   *  "this specific failure" and retry via `parseLegacy` — no other parse failure
   *  triggers the legacy fallback. */
  private val DollarPrefixRequiredMsg = "Column references require a '$' prefix"

  // ── Tokenizer (shared by strict and legacy parsing) ─────────────────────────

  private def tokenize(input: String): Either[String, Vector[Token]] = {
    val buf = scala.collection.mutable.ArrayBuffer.empty[Token]
    val s   = input
    var i   = 0

    while (i < s.length) {
      val c = s(i)
      c match {
        case ' ' | '\t' | '\n' | '\r' => i += 1

        case '+' => buf += Token.Plus;   i += 1
        case '-' => buf += Token.Minus;  i += 1
        case '*' => buf += Token.Star;   i += 1
        case '/' => buf += Token.Slash;  i += 1
        case '(' => buf += Token.LParen; i += 1
        case ')' => buf += Token.RParen; i += 1
        case ',' => buf += Token.Comma;  i += 1

        case '"' =>
          // Double-quoted string literal with basic escape support
          val sb    = new StringBuilder
          i += 1
          var done  = false
          while (i < s.length && !done) {
            val ch = s(i)
            if (ch == '\\' && i + 1 < s.length) {
              s(i + 1) match {
                case '"'  => sb += '"';  i += 2
                case '\\' => sb += '\\'; i += 2
                case 'n'  => sb += '\n'; i += 2
                case 't'  => sb += '\t'; i += 2
                case other => sb += '\\'; sb += other; i += 2
              }
            } else if (ch == '"') {
              done = true; i += 1
            } else {
              sb += ch; i += 1
            }
          }
          if (!done) return Left("Unterminated string literal")
          buf += Token.Str(sb.toString)

        case '$' =>
          // design D1: this scan is a deliberate, near-identical duplicate of the
          // bare-identifier scan below rather than a shared helper. `$`-refs alone
          // admit interior dots (design D2); widening the shared bare-identifier
          // scan instead would change what the frozen `LegacyParser` accepts
          // (`a.b` would become one legacy ref instead of a parse error), moving
          // backwards-compatible grammar the ticket requires to stay frozen.
          i += 1
          if (i >= s.length || !(s(i).isLetter || s(i) == '_'))
            return Left("Expected an identifier after '$'")
          val start = i
          while (i < s.length && (s(i).isLetterOrDigit || s(i) == '_')) i += 1
          // design D2: admit any number of interior dots (`$a.b.c` is one ref), but
          // consume a dot only when the character immediately following it is itself
          // an identifier character, so a trailing/doubled dot (`$a.`, `$a..b`) is
          // left unconsumed and becomes a parse error downstream rather than a
          // silently-truncated/empty segment.
          while (i < s.length && s(i) == '.' && i + 1 < s.length &&
                 (s(i + 1).isLetterOrDigit || s(i + 1) == '_')) {
            i += 1 // consume '.'
            while (i < s.length && (s(i).isLetterOrDigit || s(i) == '_')) i += 1
          }
          buf += Token.Ref(s.substring(start, i))

        case d if d.isDigit || d == '.' =>
          val start = i
          while (i < s.length && (s(i).isDigit || s(i) == '.')) i += 1
          val numStr = s.substring(start, i)
          numStr.toDoubleOption match {
            case Some(v) => buf += Token.Num(v)
            case None =>
              // HEL-867 added scope: a trailing/doubled dot directly after a `$`-reference
              // (`$stats.`, `$a..b`) lands here because the ref scan above correctly declined
              // to consume a dot not followed by an identifier char (D2) — the leftover text
              // is a malformed dotted reference, not a malformed number, so name it as such
              // instead of the generic "number literal" wording (standing requirement 4: the
              // wording is behaviour). Gated on the immediately preceding token being a
              // `Token.Ref` AND the leftover text starting with '.', so a genuinely malformed
              // standalone number literal (e.g. `1.2.3`) is never affected.
              if (numStr.startsWith(".") && buf.lastOption.exists(_.isInstanceOf[Token.Ref]))
                return Left(
                  s"Incomplete dotted column reference: '.' must be followed by another " +
                    s"identifier segment, not end the reference or repeat (found '$numStr')"
                )
              else
                return Left(s"Invalid number literal: $numStr")
          }

        case l if l.isLetter || l == '_' =>
          // design D1: this scan intentionally does NOT admit dots, unlike the
          // `$`-ref scan above. It feeds `Token.Ident`/`Token.FnName`, consumed by
          // the frozen `LegacyParser` and the function-name path; widening it would
          // silently change the frozen legacy grammar (`a.b` would parse as one
          // legacy identifier instead of remaining a parse error). Do not merge
          // this with the `$`-ref scan.
          val start = i
          while (i < s.length && (s(i).isLetterOrDigit || s(i) == '_')) i += 1
          val name = s.substring(start, i)
          // A bare identifier immediately followed by '(' is a function call;
          // otherwise it's a bare column-name reference (rejected by the strict
          // parser, accepted by the legacy parser).
          if (i < s.length && s(i) == '(') buf += Token.FnName(name)
          else buf += Token.Ident(name)

        case other => return Left(s"Unexpected character: '${other.toString}'")
      }
    }
    buf += Token.EOF
    Right(buf.toVector)
  }


  private sealed trait Expr
  private final case class NumLit(v: Double)          extends Expr
  private final case class StrLit(s: String)          extends Expr
  private final case class FieldRef(name: String)     extends Expr
  private final case class BinOp(op: Char, l: Expr, r: Expr) extends Expr
  private final case class Call(name: String, args: Vector[Expr]) extends Expr

  /** Arity/known-name check for function calls — shared by the strict parser
   *  (which rejects unknown names/arity at parse time, per
   *  compute-expression-language's "Function-call syntax" requirement). */
  private def checkArity(name: String, argc: Int): Either[String, Unit] = name match {
    case "concat"                     => if (argc >= 1) Right(()) else Left("concat requires at least 1 argument")
    case "substring"                  => if (argc == 3) Right(()) else Left("substring requires 3 arguments")
    case "lower" | "upper" | "length" => if (argc == 1) Right(()) else Left(s"$name requires 1 argument")
    case other                        => Left(s"'$other' is not a recognized function")
  }

  // ── Strict parser (used by parse()/validate() — no legacy fallback) ─────────

  private final class StrictParser(tokens: Vector[Token]) {
    private var pos: Int = 0

    private def peek: Token     = if (pos < tokens.length) tokens(pos) else Token.EOF
    private def advance(): Unit = if (pos < tokens.length) pos += 1

    def parseAll(): Either[String, Expr] =
      parseExpr().flatMap { expr =>
        if (peek != Token.EOF) Left(s"Unexpected token after expression")
        else Right(expr)
      }

    private def parseExpr(): Either[String, Expr] =
      parseTerm().flatMap { first =>
        var acc: Either[String, Expr] = Right(first)
        while (acc.isRight && (peek == Token.Plus || peek == Token.Minus)) {
          val op = if (peek == Token.Plus) '+' else '-'
          advance()
          acc = acc.flatMap(l => parseTerm().map(r => BinOp(op, l, r)))
        }
        acc
      }

    private def parseTerm(): Either[String, Expr] =
      parseFactor().flatMap { first =>
        var acc: Either[String, Expr] = Right(first)
        while (acc.isRight && (peek == Token.Star || peek == Token.Slash)) {
          val op = if (peek == Token.Star) '*' else '/'
          advance()
          acc = acc.flatMap(l => parseFactor().map(r => BinOp(op, l, r)))
        }
        acc
      }

    private def parseArgs(): Either[String, Vector[Expr]] =
      if (peek == Token.RParen) Right(Vector.empty)
      else
        parseExpr().flatMap { first =>
          var acc: Either[String, Vector[Expr]] = Right(Vector(first))
          while (acc.isRight && peek == Token.Comma) {
            advance()
            acc = acc.flatMap(args => parseExpr().map(e => args :+ e))
          }
          acc
        }

    private def parseFactor(): Either[String, Expr] = peek match {
      case Token.Num(v)  => advance(); Right(NumLit(v))
      case Token.Str(s)  => advance(); Right(StrLit(s))
      case Token.Ref(name) => advance(); Right(FieldRef(name))
      case Token.FnName(name) =>
        advance()
        if (peek != Token.LParen) Left(s"Expected '(' after function name '$name'")
        else {
          advance()
          parseArgs().flatMap { args =>
            if (peek != Token.RParen) Left("Expected closing ')' in function call")
            else {
              advance()
              checkArity(name, args.length).map(_ => Call(name, args))
            }
          }
        }
      case Token.Ident(_) => Left(DollarPrefixRequiredMsg)
      case Token.LParen =>
        advance()
        val inner = parseExpr()
        if (peek != Token.RParen) Left("Expected closing ')'")
        else { advance(); inner }
      case Token.EOF => Left("Unexpected end of expression")
      case other     => Left(s"Unexpected token in expression: $other")
    }
  }

  // ── Legacy parser — FROZEN, verbatim copy of the pre-existing bare-identifier
  // parser (design.md Decision 4). Do not add new syntax here; new syntax only
  // ever goes through StrictParser. Only reached from evaluate()/validateTolerant()
  // when strict parsing fails with the "$ prefix" error. ─────────────────────────

  private final class LegacyParser(tokens: Vector[Token]) {
    private var pos: Int = 0

    private def peek: Token     = if (pos < tokens.length) tokens(pos) else Token.EOF
    private def advance(): Unit = if (pos < tokens.length) pos += 1

    def parseAll(): Either[String, Expr] =
      parseExpr().flatMap { expr =>
        if (peek != Token.EOF) Left(s"Unexpected token after expression")
        else Right(expr)
      }

    private def parseExpr(): Either[String, Expr] =
      parseTerm().flatMap { first =>
        var acc: Either[String, Expr] = Right(first)
        while (acc.isRight && (peek == Token.Plus || peek == Token.Minus)) {
          val op = if (peek == Token.Plus) '+' else '-'
          advance()
          acc = acc.flatMap(l => parseTerm().map(r => BinOp(op, l, r)))
        }
        acc
      }

    private def parseTerm(): Either[String, Expr] =
      parseFactor().flatMap { first =>
        var acc: Either[String, Expr] = Right(first)
        while (acc.isRight && (peek == Token.Star || peek == Token.Slash)) {
          val op = if (peek == Token.Star) '*' else '/'
          advance()
          acc = acc.flatMap(l => parseFactor().map(r => BinOp(op, l, r)))
        }
        acc
      }

    private def parseFactor(): Either[String, Expr] = peek match {
      case Token.Num(v)     => advance(); Right(NumLit(v))
      case Token.Str(s)     => advance(); Right(StrLit(s))
      case Token.Ident(name) => advance(); Right(FieldRef(name))
      case Token.LParen =>
        advance()
        val inner = parseExpr()
        if (peek != Token.RParen) Left("Expected closing ')'")
        else { advance(); inner }
      case Token.EOF => Left("Unexpected end of expression")
      case other     => Left(s"Unexpected token in expression: $other")
    }
  }


  private def parse(expr: String): Either[String, Expr] =
    if (expr.trim.isEmpty) Left("Expression is empty")
    else tokenize(expr).flatMap(ts => new StrictParser(ts).parseAll())

  private def parseLegacy(expr: String): Either[String, Expr] =
    if (expr.trim.isEmpty) Left("Expression is empty")
    else tokenize(expr).flatMap(ts => new LegacyParser(ts).parseAll())

  private def isDollarPrefixError(msg: String): Boolean = msg == DollarPrefixRequiredMsg

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
   * `parseLegacy` grammar. Used only by `DataTypeService` (`validateExpression`,
   * `applyUpdate`'s `exprError` check) to preserve today's bare-identifier-accepting
   * validation behavior for DataType computed fields — a save path that hard-blocks
   * the whole request on validation failure, unlike the pipeline compute step
   * (design.md Decision 4, "DataTypeService boundary").
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
    case Call(_, args) =>
      args.foldLeft[Either[String, Unit]](Right(())) { (acc, a) =>
        acc.flatMap(_ => checkRefs(a, names))
      }
  }


  /**
   * Compute the result type (`"number"` or `"string"`) of `expr` by walking its AST
   * against a map of field name → type, without evaluating against real row data.
   * Used by `PipelineAnalyzeService.inferCompute` to derive a compute step's output
   * field type from the expression itself, instead of trusting the (possibly stale)
   * wire `type`. Only called after `validate(expr, fieldTypes.keySet)` succeeds.
   */
  def inferType(expr: String, fieldTypes: Map[String, String]): Either[String, String] =
    parse(expr).flatMap(ast => inferTypeOf(ast, fieldTypes))

  private def inferTypeOf(expr: Expr, fieldTypes: Map[String, String]): Either[String, String] =
    expr match {
      case NumLit(_) => Right("number")
      case StrLit(_) => Right("string")
      case FieldRef(name) =>
        fieldTypes.get(name).toRight(unknownFieldMessage(name, fieldTypes.keySet))
      case BinOp(op, l, r) =>
        for {
          lt <- inferTypeOf(l, fieldTypes)
          rt <- inferTypeOf(r, fieldTypes)
        } yield {
          if (op == '+' && (lt == "string" || rt == "string")) "string"
          else if (op == '+') "number"
          else "number"
        }
      case Call(name, args) =>
        args
          .foldLeft[Either[String, Unit]](Right(())) { (acc, a) =>
            acc.flatMap(_ => inferTypeOf(a, fieldTypes).map(_ => ()))
          }
          .map { _ =>
            name match {
              case "length" => "number"
              case _        => "string" // concat, substring, lower, upper
            }
          }
    }


  /** Intermediate value type used during evaluation. */
  private sealed trait Val
  private final case class VNum(v: Double) extends Val
  private final case class VStr(s: String) extends Val
  private case object VNull extends Val

  /**
   * Evaluate an expression against a row. Legacy-tolerant: if strict parsing fails
   * specifically because a column reference lacks its `$` prefix, retries via the
   * frozen `parseLegacy` grammar so pre-existing persisted expressions keep
   * producing their pre-change output (design.md Decision 4).
   *
   * @param expr  Raw expression string
   * @param row   Map of field name → JSON value for the current row
   * @return `Right(JsValue)` on success; `Left(EvaluationError)` on failure
   */
  def evaluate(expr: String, row: Map[String, JsValue]): Either[EvaluationError, JsValue] =
    parse(expr) match {
      case Right(ast) => evalExpr(ast, row).map(valToJs)
      case Left(msg) if isDollarPrefixError(msg) =>
        parseLegacy(expr) match {
          case Right(ast)     => evalExpr(ast, row).map(valToJs)
          case Left(legacyMsg) => Left(EvaluationError.ParseError(legacyMsg))
        }
      case Left(msg) => Left(EvaluationError.ParseError(msg))
    }

  private def evalExpr(expr: Expr, row: Map[String, JsValue]): Either[EvaluationError, Val] =
    expr match {
      case NumLit(v) => Right(VNum(v))
      case StrLit(s) => Right(VStr(s))

      case FieldRef(name) =>
        row.get(name) match {
          case None               => Left(EvaluationError.UnknownField(name, row.keySet))
          case Some(JsNull)       => Right(VNull)
          case Some(JsNumber(v))  => Right(VNum(v.toDouble))
          case Some(JsString(s))  => Right(VStr(s))
          case Some(JsBoolean(b)) => Right(VStr(b.toString))
          case Some(other)        => Right(VStr(other.compactPrint))
        }

      case BinOp(op, l, r) =>
        for {
          lv <- evalExpr(l, row)
          rv <- evalExpr(r, row)
          res <- applyOp(op, lv, rv, expr.toString)
        } yield res

      case Call(name, args) =>
        args
          .foldLeft[Either[EvaluationError, Vector[Val]]](Right(Vector.empty)) { (accE, a) =>
            accE.flatMap(acc => evalExpr(a, row).map(v => acc :+ v))
          }
          .flatMap(vals => applyFn(name, vals))
    }

  private def applyOp(op: Char, l: Val, r: Val, exprStr: String): Either[EvaluationError, Val] =
    (op, l, r) match {
      // Null propagation — if either side is null the result is null
      case (_, VNull, _) | (_, _, VNull) => Right(VNull)

      case ('+', VNum(a), VNum(b)) => Right(VNum(a + b))
      case ('-', VNum(a), VNum(b)) => Right(VNum(a - b))
      case ('*', VNum(a), VNum(b)) => Right(VNum(a * b))
      case ('/', VNum(a), VNum(b)) =>
        if (b == 0) Left(EvaluationError.DivisionByZero(exprStr))
        else Right(VNum(a / b))

      case ('+', VStr(a), VStr(b)) => Right(VStr(a + b))
      case ('+', VNum(a), VStr(b)) => Right(VStr(numStr(a) + b))
      case ('+', VStr(a), VNum(b)) => Right(VStr(a + numStr(b)))

      case _ =>
        Left(EvaluationError.TypeError(
          s"Operator '$op' cannot be applied to ${typeName(l)} and ${typeName(r)}"
        ))
    }

  /** Function-call semantics (design.md Decision 3). Null-propagating like
   *  `applyOp`: if any argument evaluates to null, the result is null rather than
   *  an error. `substring` clamps out-of-range start/end indices instead of
   *  throwing; a non-string first argument to `substring`/`lower`/`upper`/`length`
   *  is still a `TypeError`. */
  private def applyFn(name: String, args: Vector[Val]): Either[EvaluationError, Val] =
    if (args.contains(VNull)) Right(VNull)
    else
      name match {
        case "concat" =>
          Right(VStr(args.map(concatStr).mkString))

        case "substring" =>
          (args(0), args(1), args(2)) match {
            case (VStr(s), VNum(startD), VNum(endD)) =>
              val len         = s.length
              val start       = math.max(0, math.min(startD.toInt, len))
              val endClamped  = math.max(start, math.min(endD.toInt, len))
              Right(VStr(s.substring(start, endClamped)))
            case (other, _, _) if !other.isInstanceOf[VStr] =>
              Left(EvaluationError.TypeError(
                s"substring requires a string first argument, got ${typeName(other)}"
              ))
            case _ =>
              Left(EvaluationError.TypeError("substring requires numeric start/end arguments"))
          }

        case "lower" =>
          args.head match {
            case VStr(s) => Right(VStr(s.toLowerCase))
            case other   => Left(EvaluationError.TypeError(s"lower requires a string argument, got ${typeName(other)}"))
          }

        case "upper" =>
          args.head match {
            case VStr(s) => Right(VStr(s.toUpperCase))
            case other   => Left(EvaluationError.TypeError(s"upper requires a string argument, got ${typeName(other)}"))
          }

        case "length" =>
          args.head match {
            case VStr(s) => Right(VNum(s.length.toDouble))
            case other   => Left(EvaluationError.TypeError(s"length requires a string argument, got ${typeName(other)}"))
          }

        case other =>
          // Unreachable in practice: unknown function names are rejected at parse
          // time by checkArity, before evaluation is ever reached.
          Left(EvaluationError.ParseError(s"Unknown function: $other"))
      }

  private def concatStr(v: Val): String = v match {
    case VNum(n) => numStr(n)
    case VStr(s) => s
    case VNull   => ""
  }

  private def numStr(v: Double): String =
    if (v.isWhole) v.toLong.toString else v.toString

  private def typeName(v: Val): String = v match {
    case VNum(_) => "number"
    case VStr(_) => "string"
    case VNull   => "null"
  }

  private def valToJs(v: Val): JsValue = v match {
    case VNum(n) => JsNumber(n)
    case VStr(s) => JsString(s)
    case VNull   => JsNull
  }
}
