package com.helio.domain.engine

import ExpressionEvaluator.SupportedFunctions
import ExpressionTokenizer.{Token, tokenize}

// Strict and legacy recursive-descent parsers and the AST they build.
private[engine] object ExpressionParser {

  /** The exact message the strict parser returns for a bare (non-`$`, non-call)
   *  identifier. Used verbatim by `evaluate()`/`validateTolerant()` to recognize
   *  "this specific failure" and retry via `parseLegacy` — no other parse failure
   *  triggers the legacy fallback. */
  private val DollarPrefixRequiredMsg = "Column references require a '$' prefix"

  private[engine] sealed trait Expr
  private[engine] final case class NumLit(v: Double)          extends Expr
  private[engine] final case class StrLit(s: String)          extends Expr
  private[engine] final case class FieldRef(name: String)     extends Expr
  private[engine] final case class BinOp(op: Char, l: Expr, r: Expr) extends Expr
  private[engine] final case class Call(name: String, args: Vector[Expr]) extends Expr

  /** Arity/known-name check for function calls — shared by the strict parser
   *  (which rejects unknown names/arity at parse time, per
   *  compute-expression-language's "Function-call syntax" requirement). */
  private def checkArity(name: String, argc: Int): Either[String, Unit] = name match {
    case "concat"                     => if (argc >= 1) Right(()) else Left("concat requires at least 1 argument")
    case "substring"                  => if (argc == 3) Right(()) else Left("substring requires 3 arguments")
    case "lower" | "upper" | "length" => if (argc == 1) Right(()) else Left(s"$name requires 1 argument")
    case "floor" | "ceil" | "abs"     => if (argc == 1) Right(()) else Left(s"$name requires 1 argument")
    case "coalesce"                   => if (argc >= 2) Right(()) else Left("coalesce requires at least 2 arguments")
    case "mod"                        => if (argc == 2) Right(()) else Left("mod requires 2 arguments")
    case "round"                      => if (argc == 1 || argc == 2) Right(()) else Left("round requires 1 or 2 arguments")
    case other =>
      Left(s"'$other' is not a recognized function; supported functions: ${SupportedFunctions.mkString(", ")}")
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

  private[engine] def parse(expr: String): Either[String, Expr] =
    if (expr.trim.isEmpty) Left("Expression is empty")
    else tokenize(expr).flatMap(ts => new StrictParser(ts).parseAll())

  private[engine] def parseLegacy(expr: String): Either[String, Expr] =
    if (expr.trim.isEmpty) Left("Expression is empty")
    else tokenize(expr).flatMap(ts => new LegacyParser(ts).parseAll())

  private[engine] def isDollarPrefixError(msg: String): Boolean = msg == DollarPrefixRequiredMsg
}
