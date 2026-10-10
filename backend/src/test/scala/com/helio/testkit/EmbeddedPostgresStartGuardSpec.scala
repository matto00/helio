package com.helio.testkit

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}
import scala.jdk.CollectionConverters._
import scala.util.matching.Regex

/** HEL-1445 guard: every backend test starts embedded Postgres through [[VerifiedEmbeddedPostgres]],
 *  which verifies the instance reached its own cluster. A direct start can silently adopt another
 *  suite's cluster after a port collision, so this scan fails the suite and names the offending
 *  file.
 *
 *  The scan is a closed ALLOWLIST over the class token, not a blocklist of bad spellings. Outside
 *  the two exempt exact paths, every standalone `EmbeddedPostgres` token (word-bounded, so the
 *  verified helper's own name never counts) must be exactly one of:
 *   (a) a plain import of the class from the zonky embedded package, alone or as an unrenamed item
 *       of a `{...}` selector;
 *   (b) a type position (`: T`, `[T]`, `Map[K, T]`, `T => R`), never followed by `.` or `(`;
 *   (c) the builder reference wrapped directly by `VerifiedEmbeddedPostgres.start(`/`startWith(`.
 *  Everything else is an offender: static-member imports, renames, backticks, qualified uses,
 *  nested `import X._`. The other cluster-starting zonky classes (`PreparedDbProvider`, the JUnit
 *  rules and the JUnit 5 extensions) and a wildcard import of the embedded package are banned by
 *  name. Comments are stripped before the scan (code in a comment is not executable, and several
 *  existing specs mention the class in prose); string literals are NOT stripped (fail closed).
 *  The one exemption is a line carrying [[ExemptionMarker]] inside `VerifiedEmbeddedPostgresSpec`.
 *  Accepted gaps: a start through reflection or another build of zonky is invisible to a text
 *  scan, and the lexer's comment stripping trusts well-formed Scala. The test JVM's working
 *  directory is `backend/`. */
object EmbeddedPostgresStartGuardSpec {
  // Spelled by concatenation so this file does not itself match the patterns it enforces.
  private val Epg   = "Embedded" + "Postgres"
  private val Ver   = "Verified" + Epg
  val ExemptionMarker = "// embedded-pg-guard: deliberate unverified start (port-steal repro)"

  private val Id          = """[A-Za-z0-9_$]"""
  private val token       = new Regex("""(?<!""" + Id + """)""" + Epg + """(?!""" + Id + """)""")
  private val wrapPrefix  = new Regex(Ver + """\s*\.\s*(?:start|startWith)\s*\(\s*$""")
  private val wrapOpen    = new Regex(Ver + """\s*\.\s*(start|startWith)\s*\(""")
  private val chainStart  = new Regex("""\.\s*start\s*\(\s*\)|\.\s*start(?![A-Za-z0-9_$(])""")
  private val builderNext = new Regex("""^\s*\.\s*builder\b""")
  private val zonkyImport = new Regex("""import\s+io\.zonky\.test\.db\.postgres\.embedded\.\s*(\{[^}]*\}|[A-Za-z0-9_$`]+)""")
  private val wildcard    = new Regex("""(?:^|[\s{,])(?:_|\*)(?:[\s},]|$)""")
  private val Single      = "SingleInstance" + "Postgres"
  private val Prepared    = "Prepared" + "Db"
  private val bannedNames = new Regex(
    """\b(?:""" + Prepared + """Provider|""" + Epg + """Rules|""" + Prepared + """Rule|""" + Single + """Rule|""" + Epg +
      """Extension|""" + Prepared + """Extension|""" + Single + """Extension)\b"""
  )
  private val bannedPkgs  = new Regex("""io\s*\.\s*zonky\s*\.\s*test\s*\.\s*db\s*\.\s*postgres\s*\.\s*junit5?\b""")

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

