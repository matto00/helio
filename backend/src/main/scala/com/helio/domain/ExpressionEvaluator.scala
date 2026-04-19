package com.helio.domain

import spray.json._

/** Errors that can occur during expression evaluation at row-processing time. */
sealed trait EvaluationError {
  def message: String
}
object EvaluationError {
  final case class DivisionByZero(expr: String) extends EvaluationError {
    def message: String = s"Division by zero in expression: $expr"
  }
  final case class UnknownField(name: String) extends EvaluationError {
    def message: String = s"Unknown field: $name"
  }
  final case class ParseError(msg: String) extends EvaluationError {
    def message: String = s"Parse error: $msg"
  }
  final case class TypeError(msg: String) extends EvaluationError {
    def message: String = s"Type error: $msg"
  }
}

/**
 * Recursive-descent expression evaluator supporting:
 *   - Numeric literals and field references
 *   - Arithmetic: +, -, *, / (with correct precedence)
 *   - String literals (double-quoted) and string concatenation via +
 *   - Parenthesised sub-expressions
 *   - No external library dependencies
 *
 * Grammar:
 *   expr   → term   (('+' | '-') term)*
 *   term   → factor (('*' | '/') factor)*
 *   factor → NUMBER | STRING | IDENT | '(' expr ')'
 */
object ExpressionEvaluator {

  // ── Tokens ──────────────────────────────────────────────────────────────────

  private sealed trait Token
  private object Token {
    final case class Num(v: Double) extends Token
    final case class Str(s: String) extends Token
    final case class Ident(name: String) extends Token
    case object Plus   extends Token
    case object Minus  extends Token
    case object Star   extends Token
    case object Slash  extends Token
    case object LParen extends Token
    case object RParen extends Token
    case object EOF    extends Token
  }

  // ── Tokenizer ───────────────────────────────────────────────────────────────

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

        case d if d.isDigit || d == '.' =>
          val start = i
          while (i < s.length && (s(i).isDigit || s(i) == '.')) i += 1
          val numStr = s.substring(start, i)
          numStr.toDoubleOption match {
            case Some(v) => buf += Token.Num(v)
            case None    => return Left(s"Invalid number literal: $numStr")
          }

        case l if l.isLetter || l == '_' =>
          val start = i
          while (i < s.length && (s(i).isLetterOrDigit || s(i) == '_')) i += 1
          buf += Token.Ident(s.substring(start, i))

        case other => return Left(s"Unexpected character: '${other.toString}'")
      }
    }
    buf += Token.EOF
    Right(buf.toVector)
  }

  // ── AST ─────────────────────────────────────────────────────────────────────

  private sealed trait Expr
  private final case class NumLit(v: Double)          extends Expr
  private final case class StrLit(s: String)          extends Expr
  private final case class FieldRef(name: String)     extends Expr
  private final case class BinOp(op: Char, l: Expr, r: Expr) extends Expr

  // ── Parser ───────────────────────────────────────────────────────────────────

  private final class Parser(tokens: Vector[Token]) {
    private var pos: Int = 0

    private def peek: Token  = if (pos < tokens.length) tokens(pos) else Token.EOF
    private def advance(): Unit = if (pos < tokens.length) pos += 1

    def parseAll(): Either[String, Expr] = {
      val result = parseExpr()
      result.flatMap { expr =>
        if (peek != Token.EOF) Left(s"Unexpected token after expression")
        else Right(expr)
      }
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

  // ── Internal parse ──────────────────────────────────────────────────────────

  private def parse(expr: String): Either[String, Expr] =
    if (expr.trim.isEmpty) Left("Expression is empty")
    else tokenize(expr).flatMap(ts => new Parser(ts).parseAll())

  // ── Validation ──────────────────────────────────────────────────────────────

  /**
   * Validate expression syntax and field references without evaluating.
   *
   * @param expr       Raw expression string
   * @param fieldNames Set of available field names from the DataType
   * @return `Right(())` if valid; `Left(message)` with a description of the problem
   */
  def validate(expr: String, fieldNames: Set[String]): Either[String, Unit] =
    parse(expr).flatMap(ast => checkRefs(ast, fieldNames))

  private def checkRefs(expr: Expr, names: Set[String]): Either[String, Unit] = expr match {
    case NumLit(_) | StrLit(_) => Right(())
    case FieldRef(name) =>
      if (names.contains(name)) Right(()) else Left(s"Unknown field: $name")
    case BinOp(_, l, r) =>
      checkRefs(l, names).flatMap(_ => checkRefs(r, names))
  }

  // ── Evaluation ───────────────────────────────────────────────────────────────

  /** Intermediate value type used during evaluation. */
  private sealed trait Val
  private final case class VNum(v: Double) extends Val
  private final case class VStr(s: String) extends Val
  private case object VNull extends Val

  /**
   * Evaluate an expression against a row.
   *
   * @param expr  Raw expression string
   * @param row   Map of field name → JSON value for the current row
   * @return `Right(JsValue)` on success; `Left(EvaluationError)` on failure
   */
  def evaluate(expr: String, row: Map[String, JsValue]): Either[EvaluationError, JsValue] =
    parse(expr) match {
      case Left(msg) => Left(EvaluationError.ParseError(msg))
      case Right(ast) =>
        evalExpr(ast, row).map(valToJs)
    }

  private def evalExpr(expr: Expr, row: Map[String, JsValue]): Either[EvaluationError, Val] =
    expr match {
      case NumLit(v) => Right(VNum(v))
      case StrLit(s) => Right(VStr(s))

      case FieldRef(name) =>
        row.get(name) match {
          case None               => Left(EvaluationError.UnknownField(name))
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
    }

  private def applyOp(op: Char, l: Val, r: Val, exprStr: String): Either[EvaluationError, Val] =
    (op, l, r) match {
      // Null propagation — if either side is null the result is null
      case (_, VNull, _) | (_, _, VNull) => Right(VNull)

      // Numeric arithmetic
      case ('+', VNum(a), VNum(b)) => Right(VNum(a + b))
      case ('-', VNum(a), VNum(b)) => Right(VNum(a - b))
      case ('*', VNum(a), VNum(b)) => Right(VNum(a * b))
      case ('/', VNum(a), VNum(b)) =>
        if (b == 0) Left(EvaluationError.DivisionByZero(exprStr))
        else Right(VNum(a / b))

      // String concatenation (+ only)
      case ('+', VStr(a), VStr(b)) => Right(VStr(a + b))
      case ('+', VNum(a), VStr(b)) => Right(VStr(numStr(a) + b))
      case ('+', VStr(a), VNum(b)) => Right(VStr(a + numStr(b)))

      // Type error
      case _ =>
        Left(EvaluationError.TypeError(
          s"Operator '$op' cannot be applied to ${typeName(l)} and ${typeName(r)}"
        ))
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
