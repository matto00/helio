package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** The datebucket step, the compute `date_trunc` function and the cast step's timestamp target read
 *  timestamps through one parser, so they agree on every shape (HEL-1314 timestamp-value-parsing). */
class TimestampAgreementSpec extends AnyWordSpec with Matchers {

  private val accepted: Seq[Any] = Seq(
    "2026-07-01T12:00:00Z", "2026-07-01T14:00:00+02:00", "2026-07-01T12:00:00", "2026-07-01 12:00:00.123456",
    "2026-07-01 12:00", "2026-07-01", "1782907200", 1782907200.0, 1782907200000.0, 1782907200L, "1.7829072E9"
  )
  private val rejected: Seq[Any] = Seq("not a date", "", "2026-13-01", "2026-07-01T25:00:00Z", "1782907200.5")

  private def bucket(v: Any): Any =
    DateBucketStep.apply(Seq(Map[String, Any]("ts" -> v)), DateBucketConfig("ts", "day", None), identity).head("ts")

  private def truncated(v: Any): Any =
    ComputeStep.apply(Seq(Map[String, Any]("ts" -> v)), ComputeConfig("out", """date_trunc("day", $ts)""", None)).head("out")

  private def cast(v: Any): Any =
    CastStep.apply(Seq(Map[String, Any]("ts" -> v)), CastConfig(Map("ts" -> "timestamp"))).head("ts")

  "datebucket, compute and cast" should {
    accepted.foreach { v =>
      s"agree that ${v.getClass.getSimpleName} $v is the 2026-07-01 instant" in {
        bucket(v) shouldBe "2026-07-01"
        truncated(v) shouldBe "2026-07-01T00:00:00Z"
        Option(cast(v)) should not be empty
      }
    }
    rejected.foreach { v =>
      s"agree that '$v' is not a timestamp" in {
        Option(bucket(v)) shouldBe empty
        Option(truncated(v)) shouldBe empty
      }
    }
  }

  "the window step's day-based rolling frames" should {
    "read a JSON-number epoch like datebucket does (a fourth consumer of the shared parser)" in {
      val rows: Seq[Map[String, Any]] = Seq(
        Map("ts" -> 1782907200.0, "v" -> 1.0), // 2026-07-01
        Map("ts" -> 1782993600.0, "v" -> 2.0)  // 2026-07-02
      )
      rows.foreach(r => Option(bucket(r("ts"))) should not be empty)
      val cfg = WindowConfig(Vector.empty, Vector(SortKey("ts", "asc")), "rolling_sum", Some("v"), "out", None, Some(2), Some("days"))
      WindowStep.apply(rows, cfg).map(_("out")) shouldBe Seq(1.0, 3.0)
    }
  }
}
