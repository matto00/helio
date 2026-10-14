package com.helio.testkit

/** HEL-1445 / HEL-1474: the comment-stripping lexer behind [[EmbeddedPostgresStartGuard]], split out so
 *  the scan rules and the lexer are separate, individually reviewable units. */
object EmbeddedPostgresGuardLexer {
  private final class Unbalanced extends RuntimeException("unbalanced or unterminated construct", null, false, false)

  /** Blanks `//` and block comments (newlines kept) in code positions only. Lexes interpolated strings
   *  (`id"..."`, `id"""..."""`) and their `${...}` splices as code, recursively, so a string literal or
   *  comment-looking text inside a splice can never be mistaken for a comment. Returns None on any
   *  unbalanced or unterminated construct: the caller then scans the file RAW (fail closed). */
  def stripComments(text: String): Option[String] = {
    val out = new StringBuilder(text.length)
    val n   = text.length
    var i   = 0
    def isIdChar(c: Char): Boolean = Character.isLetterOrDigit(c) || c == '_' || c == '$'
    def emit(): Unit = { out.append(text.charAt(i)); i += 1 }
    def bad(): Nothing = throw new Unbalanced

    def blockComment(): Unit = {
      var depth = 0
      while (i < n) {
        if (text.startsWith("/*", i)) { depth += 1; out.append("  "); i += 2 }
        else if (text.startsWith("*/", i)) { depth -= 1; out.append("  "); i += 2; if (depth == 0) return }
        else { out.append(if (text.charAt(i) == '\n') '\n' else ' '); i += 1 }
      }
      bad()
    }

    // `i` is at the opening quote; `interpolated` comes from the preceding identifier.
    def string(interpolated: Boolean): Unit = {
      val triple = text.startsWith("\"\"\"", i)
      if (triple) { out.append("\"\"\""); i += 3 } else emit()
      while (true) {
        if (i >= n) bad()
        val c = text.charAt(i)
        if (triple && text.startsWith("\"\"\"", i)) {
          while (i < n && text.charAt(i) == '"') emit()   // a run of 3+ quotes closes; the extras belong to the string
          return
        } else if (!triple && c == '"') { emit(); return }
        else if (!triple && c == '\n') bad()
        else if (!triple && c == '\\') { emit(); if (i >= n) bad(); emit() }   // scalac pairs `\x` in every single-line string, `raw` included
        else if (interpolated && c == '$' && i + 1 < n && text.charAt(i + 1) == '"') { emit(); emit() }   // the `$"` escape
        else if (interpolated && c == '$' && i + 1 < n && text.charAt(i + 1) == '$') { emit(); emit() }
        else if (interpolated && c == '$' && i + 1 < n && text.charAt(i + 1) == '{') { emit(); emit(); code(inSplice = true) }
        else emit()
      }
    }

    def charLiteral(): Unit = {
      if (i + 1 < n && text.charAt(i + 1) == '\\') {
        val close = text.indexOf('\'', i + 3)
        if (close < 0) bad()
        out.append(text.substring(i, close + 1)); i = close + 1
      } else if (i + 2 < n && text.charAt(i + 2) == '\'') { out.append(text.substring(i, i + 3)); i += 3 }
      else emit()
    }

    def code(inSplice: Boolean): Unit = {
      var depth = 0
      while (i < n) {
        val c = text.charAt(i)
        if (text.startsWith("//", i)) { while (i < n && text.charAt(i) != '\n') { out.append(' '); i += 1 } }
        else if (text.startsWith("/*", i)) blockComment()
        else if (c == '"') {
          var k = i
          while (k > 0 && isIdChar(text.charAt(k - 1))) k -= 1
          val prefix = text.substring(k, i)
          val interpolated = prefix.nonEmpty && (Character.isLetter(prefix.head) || prefix.head == '_')
          string(interpolated)
        }
        else if (c == '\'') charLiteral()
        else if (c == '{') { depth += 1; emit() }
        else if (c == '}') {
          if (inSplice && depth == 0) { emit(); return }
          depth = math.max(0, depth - 1); emit()
        }
        else emit()
      }
      if (inSplice) bad()
    }

    try { code(inSplice = false); Some(out.toString) }
    catch { case _: Unbalanced => None }
  }

  /** True when this file hits the fail-closed fallback (scanned raw). */
  def usesRawFallback(text: String): Boolean = stripComments(text).isEmpty

  /** Statistic only: does any `${...}` splice (naive brace counting) contain a `"`? */
  def hasSpliceLiteral(text: String): Boolean = {
    var from = text.indexOf("${")
    while (from >= 0) {
      var depth = 1
      var i     = from + 2
      var found = false
      while (i < text.length && depth > 0) {
        text.charAt(i) match {
          case '"' => found = true
          case '{' => depth += 1
          case '}' => depth -= 1
          case _   =>
        }
        i += 1
      }
      if (found) return true
      from = text.indexOf("${", math.max(i, from + 2))
    }
    false
  }
}
