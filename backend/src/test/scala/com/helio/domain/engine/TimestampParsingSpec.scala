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
    ("single-digit MM/dd/yyyy", "1/5/2026"),
    ("impossible MM/dd/yyyy calendar date", "02/30/2026"),
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

  // HEL-1502 D1: Postgres numeric offsets on both separators. Offsets are (sign, h, m, s) with the sign
  // applied to EVERY component, so -0330 is -(3h30m), not -3h + 30m.
  private val PgOffsets: Seq[(String, Int)] = Seq(
    "+00" -> 0, "-00" -> 0, "+0530" -> (5 * 3600 + 30 * 60), "-0330" -> -(3 * 3600 + 30 * 60),
    "+05:30" -> (5 * 3600 + 30 * 60), "+05:30:15" -> (5 * 3600 + 30 * 60 + 15),
    "+18:00" -> 18 * 3600, "-1800" -> -18 * 3600, "+05" -> 5 * 3600
  )
  private val BadOffsets: Seq[String] =
    Seq("+18:30", "+18:00:01", "+053015", "+0530:15", "+5", "+05:3", "+19", "+0560", "+05:60")

  "TimestampParsing.parseInstant (HEL-1502 Postgres offsets)" should {
    for (sep <- Seq(" ", "T"); (off, secs) <- PgOffsets) {
      s"read 2026-07-01${sep}12:00:00$off at the written offset" in {
        TimestampParsing.parseInstant(s"2026-07-01${sep}12:00:00$off") shouldBe Some(Noon.minusSeconds(secs.toLong))
      }
    }
    for (sep <- Seq(" ", "T"); off <- BadOffsets) {
      s"reject 2026-07-01${sep}12:00:00$off" in {
        TimestampParsing.parseInstant(s"2026-07-01${sep}12:00:00$off") shouldBe None
      }
    }
    "read a space-separated offset with a fraction and without seconds" in {
      TimestampParsing.parseInstant("2026-07-01 12:00:00.5+00") shouldBe Some(Instant.parse("2026-07-01T12:00:00.5Z"))
      TimestampParsing.parseInstant("2026-07-01 12:00+0200") shouldBe Some(Instant.parse("2026-07-01T10:00:00Z"))
    }
    "keep rejecting a space-separated Z" in {
      TimestampParsing.parseInstant("2026-07-01 12:00:00Z") shouldBe None
    }
  }

  "TimestampParsing.parseInstant (HEL-1502 MM/dd/yyyy)" should {
    "read 07/01/2026 as midnight UTC" in {
      TimestampParsing.parseInstant("07/01/2026") shouldBe Some(Instant.parse("2026-07-01T00:00:00Z"))
    }
    "reject an impossible calendar date instead of clamping it" in {
      TimestampParsing.parseInstant("02/30/2026") shouldBe None
    }
    "reject single-digit month and day" in {
      TimestampParsing.parseInstant("1/5/2026") shouldBe None
    }
  }

  "TimestampParsing.parseInstant (HEL-1502 region suffix)" should {
    val ok: Seq[(String, String)] = Seq(
      "2026-07-01T14:00:00+02:00[Europe/Paris]" -> "2026-07-01T12:00:00Z",
      "2026-07-01T17:00:00+05:00[Europe/Paris]" -> "2026-07-01T12:00:00Z",
      "2026-07-01T12:00:00Z[UTC]" -> "2026-07-01T12:00:00Z",
      "2026-07-01T12:00:00+00[UTC]" -> "2026-07-01T12:00:00Z",
      "2026-07-01 17:30:00+0530[Asia/Kolkata]" -> "2026-07-01T12:00:00Z",
      "2026-07-01T14:00:00+02:00[europe/paris]" -> "2026-07-01T12:00:00Z",
      "2026-07-01T14:00:00+02:00[Bogus/Zone]" -> "2026-07-01T12:00:00Z",
      "2026-07-01T17:00:00+05:00[+05:00]" -> "2026-07-01T12:00:00Z",
      "2026-07-01T13:00:00+01:00[UTC+01:00]" -> "2026-07-01T12:00:00Z"
    )
    val bad: Seq[String] = Seq(
      "2026-07-01T12:00:00[Europe/Paris]", "2026-07-01T12:00:00+02:00[]", "2026-07-01T12:00:00+02:00[Europe Paris]",
      "2026-07-01T12:00:00+02:00[Europe/Paris", "2026-07-01 12:00:00Z[UTC]", "2026-07-01[UTC]"
    )
    ok.foreach { case (in, out) => s"read $in" in { TimestampParsing.parseInstant(in) shouldBe Some(Instant.parse(out)) } }
    bad.foreach(in => s"reject $in" in { TimestampParsing.parseInstant(in) shouldBe None })
  }

  "TimestampParsing epoch bound (HEL-1502 D5)" should {
    "accept 0001-01-01T00:00:00Z in millis" in {
      TimestampParsing.parseInstant(-62135596800000L) shouldBe Some(Instant.parse("0001-01-01T00:00:00Z"))
    }
    "reject one millisecond earlier" in { TimestampParsing.parseInstant(-62135596800001L) shouldBe None }
    "read -62135596800 as millis (1968)" in {
      TimestampParsing.parseInstant(-62135596800L) shouldBe Some(Instant.ofEpochMilli(-62135596800L))
    }
    "accept the last millisecond of year 9999" in {
      TimestampParsing.parseInstant(253402300799999L) shouldBe Some(Instant.parse("9999-12-31T23:59:59.999Z"))
    }
    "reject year 10000" in { TimestampParsing.parseInstant(253402300800000L) shouldBe None }
    "reject Long.MinValue and Long.MaxValue, as numbers and as strings" in {
      Seq[Any](Long.MinValue, Long.MaxValue, Long.MinValue.toString, Long.MaxValue.toString).foreach { v =>
        withClue(v.toString)(TimestampParsing.parseInstant(v) shouldBe None)
      }
    }
    "expose epochInstant for the epoch half only" in {
      TimestampParsing.epochInstant(1782907200.0) shouldBe Some(Noon)
      TimestampParsing.epochInstant("1782907200") shouldBe Some(Noon)
      TimestampParsing.epochInstant("2026-07-01T12:00:00Z") shouldBe None
      TimestampParsing.epochInstant(Long.MinValue) shouldBe None
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
