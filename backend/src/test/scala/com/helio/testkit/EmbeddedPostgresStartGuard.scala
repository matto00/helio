package com.helio.testkit

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
 *  name. Comments are stripped before the scan by [[EmbeddedPostgresGuardLexer]] (code in a comment is not executable, and several
 *  existing specs mention the class in prose); string literals are NOT stripped (fail closed).
 *  The one exemption is a line carrying [[ExemptionMarker]] inside `VerifiedEmbeddedPostgresSpec`.
 *  Accepted gaps: a start through reflection or another build of zonky is invisible to a text
 *  scan, and the lexer's comment stripping trusts well-formed Scala. The test JVM's working
 *  directory is `backend/`. */
object EmbeddedPostgresStartGuard {
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
    val code    = EmbeddedPostgresGuardLexer.stripComments(text).getOrElse(text)
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

  /** The whole-tree scan root: the test JVM's working directory is `backend/`. */
  val scanRoot: Path = Paths.get("src", "test", "scala")

  def scalaSources: Vector[Path] = {
    val stream = Files.walk(scanRoot)
    try stream.iterator().asScala.filter(p => Files.isRegularFile(p) && p.toString.endsWith(".scala")).toVector
    finally stream.close()
  }

  def rel(p: Path): String = scanRoot.relativize(p).toString.replace('\\', '/')

  def read(p: Path): String = new String(Files.readAllBytes(p), StandardCharsets.UTF_8)
}
