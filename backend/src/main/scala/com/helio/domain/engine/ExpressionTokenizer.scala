package com.helio.domain.engine

import scala.collection.mutable.ArrayBuffer

// Tokenizer for the expression language, shared by the strict and legacy parsers.
private[engine] object ExpressionTokenizer {

  private[engine] sealed trait Token
  private[engine] object Token {
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

  // ── Tokenizer (shared by strict and legacy parsing) ─────────────────────────

  private[engine] def tokenize(input: String): Either[String, Vector[Token]] = {
    val buf = ArrayBuffer.empty[Token]
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
}
