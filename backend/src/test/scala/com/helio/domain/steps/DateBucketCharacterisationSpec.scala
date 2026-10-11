package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Pins `DateBucketStep.apply`'s per-row output for every input shape. Rows in `unchanged` held before
 *  the shared parser existed; rows in `epochDelta` are the only inputs whose output changed (previously `null`)
 *  when a JSON-number / decimal-or-exponent whole epoch became a timestamp. */
class DateBucketCharacterisationSpec extends AnyWordSpec with Matchers {

  private val cfg = DateBucketConfig("ts", "day", None)

  private def bucket(v: Any): Any = DateBucketStep.apply(Seq(Map[String, Any]("ts" -> v)), cfg, identity).head("ts")

  private val unchanged: Seq[(String, Any, Any)] = Seq(
    ("Z instant", "2026-07-01T12:00:00Z", "2026-07-01"),
    ("offset crossing midnight", "2026-07-01T00:30:00+02:00", "2026-06-30"),
    ("T-local", "2026-07-01T23:59:59", "2026-07-01"),
    ("T-local nanos", "2026-07-01T12:00:00.123456789", "2026-07-01"),
    ("space-local", "2026-07-01 12:00:00", "2026-07-01"),
    ("space-local no seconds", "2026-07-01 12:00", "2026-07-01"),
    ("space-local micros", "2026-07-01 12:00:00.123456", "2026-07-01"),
    ("bare date", "2026-07-01", "2026-07-01"),
    ("padded", "  2026-07-01  ", "2026-07-01"),
    ("epoch seconds string", "1771286400", "2026-02-17"),
    ("epoch millis string", "1771286400000", "2026-02-17"),
    ("epoch seconds Long", 1771286400L, "2026-02-17"),
    ("epoch seconds Int", 1771286400, "2026-02-17"),
    ("plain BigDecimal epoch", BigDecimal("1771286400"), "2026-02-17"),
    ("negative epoch", "-1", "1969-12-31"),
    ("garbage", "not a date", null),
    ("blank", "", null),
    ("invalid month", "2026-13-01", null),
    ("invalid hour", "2026-07-01T25:00:00Z", null),
    ("MM/dd/yyyy", "07/01/2026", null),
    ("fractional epoch string", "1771286400.5", null),
    ("fractional Double", 1771286400.5, null),
    ("NaN", Double.NaN, null),
    ("Infinity", Double.PositiveInfinity, null),
    ("null", null, null)
  )

  private val epochDelta: Seq[(String, Any, Any)] = Seq(
    ("whole Double epoch", 1771286400.0, "2026-02-17"),
    ("exponent BigDecimal epoch", BigDecimal("1.7712864E+9"), "2026-02-17"),
    ("decimal-point string", "1771286400.0", "2026-02-17"),
    ("exponent string", "1.7712864E9", "2026-02-17"),
    ("small exponent string", "1e3", "1970-01-01")
  )

  "DateBucketStep.apply characterisation" should {
    unchanged.foreach { case (label, in, out) => s"keep $label" in { bucket(in) shouldBe out } }
    epochDelta.foreach { case (label, in, out) => s"parse $label (was null)" in { bucket(in) shouldBe out } }
  }

  "DateBucketStep.parseNonEpochDate (ColumnClassifier's date-like test)" should {
    "stay epoch-free: an epoch-looking cell is never date-like" in {
      Seq("1771286400", "1771286400000", "1.7712864E9", "1771286400.0", "-1").foreach { cell =>
        withClue(cell)(DateBucketStep.parseNonEpochDate(cell) shouldBe None)
      }
    }
    "still read every non-epoch shape" in {
      Seq("2026-07-01T12:00:00Z", "2026-07-01 12:00:00", "2026-07-01").foreach { cell =>
        withClue(cell)(DateBucketStep.parseNonEpochDate(cell).map(_.toString) shouldBe Some("2026-07-01"))
      }
    }
  }
}
