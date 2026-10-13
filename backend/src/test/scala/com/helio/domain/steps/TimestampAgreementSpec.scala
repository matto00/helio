package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** The datebucket step, the compute `date_trunc` function and the cast step's timestamp target read
 *  timestamps through one parser, so they agree on every shape (HEL-1314 timestamp-value-parsing). */
class TimestampAgreementSpec extends AnyWordSpec with Matchers {

  private val accepted: Seq[Any] = Seq(
    "2026-07-01T12:00:00Z", "2026-07-01T14:00:00+02:00", "2026-07-01T12:00:00", "2026-07-01 12:00:00.123456",
    "2026-07-01 12:00", "2026-07-01", "1782907200", 1782907200.0, 1782907200000.0, 1782907200L, "1.7829072E9",
    // HEL-1502: Postgres offsets, region-zoned ISO and MM/dd/yyyy
    "2026-07-01 12:00:00+00", "2026-07-01 17:30:00+0530", "2026-07-01T14:00:00+02:00[Europe/Paris]", "07/01/2026",
    "2026-07-01T12:00:00+00", "2026-07-01 14:00:00+02", "2026-07-01 09:00:00-0300", "2026-07-01 07:00:00-05:00:00"
  )
  private val rejected: Seq[Any] = Seq("not a date", "", "2026-13-01", "2026-07-01T25:00:00Z", "1782907200.5",
    "02/30/2026", "2026-07-01 12:00:00Z", "2026-07-01T12:00:00[Europe/Paris]", "2026-07-01 12:00:00+18:30",
    "2026-07-01T12:00:00+18:00:01", "2026-07-01 12:00:00+053015", "2026-07-01 12:00:00+0530:15", "2026-07-01 12:00:00+5",
    "2026-07-01 12:00:00+05:3", "-9223372036854775808", "253402300800000", "-62135596800001")

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

  "the cast step (GUARD, HEL-1502: mutation-failable)" should {
    "keep no value that datebucket or date_trunc then reads as null" in {
      val inputs: Seq[Any] = accepted ++ rejected ++ Seq("2026-02-30", "02/30/2026", "13/01/2026", "1/5/2026")
      inputs.foreach { v =>
        val kept = cast(v)
        if (kept != null) withClue(s"cast kept $v as $kept: ") {
          Option(bucket(kept)) should not be empty
          Option(truncated(kept)) should not be empty
        }
      }
    }
    "keep every accepted shape (so the guard above is not vacuous)" in {
      accepted.foreach(v => withClue(v.toString)(Option(cast(v)) should not be empty))
    }
    "emit an ISO instant for a JSON-number epoch that datebucket and date_trunc read" in {
      cast(1782907200.0) shouldBe "2026-07-01T12:00:00Z"
      bucket(cast(1782907200.0)) shouldBe "2026-07-01"
    }
  }

  "seconds_between" should {
    "read Postgres timestamptz text at its offset (end - start = -5400)" in {
      val out = ComputeStep.apply(
        Seq(Map[String, Any]("a" -> "2026-07-01 12:00:00+00", "b" -> "2026-07-01 12:00:00-0130")),
        ComputeConfig("out", "seconds_between($a, $b)", None)
      ).head("out")
      out shouldBe -5400.0
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
