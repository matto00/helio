package com.helio.domain.engine

import java.math.{BigDecimal => JBigDecimal, BigInteger => JBigInteger}
import java.time.format.{DateTimeFormatter, DateTimeFormatterBuilder}
import java.time.temporal.ChronoField
import java.time.{Instant, LocalDate, LocalDateTime, OffsetDateTime, ZoneOffset, ZonedDateTime}
import scala.util.Try

/** HEL-1076 tasks.md 2.1: extracted from `SchemaInferenceEngine.isTimestamp` (behavior-preserving
 *  refactor) so both schema inference and `DatasetRowValidator` share ONE definition of "does this
 *  string look like a timestamp" rather than duplicating four `DateTimeFormatter` patterns.
 *
 *  HEL-1314 adds [[parseInstant]]: the single reader of "which instant does this value denote" that the
 *  datebucket step, the cast step's timestamp/date targets and the compute date/time functions share. */
object TimestampParsing {

  /** `true` when `s` parses under any of the four formats this codebase already treats as a
   *  timestamp: `ISO_DATE_TIME`, `ISO_LOCAL_DATE_TIME`, `ISO_LOCAL_DATE` (a bare date), or
   *  `MM/dd/yyyy`. Deliberately NOT widened to [[parseInstant]]'s set: schema inference and
   *  `DatasetRowValidator` call this, and what they call a timestamp must not change. */
  def looksLikeTimestamp(s: String): Boolean =
    Try(ZonedDateTime.parse(s, DateTimeFormatter.ISO_DATE_TIME)).isSuccess ||
    Try(LocalDateTime.parse(s, DateTimeFormatter.ISO_LOCAL_DATE_TIME)).isSuccess ||
    Try(LocalDate.parse(s, DateTimeFormatter.ISO_LOCAL_DATE)).isSuccess ||
    Try(LocalDate.parse(s, DateTimeFormatter.ofPattern("MM/dd/yyyy"))).isSuccess

  /** Space-separated tz-less timestamp (`2026-07-01 12:00:00`, `2026-07-01 12:00`) with an optional
   *  **variable-length** (0-9 digit) fraction. A fixed `[.SSS]` pattern would silently reject the
   *  1-digit and 6-digit (Postgres/pandas microsecond) widths, reintroducing an all-null failure. */
  private val SpaceSeparatedFormatter = new DateTimeFormatterBuilder()
    .appendPattern("yyyy-MM-dd HH:mm[:ss]")
    .appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true)
    .toFormatter()

  /** Magnitude above which an epoch is read as milliseconds rather than seconds. */
  private val EpochMillisThreshold = 9999999999L

  /** Widest decimal exponent magnitude tried before giving up: a Long has at most 19 digits, so a
   *  larger scale can never be a whole number in range, and bounding it keeps `1e999999999` cheap. */
  private val MaxScaleMagnitude = 40

  /** The instant `value` denotes (UTC), or `None` when it is not a timestamp. Accepted, in this order:
   *  a whole-number epoch (number or numeric string, seconds, or milliseconds above 9999999999), an
   *  ISO instant, an ISO offset date-time, a tz-less `T`-separated or space-separated local date-time
   *  (read as UTC), and a bare `yyyy-MM-dd` date (midnight UTC). Never throws. */
  def parseInstant(value: Any): Option[Instant] =
    if (value == null) None
    else epochOf(value).flatMap(fromEpoch).orElse(parseNonEpochInstant(value.toString.trim))

  /** Every accepted shape except an epoch number; the first-run `ColumnClassifier` reads date-like
   *  columns through this so a numeric id column is never mistaken for a date. */
  def parseNonEpochInstant(str: String): Option[Instant] =
    if (str == null || str.isEmpty) None
    else
      Try(Instant.parse(str)).toOption
        .orElse(Try(OffsetDateTime.parse(str).toInstant).toOption)
        .orElse(Try(LocalDateTime.parse(str, DateTimeFormatter.ISO_LOCAL_DATE_TIME).toInstant(ZoneOffset.UTC)).toOption)
        .orElse(Try(LocalDateTime.parse(str, SpaceSeparatedFormatter).toInstant(ZoneOffset.UTC)).toOption)
        .orElse(Try(LocalDate.parse(str).atStartOfDay().toInstant(ZoneOffset.UTC)).toOption)

  /** `Try`-wrapped: `Long.MinValue` has no positive magnitude and would otherwise throw. */
  private def fromEpoch(epoch: Long): Option[Instant] =
    Try(if (epoch > EpochMillisThreshold || epoch < -EpochMillisThreshold) Instant.ofEpochMilli(epoch) else Instant.ofEpochSecond(epoch)).toOption

  private def epochOf(value: Any): Option[Long] = value match {
    case l: Long                  => Some(l)
    case i: Int                   => Some(i.toLong)
    case s: Short                 => Some(s.toLong)
    case b: Byte                  => Some(b.toLong)
    case bi: BigInt               => Option(bi).filter(_.isValidLong).map(_.toLong)
    case bi: JBigInteger          => Try(bi.longValueExact).toOption
    case d: Double                => if (d.isNaN || d.isInfinite) None else wholeLong(Try(BigDecimal(d)))
    case f: Float                 => if (f.isNaN || f.isInfinite) None else wholeLong(Try(BigDecimal(f.toDouble)))
    case bd: BigDecimal           => wholeLong(Try(bd))
    case bd: JBigDecimal          => wholeLong(Try(BigDecimal(bd)))
    case s: String                => Try(s.trim.toLong).toOption.orElse(wholeLong(Try(BigDecimal(s.trim))))
    case _                        => None
  }

  private def wholeLong(bd: Try[BigDecimal]): Option[Long] =
    bd.toOption.filter(d => math.abs(d.scale) <= MaxScaleMagnitude && d.isWhole).flatMap(d => Try(d.toLongExact).toOption)
}
