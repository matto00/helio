import sbt.*
import sbt.util.Logger

/** HEL-1468: wraps a `TestResultLogger` so a failed or aborted ScalaTest run always throws, even when sbt's forked-test
  * event channel lost the group's results. The check runs BEFORE delegating and does not depend on it; the wrapped
  * logger still runs, so sbt's own output (and its own failures) are unchanged. Decision logic lives in the sbt-free
  * `ScalaTestSummaryGuard`.
  */
object ScalaTestFailureGuard {

  def wrap(inner: TestResultLogger): TestResultLogger = new Guarded(inner)

  private final class Guarded(inner: TestResultLogger) extends TestResultLogger {
    override def run(log: Logger, results: Tests.Output, taskName: String): Unit = {
      val outcome = ScalaTestSummaryGuard.evaluate(results.summaries.toSeq.map(_.summaryText))
      if (outcome.sawSummary) log.info(ScalaTestSummaryGuard.logLine(outcome))
      inner.run(log, results, taskName)
      ScalaTestSummaryGuard.failureMessage(outcome).foreach { msg =>
        log.error(msg)
        throw new TestsFailedException
      }
    }
    // Readable in `show <scope>/testResultLogger`.
    override def toString: String = s"hel1468-guard($inner)"
  }
}