    // `i` is at the opening quote; `interpolated`/`raw` come from the preceding identifier.
    def string(interpolated: Boolean, raw: Boolean): Unit = {
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
        else if (!triple && !raw && c == '\\') { emit(); if (i >= n) bad(); emit() }
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
          string(interpolated, interpolated && prefix == "raw")
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

  /** Start offsets of the class tokens that sit in a plain (unrenamed) import from the zonky embedded package. */
  private def importedTokens(code: String): Set[Int] =
    zonkyImport.findAllMatchIn(code).flatMap { m =>
      val sel = m.group(1)
      if (sel.startsWith("{")) {
        var offset = m.start(1) + 1
        sel.substring(1, sel.length - 1).split(",", -1).flatMap { item =>
          val at = offset + item.takeWhile(_.isWhitespace).length
          offset += item.length + 1
          if (item.trim == Epg) Some(at) else None
        }.toSeq
      } else if (sel == Epg && !code.substring(m.end, math.min(code.length, m.end + 80)).dropWhile(_.isWhitespace).startsWith(".")) Seq(m.start(1))
      else Seq.empty
    }.toSet

  private val qualifiedNext = new Regex("""^\s*[.(]""")
  private val closeBracket   = new Regex("""^\s*\]""")
  private val typeBefore     = new Regex("""[:\[]\s*$""")
  private val commaBefore    = new Regex(""",\s*$""")

  /** Local lookaround only (a bounded window on each side), so the cost does not grow with file size. */
  private def isTypePosition(before: String, after: String): Boolean = {
    val b = before.takeRight(80)
    val a = after.take(80)
    qualifiedNext.findFirstIn(a).isEmpty &&
    (typeBefore.findFirstIn(b).isDefined || (commaBefore.findFirstIn(b).isDefined && closeBracket.findFirstIn(a).isDefined))
  }

  /** The builder argument of a wrapped start: all of `start(...)`, or only the first argument of `startWith(...)`. */
  private def builderArgument(text: String, afterOpen: Int, isStartWith: Boolean): String = {
    var depth = 0
    var i     = afterOpen
    while (i < text.length) {
      text.charAt(i) match {
        case '(' => depth += 1
        case ')' => if (depth == 0) return text.substring(afterOpen, i) else depth -= 1
        case ',' if depth == 0 && isStartWith => return text.substring(afterOpen, i)
        case _ =>
      }
      i += 1
    }
    text.substring(afterOpen)
  }

  /** Human-readable reasons `text` starts embedded Postgres outside the helper (empty = clean). */
  def violations(text: String): Vector[String] = {
    val code    = stripComments(text).getOrElse(text)
    val out     = Vector.newBuilder[String]
    val allowed = importedTokens(code)
    token.findAllMatchIn(code).foreach { m =>
      val before = code.substring(0, m.start)
      val after  = code.substring(m.end)
      val ok = allowed.contains(m.start) ||
        (wrapPrefix.findFirstIn(before.takeRight(200)).isDefined && builderNext.findFirstIn(after.take(200)).isDefined) ||
        isTypePosition(before, after)
      if (!ok) out += s"$Epg token outside the allowlist at line ${code.substring(0, m.start).count(_ == '\n') + 1}"
    }
    zonkyImport.findAllMatchIn(code).foreach { m =>
      if (wildcard.findFirstIn(m.group(1)).isDefined) out += "wildcard import of the zonky embedded package"
    }
    bannedNames.findAllMatchIn(code).foreach(m => out += s"banned zonky entry point ${m.matched}")
    bannedPkgs.findAllMatchIn(code).foreach(_ => out += "import from the zonky junit packages")
    wrapOpen.findAllMatchIn(code).foreach { m =>
      if (chainStart.findFirstIn(builderArgument(code, m.end, m.group(1) == "startWith")).isDefined)
        out += "wrapped builder chain still calls start()"
    }
    out.result().distinct
  }

  /** Drops the deliberately exempt lines (marker present), preserving line structure. */
  def withoutExemptLines(text: String): String =
    text.split("\n", -1).map(l => if (l.contains(ExemptionMarker)) "" else l).mkString("\n")

  /** `rel` is the file's path relative to the scan root, `/`-separated; the exemptions match it exactly. */
  val HelperPath  = "com/helio/testkit/" + Ver + ".scala"
  val RegressionPath = "com/helio/testkit/" + Ver + "Spec.scala"

  def offendersIn(rel: String, text: String): Vector[String] =
    if (rel == HelperPath) Vector.empty
    else violations(if (rel == RegressionPath) withoutExemptLines(text) else text)
}

class EmbeddedPostgresStartGuardSpec extends AnyWordSpec with Matchers {
  import EmbeddedPostgresStartGuardSpec._

  private val Epg = "Embedded" + "Postgres"
  private val Ver = "Verified" + Epg
  private val Prep = "Prepared" + "Db"
  private val Root = "io.zonky.test.db" + ".postgres"
  private val Pkg = s"$Root.embedded"

  private val scanRoot: Path = Paths.get("src", "test", "scala")

  private def scalaSources: Vector[Path] = {
    val stream = Files.walk(scanRoot)
    try stream.iterator().asScala.filter(p => Files.isRegularFile(p) && p.toString.endsWith(".scala")).toVector
    finally stream.close()
  }

  private def rel(p: Path): String = scanRoot.relativize(p).toString.replace('\\', '/')

  private def read(p: Path): String = new String(Files.readAllBytes(p), StandardCharsets.UTF_8)

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

    "reject direct starts hidden behind string literals inside interpolation splices" in {
      val direct = s"val pg = $Epg.builder().start()"
      val hidden = Seq[(String, String)](
        "slash-star-slash" -> s"def accept(h: Map[String, String]) = s\"$${h.getOrElse(\"accept\", \"*/*\")}\"\n$direct\n/** x */",
        "glob"             -> s"val l = s\"files: $${glob(\"**/*.csv\")}\"\n$direct\n/* c */",
        "double slash"     -> s"val u = s\"$${\"jdbc:postgresql://\"}$$h\"; $direct",
        "triple-quoted"    -> s"val t = s\"$${f(\"\"\"//x\"\"\")}\"\n$direct\nval q = 1 // end",
        "nested splice"    -> s"val t = s\"a $${g(s\"b $${\"/*\"}\")}\"\n$direct\n/* */",
        "char literal"     -> s"val t = s\"$${f('\"', \"//\")}\"\n$direct",
        "paren-less start" -> s"val pg = $Ver.start($Epg.builder().tap(_.start))"
      )
      val missed = hidden.filter { case (_, t) => violations(t).isEmpty }.map(_._1)
      withClue(s"not flagged: ${missed.mkString(", ")}\n") { missed shouldBe empty }
    }

    "accept clean files that have splice literals, including a prose doc-comment mention" in {
      val splice = "val u = s\"$${f(\"x\")}\" // trailing\n"
      val wrapped = s"val pg = $Ver.start($Epg.builder().setConnectConfig(\"a\", \"b\"))\nimport $Pkg.$Epg"
      violations(splice + wrapped) shouldBe empty
      violations(s"/** Uses its own $Epg instance, bound to loopback. */\n" + splice + wrapped) shouldBe empty
      violations(s"/**\n *  $Epg starts as the superuser.\n */\n" + splice + wrapped) shouldBe empty
      violations(s"""val q = sqlu\"\"\"UPDATE t SET a = $${s\"owner-$$id\"} WHERE b = $${\"\"\"{"k":"v"}\"\"\"}\"\"\"\n""" + wrapped) shouldBe empty
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
