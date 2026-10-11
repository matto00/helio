package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

class TimestampParsingSpec extends AnyWordSpec with Matchers {

  private val Noon = Instant.parse("2026-07-01T12:00:00Z")

  private val accepted: Seq[(String, Any, Instant)] = Seq(
    ("ISO instant with Z", "2026-07-01T12:00:00Z", Noon),
    ("ISO offset converted to UTC", "2026-07-01T14:00:00+02:00", Noon),
    ("negative offset", "2026-07-01T07:00:00-05:00", Noon),
    ("T-local without zone is UTC", "2026-07-01T12:00:00", Noon),
    ("T-local with 3 fraction digits", "2026-07-01T12:00:00.123", Instant.parse("2026-07-01T12:00:00.123Z")),
    ("T-local with 6 fraction digits", "2026-07-01T12:00:00.123456", Instant.parse("2026-07-01T12:00:00.123456Z")),
    ("T-local with 9 fraction digits", "2026-07-01T12:00:00.123456789", Instant.parse("2026-07-01T12:00:00.123456789Z")),
    ("space-local with seconds", "2026-07-01 12:00:00", Noon),
    ("space-local without seconds", "2026-07-01 12:00", Noon),
    ("space-local with 1 fraction digit", "2026-07-01 12:00:00.5", Instant.parse("2026-07-01T12:00:00.5Z")),
    ("space-local with 6 fraction digits", "2026-07-01 12:00:00.123456", Instant.parse("2026-07-01T12:00:00.123456Z")),
    ("bare date is midnight UTC", "2026-07-01", Instant.parse("2026-07-01T00:00:00Z")),
    ("surrounding whitespace", "  2026-07-01T12:00:00Z  ", Noon),
    ("epoch seconds as string", "1782907200", Noon),
    ("epoch millis as string", "1782907200000", Noon),
    ("epoch seconds as Long", 1782907200L, Noon),
    ("epoch seconds as Int", 1782907200, Noon),
    ("epoch millis as Long", 1782907200000L, Noon),
    ("epoch seconds as whole Double", 1782907200.0, Noon),
    ("epoch millis as whole Double", 1782907200000.0, Noon),
    ("epoch seconds as BigDecimal", BigDecimal("1782907200"), Noon),
    ("epoch seconds as BigInt", BigInt(1782907200L), Noon),
    ("epoch seconds as Float-free whole Double string", "1782907200.0", Noon),
    ("scientific whole epoch string", "1.7829072E9", Noon),
    ("scientific whole epoch Double toString", 1.7829072E9.toString, Noon),
    ("negative epoch", "-1", Instant.parse("1969-12-31T23:59:59Z")),
    ("scientific small whole", "1e3", Instant.parse("1970-01-01T00:16:40Z"))
  )

  private val rejected: Seq[(String, Any)] = Seq(
    ("garbage", "not a date"),
    ("blank", ""),
    ("whitespace only", "   "),
    ("invalid month", "2026-13-01"),
    ("invalid hour", "2026-07-01T25:00:00Z"),
    ("MM/dd/yyyy is not a shared shape", "07/01/2026"),
    ("fractional epoch string", "1782907200.5"),
    ("fractional epoch Double", 1782907200.5),
    ("NaN", Double.NaN),
    ("NaN string", "NaN"),
    ("Infinity", Double.PositiveInfinity),
    ("negative Infinity", Double.NegativeInfinity),
    ("out of Long range Double", 1e30),
    ("out of Long range string", "1e30"),
    ("huge exponent string", "1e999999999"),
    ("a Boolean", true),
    ("null", null)
  )

  "TimestampParsing.parseInstant" should {
    accepted.foreach { case (label, in, expected) =>
      s"accept $label" in { TimestampParsing.parseInstant(in) shouldBe Some(expected) }
    }
    rejected.foreach { case (label, in) =>
      s"reject $label" in { TimestampParsing.parseInstant(in) shouldBe None }
    }
  }

  "TimestampParsing.parseNonEpochInstant" should {
    "accept every non-epoch shape" in {
      val epochLabel = Seq("epoch", "scientific", "small whole")
      accepted.collect { case (label, s: String, e) if !epochLabel.exists(label.contains) => (s, e) }
        .foreach { case (s, e) => withClue(s)(TimestampParsing.parseNonEpochInstant(s.trim) shouldBe Some(e)) }
    }
    "reject epoch-looking strings" in {
      Seq("1771286400", "1.7712864E9", "1782907200000", "-1").foreach { s =>
        withClue(s)(TimestampParsing.parseNonEpochInstant(s) shouldBe None)
      }
    }
  }
}
