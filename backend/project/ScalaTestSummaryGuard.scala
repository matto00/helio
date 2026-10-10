/** HEL-1468: reads the run summary ScalaTest itself prints, to catch a failed or aborted test run that sbt reports as
  * passed.
  *
  * Why this exists: with `Test / fork := true`, sbt 2.0.9 can lose a forked group's result events, so its own result
  * is `Passed` ("No tests to run") and the task exits 0 while ScalaTest prints `*** N TESTS FAILED ***`. ScalaTest's
  * summary text reaches sbt over a separate channel (`Tests.Summary`), so it is right even when the events are lost.
  *
  * Pure and sbt-free (only `scala.util.matching`), in the Scala 2.13 / Scala 3 common subset, DEFAULT package:
  * `project/ScalaTestFailureGuard.scala` (compiled into the build, Scala 3) calls it, and
  * `backend/src/test/scala/ScalaTestSummaryGuardSpec.scala` (default package, Scala 2.13) compiles this same file into
  * the test sources, so the spec exercises exactly the code the build runs.
  */
object ScalaTestSummaryGuard {

  /** What one ScalaTest summary text says. */
  sealed trait Verdict
  final case class Counts(succeeded: Int, failed: Int, canceled: Int, ignored: Int, pending: Int, abortedSuites: Int)
      extends Verdict
  /** A summary was present but its `Tests:` line could not be read: fail closed. */
  final case class Unreadable(reason: String) extends Verdict

  private val AnsiCsi = "\u001b\\[[0-9;?]*[A-Za-z]".r
  private val TestsLine =
    """(?m)^\s*Tests: succeeded (\d+), failed (\d+), canceled (\d+), ignored (\d+), pending (\d+)\s*$""".r
  private val SuitesLine = """(?m)^\s*Suites: completed (\d+), aborted (\d+)\s*$""".r
  private val AbortedBanner = """(?m)^\s*\*\*\* (\d+) SUITES? ABORTED \*\*\*\s*$""".r

  def stripAnsi(text: String): String = AnsiCsi.replaceAllIn(text, "")

  /** `None` when the text is not a ScalaTest summary (no `Tests:`/`Suites:` line and no banner at all, e.g. an empty
    * summary for a run that selected nothing): no verdict. Otherwise a verdict, never silent.
    */
  def parse(summaryText: String): Option[Verdict] = {
    val text = stripAnsi(summaryText)
    val tests = TestsLine.findFirstMatchIn(text)
    val suites = SuitesLine.findFirstMatchIn(text)
    val banner = AbortedBanner.findFirstMatchIn(text)
    val failedBanner = text.contains("TESTS FAILED ***") || text.contains("TEST FAILED ***")
    if (tests.isEmpty && suites.isEmpty && banner.isEmpty && !failedBanner) None
    else
      tests match {
        case None =>
          Some(Unreadable("a ScalaTest summary is present but has no readable `Tests:` line"))
        case Some(t) =>
          // Prefer the banner count and the `Suites:` line, whichever reports more, so neither can hide an abort.
          val fromSuites = suites.map(_.group(2).toInt).getOrElse(0)
          val fromBanner = banner.map(_.group(1).toInt).getOrElse(0)
          Some(
            Counts(
              succeeded = t.group(1).toInt,
              failed = t.group(2).toInt,
              canceled = t.group(3).toInt,
              ignored = t.group(4).toInt,
              pending = t.group(5).toInt,
              abortedSuites = math.max(fromSuites, fromBanner)
            )
          )
      }
  }

  /** Combined verdict over every summary text of one test task. */
  final case class Outcome(failed: Int, aborted: Int, unreadable: Seq[String], sawSummary: Boolean) {
    def isRed: Boolean = failed > 0 || aborted > 0 || unreadable.nonEmpty
  }

  def evaluate(summaryTexts: Seq[String]): Outcome = {
    val verdicts = summaryTexts.flatMap(parse)
    Outcome(
      failed = verdicts.collect { case c: Counts => c.failed }.sum,
      aborted = verdicts.collect { case c: Counts => c.abortedSuites }.sum,
      unreadable = verdicts.collect { case Unreadable(r) => r },
      sawSummary = verdicts.nonEmpty
    )
  }

  /** The line logged whenever a ScalaTest summary was present (red or green), so a log shows the guard ran. */
  def logLine(o: Outcome): String =
    s"[hel1468-guard] ScalaTest summary: failed=${o.failed} aborted=${o.aborted} unreadable=${o.unreadable.size}"

  /** The failure message, or `None` when the run is green. Counts only; names no suite (ScalaTest's own per-suite output
    * earlier in the same log does: a suite header line followed by its `*** FAILED ***` test lines).
    */
  def failureMessage(o: Outcome): Option[String] =
    if (!o.isRed) None
    else {
      val reasons =
        (if (o.failed > 0) Seq(s"${o.failed} failed test(s)") else Nil) ++
          (if (o.aborted > 0) Seq(s"${o.aborted} aborted suite(s)") else Nil) ++
          o.unreadable.map(r => s"cannot verify ScalaTest result: $r")
      Some(
        s"[hel1468-guard] ScalaTest reported ${reasons.mkString("; ")}, but sbt considered the run passed (sbt 2 can lose " +
          "forked-test result events, HEL-1468). See the failing suite's header line and its `*** FAILED ***` lines " +
          "earlier in this log."
      )
    }
}
