package com.helio.testkit

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Files

/** HEL-1445 guard spec: asserts the scan rules of [[EmbeddedPostgresStartGuard]] (allowlist, bypasses,
 *  exemptions) and the whole-tree scan. The string/comment lexing cases live in [[EmbeddedPostgresGuardLexerSpec]]. */
class EmbeddedPostgresStartGuardSpec extends AnyWordSpec with Matchers {
  import EmbeddedPostgresStartGuard._

  // Spelled by concatenation so this file does not itself match the patterns it enforces.
  private val Epg = "Embedded" + "Postgres"
  private val Ver = "Verified" + Epg
  private val Prep = "Prepared" + "Db"
  private val Root = "io.zonky.test.db" + ".postgres"
  private val Pkg = s"$Root.embedded"

  "EmbeddedPostgresStartGuardSpec" should {

    "scan a real, non-trivial source tree (non-vacuity)" in {
      Files.isDirectory(scanRoot) shouldBe true
      scalaSources.size should be > 100
    }

    "find the helper and a migrated spec and recognise the wrapped form as clean" in {
      val helper = scalaSources.filter(rel(_) == HelperPath)
      helper should have size 1
      read(helper.head) should include("def start(")
      val users = scalaSources.filter(p => read(p).contains(Ver + ".start(" + Epg + ".builder"))
      users.size should be > 1
      offendersIn(rel(users.head), read(users.head)) shouldBe empty
    }

    "reject every direct-start spelling" in {
      val direct = Seq(
        s"val pg = $Epg.builder().start()",
        s"val pg = $Epg.builder().setConnectConfig(\"a\", \"b\").start()",
        s"val b = $Epg .builder()",
        s"val b = $Epg\n  .builder()",
        s"val pg = $Epg.start()",
        s"val pg = $Ver.start($Epg.builder().start())",
        s"val pg = $Ver.startWith($Epg.builder().start(), 2, () => 0, f)",
        s"import $Pkg.{$Epg => Pg}",
        s"import $Pkg.{$Epg=>Pg}\nval pg = Pg.builder().start()",
        s"import $Pkg.{$Epg  =>  Pg}\nval pg = Pg.builder().start()",
        s"import $Pkg.{\n  $Epg => Pg\n}\nval pg = Pg.builder().start()",
        s"import $Pkg.{$Epg, _}",
        s"import $Pkg._"
      )
      val missed = direct.filter(violations(_).isEmpty)
      withClue(s"not flagged:\n${missed.mkString("\n---\n")}\n") { missed shouldBe empty }
    }

    "reject static-member imports, backticks and other cluster-starting entry points (allowlist)" in {
      val bypasses = Seq[(String, String)](
        "B1 member wildcard"  -> s"import $Pkg.$Epg._\nobject B1 { def f() = builder().start() }",
        "B2 member rename"    -> s"import $Pkg.$Epg.{builder => b}\nobject B2 { def f() = b().start() }",
        "B3 member import"    -> s"import $Pkg.$Epg.start\nobject B3 { def f() = start() }",
        "B4 nested wildcard"  -> s"import $Pkg.$Epg\nobject B4 { import $Epg._; def f() = builder().start() }",
        "B5 backticks"        -> s"import $Pkg.$Epg\nobject B5 { def f() = `$Epg`.builder().start() }",
        "B6 prepared-db provider" -> s"import $Pkg.${Prep}Provider\nobject B6 { def f() = ${Prep}Provider.forPreparer(p) }",
        "B6b provider in selector" -> s"import $Pkg.{$Epg, ${Prep}Provider}",
        "junit rule"          -> s"import $Root.junit.${Epg}Rules",
        "junit5 extension"    -> s"import $Root.junit5.${Prep}Extension",
        "fully qualified"     -> s"val pg = $Pkg.$Epg.builder().start()",
        "other-package import" -> s"import some.where.$Epg",
        "rename to alias"     -> s"import $Pkg.{$Epg => Pg}\nval pg = Pg.builder().start()"
      )
      val missed = bypasses.filter { case (_, t) => violations(t).isEmpty }.map(_._1)
      withClue(s"not flagged: ${missed.mkString(", ")}\n") { missed shouldBe empty }
    }

    "accept the verified spellings, plain imports and type positions" in {
      val ok = Seq(
        s"val pg = $Ver.start($Epg.builder().setConnectConfig(\"a\", \"b\"))",
        s"val pg = $Ver.start($Epg.builder())",
        s"val pg = $Ver.start(\n  $Epg.builder()\n    .setServerConfig(\"ssl\", \"on\")\n )",
        s"val pg = $Ver.startWith($Epg.builder().setPort(1), maxAttempts = 2, nextPort = () => 0, observeDataDirectory = f)",
        s"import $Pkg.$Epg",
        s"import $Pkg.{$Epg, DatabasePreparer}",
        s"import $Pkg.{\n  DatabasePreparer,\n  $Epg\n}",
        s"private var pg: $Epg = _",
        s"private var pg: Option[$Epg] = None",
        s"def f(pg: $Epg): String = pg.toString",
        s"def f(g: $Epg => String): Map[String, $Epg] = ???",
        s"// $Epg.builder().start() in a comment is not code\nval a = 1",
        s"/* import $Pkg.$Epg._ */ val a = 1"
      )
      val flagged = ok.filter(violations(_).nonEmpty)
      withClue(s"wrongly flagged:\n${flagged.mkString("\n---\n")}\n") { flagged shouldBe empty }
    }

    "not mistake the verified start for a static zonky start" in {
      violations(s"$Ver.start($Epg.builder())") shouldBe empty
      violations(s"$Epg.start()") should not be empty
    }

    "honour the exemption marker only on the marked line of the regression spec" in {
      val marked = s"val s = $Epg.builder().setPort(1).start() $ExemptionMarker"
      offendersIn(RegressionPath, marked) shouldBe empty
      offendersIn("OtherSpec.scala", marked) should not be empty
      offendersIn(RegressionPath, marked + s"\nval t = $Epg.builder().start()") should not be empty
    }

    "exempt the helper and the regression spec by exact path, not by bare file name" in {
      val direct = s"val pg = $Epg.builder().start() $ExemptionMarker"
      offendersIn(HelperPath, direct) shouldBe empty
      offendersIn("com/helio/other/" + Ver + ".scala", direct) should not be empty
      offendersIn("com/helio/other/" + Ver + "Spec.scala", direct) should not be empty
      offendersIn(Ver + ".scala", direct) should not be empty
    }

    "have no test source that starts embedded Postgres without the verified helper" in {
      val bad = scalaSources.filter(p => offendersIn(rel(p), read(p)).nonEmpty).map(_.toString).sorted
      withClue(
        s"These specs start embedded Postgres directly; use com.helio.testkit.$Ver.start(...):\n${bad.mkString("\n")}\n"
      ) {
        bad shouldBe empty
      }
    }
  }
}
