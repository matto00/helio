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
  /** HEL-1403: prefix unary minus (strict grammar only -- the legacy parser is frozen). */
  private[engine] final case class Neg(e: Expr)               extends Expr
  /** HEL-1070: boolean literal and the comparison / boolean operator nodes (strict grammar only). */
  private[engine] final case class BoolLit(b: Boolean)        extends Expr
  private[engine] final case class Cmp(op: String, l: Expr, r: Expr) extends Expr
  private[engine] final case class And(l: Expr, r: Expr)      extends Expr
  private[engine] final case class Or(l: Expr, r: Expr)       extends Expr
  private[engine] final case class Not(e: Expr)               extends Expr

  /** Words the strict grammar reserves (case-insensitive). The tokenizer still emits them as
   *  `Ident`/`FnName` because the frozen `LegacyParser` shares it. */
  private val Keywords = Set("and", "or", "not", "true", "false")

  private def keywordOf(t: Token): Option[String] = t match {
    case Token.Ident(n) if Keywords.contains(n.toLowerCase)  => Some(n.toLowerCase)
    case Token.FnName(n) if Keywords.contains(n.toLowerCase) => Some(n.toLowerCase)
    case _                                                   => None
  }

  private def reservedWordMsg(word: String): String =
    s"'$word' is a reserved word (boolean operator or literal) and cannot be used as a value or column name here; " +
      "reference columns with a '$' prefix"

  private val CmpOps: Map[Token, String] = Map(
    Token.Eq -> "=", Token.Neq -> "!=", Token.Lt -> "<", Token.Le -> "<=", Token.Gt -> ">", Token.Ge -> ">="
  )

  /** Arity/known-name check for function calls — shared by the strict parser
   *  (which rejects unknown names/arity at parse time, per
   *  compute-expression-language's "Function-call syntax" requirement). */
  private def checkArity(name: String, argc: Int): Either[String, Unit] = name match {
    case "concat"                     => if (argc >= 1) Right(()) else Left("concat requires at least 1 argument")
    case "substring"                  => if (argc == 3) Right(()) else Left("substring requires 3 arguments")
    case "lower" | "upper" | "length" => if (argc == 1) Right(()) else Left(s"$name requires 1 argument")
    case "floor" | "ceil" | "abs"     => if (argc == 1) Right(()) else Left(s"$name requires 1 argument")
    case "coalesce"                   => if (argc >= 2) Right(()) else Left("coalesce requires at least 2 arguments")
    case "if"                         => if (argc == 3) Right(()) else Left("if requires 3 arguments (condition, then, else)")
    case "mod"                        => if (argc == 2) Right(()) else Left("mod requires 2 arguments")
    case "seconds_between" | "date_trunc" | "add_days" => if (argc == 2) Right(()) else Left(s"$name requires 2 arguments")
    case "round"                      => if (argc == 1 || argc == 2) Right(()) else Left("round requires 1 or 2 arguments")
    case other =>
      Left(s"'$other' is not a recognized function; supported functions: ${SupportedFunctions.mkString(", ")}")
  }

  /** Per-call argument checks beyond arity: `date_trunc`'s unit must be a known string literal, so a
   *  typo can never become a silent per-row null. */
  private def checkCall(name: String, args: Vector[Expr]): Either[String, Unit] =
    if (name == "date_trunc") args.head match {
      case StrLit(u) if ExpressionDateTimeFunctions.TruncUnits.contains(u) => Right(())
      case _                                                               => Left(ExpressionDateTimeFunctions.UnitsMessage)
    } else Right(())

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

    /** `expr -> orExpr`; precedence loosest to tightest: or, and, not, comparison, `+ -`, `* /`, unary `-`. */
    private def parseExpr(): Either[String, Expr] = parseOr()

    private def atKeyword(word: String): Boolean = keywordOf(peek).contains(word)

    private def parseOr(): Either[String, Expr] =
      parseAnd().flatMap { first =>
        var acc: Either[String, Expr] = Right(first)
        while (acc.isRight && atKeyword("or")) {
          advance()
          acc = acc.flatMap(l => parseAnd().map(r => Or(l, r)))
        }
        acc
      }

    private def parseAnd(): Either[String, Expr] =
      parseNot().flatMap { first =>
        var acc: Either[String, Expr] = Right(first)
        while (acc.isRight && atKeyword("and")) {
          advance()
          acc = acc.flatMap(l => parseNot().map(r => And(l, r)))
        }
        acc
      }

    /** `notExpr -> 'not' notExpr | cmpExpr`. A bare `not` with no operand is the reserved-word error. */
    private def parseNot(): Either[String, Expr] =
      if (atKeyword("not")) {
        advance()
        if (peek == Token.EOF || peek == Token.RParen || peek == Token.Comma) Left(reservedWordMsg("not"))
        else parseNot().map(Not(_))
      } else parseCmp()

    /** `cmpExpr -> sum (CMP sum)?`: non-associative, so a second comparison is a parse error. */
    private def parseCmp(): Either[String, Expr] =
      parseSum().flatMap { l =>
        CmpOps.get(peek) match {
          case None => Right(l)
          case Some(op) =>
            val opTok = peek
            advance()
            if (opTok == Token.Eq && peek == Token.Eq) Left("'==' is not supported; use '=' to compare")
            else if (opTok == Token.Lt && peek == Token.Gt) Left("'<>' is not supported; use '!=' for not-equal")
            else
              parseSum().flatMap { r =>
                if (CmpOps.contains(peek))
                  Left("Comparison operators cannot be chained; parenthesise one comparison or join them with 'and'")
                else Right(Cmp(op, l, r))
              }
        }
      }

    private def parseSum(): Either[String, Expr] =
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
      parseUnary().flatMap { first =>
        var acc: Either[String, Expr] = Right(first)
        while (acc.isRight && (peek == Token.Star || peek == Token.Slash)) {
          val op = if (peek == Token.Star) '*' else '/'
          advance()
          acc = acc.flatMap(l => parseUnary().map(r => BinOp(op, l, r)))
        }
        acc
      }

    /** `unary -> '-' unary | factor`: binds tighter than `*`/`/`, applies to the single following
     *  factor, and repeats (`--x` = `x`). Unary plus is deliberately not part of the grammar. */
    private def parseUnary(): Either[String, Expr] =
      if (peek == Token.Minus) { advance(); parseUnary().map(Neg(_)) }
      else parseFactor()

    /** `firstArgError` rewrites a failure of the FIRST argument only (see `date_trunc`'s unit). */
    private def parseArgs(firstArgError: String => String = identity): Either[String, Vector[Expr]] =
      if (peek == Token.RParen) Right(Vector.empty)
      else
        parseExpr().left.map(firstArgError).flatMap { first =>
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
      // HEL-1070: a keyword is never a function name or column, also when written before '(' (that '(' is then
      // an ordinary group). Not the `$`-prefix error, so `parseProblem`/`compile` never retry the legacy parser.
      case t if keywordOf(t).isDefined =>
        keywordOf(t).get match {
          case "true"  => advance(); Right(BoolLit(true))
          case "false" => advance(); Right(BoolLit(false))
          case other   => Left(reservedWordMsg(other))
        }
      case Token.FnName(name) =>
        advance()
        if (peek != Token.LParen) Left(s"Expected '(' after function name '$name'")
        else {
          advance()
          // A bare word in date_trunc's unit position (`date_trunc(day, $ts)`, `-day`, `lower(day)`) is
          // the units error, not the `$`-prefix one, which would send it to the legacy parser.
          val argsE =
            if (name == "date_trunc") parseArgs(m => if (m == DollarPrefixRequiredMsg) ExpressionDateTimeFunctions.UnitsMessage else m)
            else parseArgs()
          argsE.flatMap { args =>
            if (peek != Token.RParen) Left("Expected closing ')' in function call")
            else {
              advance()
              checkArity(name, args.length).flatMap(_ => checkCall(name, args)).map(_ => Call(name, args))
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
