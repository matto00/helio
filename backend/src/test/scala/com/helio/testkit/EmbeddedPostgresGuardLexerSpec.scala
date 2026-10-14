package com.helio.testkit

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1445 / HEL-1474: string-literal and comment lexing of the embedded-Postgres start guard
 *  ([[EmbeddedPostgresGuardLexer]]), asserted through [[EmbeddedPostgresStartGuard.violations]]. */
class EmbeddedPostgresGuardLexerSpec extends AnyWordSpec with Matchers {
  import EmbeddedPostgresGuardLexer._
  import EmbeddedPostgresStartGuard._

  // Spelled by concatenation so this file does not itself match the patterns it enforces.
  private val Epg = "Embedded" + "Postgres"
  private val Ver = "Verified" + Epg
  private val Root = "io.zonky.test.db" + ".postgres"
  private val Pkg = s"$Root.embedded"
  private val direct = s"val pg = $Epg.builder().start()"
  private val wrapped = s"val pg = $Ver.start($Epg.builder())"

  private def notFlagged(cases: Seq[(String, String)]): Vector[String] =
    cases.filter { case (_, t) => violations(t).isEmpty }.map(_._1).toVector

  "EmbeddedPostgresGuardLexer" should {

    "reject direct starts hidden behind string literals inside interpolation splices" in {
      val hidden = Seq[(String, String)](
        "slash-star-slash" -> s"def accept(h: Map[String, String]) = s\"$${h.getOrElse(\"accept\", \"*/*\")}\"\n$direct\n/** x */",
        "glob"             -> s"val l = s\"files: $${glob(\"**/*.csv\")}\"\n$direct\n/* c */",
        "double slash"     -> s"val u = s\"$${\"jdbc:postgresql://\"}$$h\"; $direct",
        "paren-less start" -> s"val pg = $Ver.start($Epg.builder().tap(_.start))"
      )
      val missed = notFlagged(hidden)
      withClue(s"not flagged: ${missed.mkString(", ")}\n") { missed shouldBe empty }
    }

    "reject a same-line direct start after a string literal with an escape whose content has //" in {
      val escapes = Seq[(String, String)](
        "dollar-quote escape"   -> s"val u = s\"a $$\" // b\"; $direct",
        "raw backslash-quote"   -> s"""val r = raw"a\\"b // c"; $direct"""
      )
      val missed = notFlagged(escapes)
      withClue(s"not flagged: ${missed.mkString(", ")}\n") { missed shouldBe empty }
    }

    "accept the same escape literals followed by a wrapped (verified) start" in {
      val ok = Seq(
        s"val u = s\"a $$\" // b\"; $wrapped",
        s"""val r = raw"a\\"b // c"; $wrapped"""
      )
      val flagged = ok.filter(violations(_).nonEmpty)
      withClue(s"wrongly flagged:\n${flagged.mkString("\n---\n")}\n") { flagged shouldBe empty }
    }

    // GUARDs, not red-first proofs: these three never failed on the pre-HEL-1445-fix tree. In this shape
    // the direct start sits on its own line, so a mis-lex either leaves it visible or leaves a construct
    // unterminated, which falls back to the RAW scan; both still flag it (fail closed). They cannot be
    // turned red by a lexer mutation; the balanced same-line variants below are the failable proofs.
    "fail-closed GUARD (never red): triple-quoted, nested-splice and char-literal splices still flag the start" in {
      val guards = Seq[(String, String)](
        "triple-quoted" -> s"val t = s\"$${f(\"\"\"//x\"\"\")}\"\n$direct\nval q = 1 // end",
        "nested splice" -> s"val t = s\"a $${g(s\"b $${\"/*\"}\")}\"\n$direct\n/* */",
        "char literal"  -> s"val t = s\"$${f('\"', \"//\")}\"\n$direct"
      )
      val missed = notFlagged(guards)
      withClue(s"not flagged: ${missed.mkString(", ")}\n") { missed shouldBe empty }
    }

    // The nested-splice variant needs a second line, with the direct start still on the construct's line: under the
    // mutation the `//` that hides the start also comments out the rest of that line, leaving the outer splice open
    // (a one-line form would fall back to the RAW scan and stay flagged). The tail line `}" // "` is deliberately not
    // well-formed Scala: it only has to close that splice under the mutation while staying balanced under the real
    // lexer, so the lexer sees a lexically balanced file either way.
    // Failable: each stays balanced under a targeted lexer mutation, so the mutation hides the start and
    // this case goes red (evidence in proof/guard-mutations.txt).
    "reject balanced same-line variants of the triple-quoted, nested-splice and char-literal constructs" in {
      val balanced = Seq[(String, String)](
        "triple-quoted" -> s"val t = \"\"\"a\"b//x\"\"\"; $direct",
        "nested splice" -> s"val t = s\"a $${g(s\"b $${\"//\"}\")}\" ; $direct\n}\" // \"",
        "char literal"  -> s"val c = '\"'; val s = \"//\"; $direct"
      )
      val missed = notFlagged(balanced)
      withClue(s"not flagged: ${missed.mkString(", ")}\n") { missed shouldBe empty }
      balanced.foreach { case (name, t) => withClue(name)(usesRawFallback(t) shouldBe false) }
    }

    "accept clean files that have splice literals, including a prose doc-comment mention" in {
      val splice = "val u = s\"$${f(\"x\")}\" // trailing\n"
      val ok = s"val pg = $Ver.start($Epg.builder().setConnectConfig(\"a\", \"b\"))\nimport $Pkg.$Epg"
      violations(splice + ok) shouldBe empty
      violations(s"/** Uses its own $Epg instance, bound to loopback. */\n" + splice + ok) shouldBe empty
      violations(s"/**\n *  $Epg starts as the superuser.\n */\n" + splice + ok) shouldBe empty
      violations(s"""val q = sqlu\"\"\"UPDATE t SET a = $${s\"owner-$$id\"} WHERE b = $${\"\"\"{"k":"v"}\"\"\"}\"\"\"\n""" + ok) shouldBe empty
    }

    "report whole-tree scan statistics (every file is scanned; the raw fallback is counted)" in {
      val files    = scalaSources.filterNot(p => rel(p) == HelperPath)
      val raw      = files.filter(p => usesRawFallback(read(p))).map(rel)
      val splice   = files.count(p => hasSpliceLiteral(read(p)))
      val offender = files.filter(p => offendersIn(rel(p), read(p)).nonEmpty).map(rel)
      info(s"STATS files-scanned=${files.size} files-with-splice-literals=$splice raw-fallback-files=${raw.size} offenders=${offender.size}")
      raw.foreach(r => info(s"RAW-FALLBACK $r"))
      offender.foreach(o => info(s"OFFENDER $o"))
      files.size should be > 100
    }
  }
}
