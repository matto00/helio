import org.scalatest.funsuite.AnyFunSuite

/** HEL-1468: pins how the build's failure guard reads ScalaTest's own run summary.
  *
  * Default package on purpose, like `DevEnvSpec`: `ScalaTestSummaryGuard` (backend/project/ScalaTestSummaryGuard.scala)
  * is a default-package object compiled into the test sources, so this spec runs exactly the code the build runs.
  *
  * The summary texts below are the `Tests.Summary` text of real forked `testOnly` runs on sbt 2.0.9 (the lines
  * between `Run completed in` and the end of the summary, verbatim, `[info] ` prefix removed). `ansiFailed` is the
  * single-failure text wrapped in the SGR codes real CI job logs carry around the banner (job 114064543620).
  */
class ScalaTestSummaryGuardSpec extends AnyFunSuite {
  import ScalaTestSummaryGuard._

  private val allPassed =
    """Run completed in 584 milliseconds.
      |Total number of tests run: 7
      |Suites: completed 1, aborted 0
      |Tests: succeeded 7, failed 0, canceled 0, ignored 0, pending 0
      |All tests passed.""".stripMargin

  private val oneFailed =
    """Run completed in 717 milliseconds.
      |Total number of tests run: 2
      |Suites: completed 1, aborted 0
      |Tests: succeeded 1, failed 1, canceled 0, ignored 0, pending 0
      |*** 1 TEST FAILED ***""".stripMargin

  private val fortyFailed =
    """Run completed in 971 milliseconds.
      |Total number of tests run: 40
      |Suites: completed 1, aborted 0
      |Tests: succeeded 0, failed 40, canceled 0, ignored 0, pending 0
      |*** 40 TESTS FAILED ***""".stripMargin

  private val suiteAborted =
    """Run completed in 611 milliseconds.
      |Total number of tests run: 0
      |Suites: completed 0, aborted 1
      |Tests: succeeded 0, failed 0, canceled 0, ignored 0, pending 0
      |*** 1 SUITE ABORTED ***""".stripMargin

  private val esc = "\u001b"
  private val ansiFailed = oneFailed.replace("*** 1 TEST FAILED ***", s"$esc[31m*** 1 TEST FAILED ***$esc[0m")

  /** `fortyFailed` with its `Tests:` line removed: a ScalaTest summary whose counts cannot be read. */
  private val noTestsLine = fortyFailed.linesIterator.filterNot(_.startsWith("Tests:")).mkString("\n")

  test("an all-passed summary is green") {
    assert(parse(allPassed) == Some(Counts(7, 0, 0, 0, 0, 0)))
    assert(!evaluate(Seq(allPassed)).isRed)
    assert(failureMessage(evaluate(Seq(allPassed))).isEmpty)
  }

  test("a single failed test is red and the message names the count") {
    assert(parse(oneFailed) == Some(Counts(1, 1, 0, 0, 0, 0)))
    val outcome = evaluate(Seq(oneFailed))
    assert(outcome.isRed && outcome.failed == 1)
    assert(failureMessage(outcome).exists(_.contains("1 failed test(s)")))
  }

  test("forty failed tests are red") {
    val outcome = evaluate(Seq(fortyFailed))
    assert(outcome.isRed && outcome.failed == 40 && outcome.aborted == 0)
    assert(logLine(outcome) == "[hel1468-guard] ScalaTest summary: failed=40 aborted=0 unreadable=0")
  }

  test("an aborted suite is red even with zero failed tests") {
    val outcome = evaluate(Seq(suiteAborted))
    assert(outcome.isRed && outcome.failed == 0 && outcome.aborted == 1)
    assert(failureMessage(outcome).exists(_.contains("1 aborted suite(s)")))
  }

  test("ANSI-colored banners are read the same as plain ones") {
    assert(parse(ansiFailed) == parse(oneFailed))
    assert(evaluate(Seq(ansiFailed)).isRed)
    assert(stripAnsi(ansiFailed) == oneFailed)
  }

  test("a ScalaTest summary with no readable Tests: line fails closed") {
    val outcome = evaluate(Seq(noTestsLine))
    assert(outcome.isRed && outcome.unreadable.size == 1)
    assert(failureMessage(outcome).exists(_.contains("cannot verify ScalaTest result")))
  }

  test("no summary at all (zero selected tests) gives no verdict and stays green") {
    assert(parse("").isEmpty)
    assert(parse("some other framework said hello").isEmpty)
    val outcome = evaluate(Seq("", "some other framework said hello"))
    assert(!outcome.sawSummary && !outcome.isRed)
  }

  test("counts add up over several summaries; one red summary makes the task red") {
    val outcome = evaluate(Seq(allPassed, oneFailed, fortyFailed))
    assert(outcome.failed == 41 && outcome.isRed && outcome.sawSummary)
  }
}
