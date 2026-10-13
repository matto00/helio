package com.helio.domain.engine

import java.math.{BigDecimal => JBigDecimal, BigInteger => JBigInteger}
import java.time.format.{DateTimeFormatter, DateTimeFormatterBuilder, ResolverStyle}
import java.time.temporal.ChronoField
import java.time.{Instant, LocalDate, LocalDateTime, LocalTime, OffsetDateTime, ZoneOffset, ZonedDateTime}
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
   *  1-digit and 6-digit (Postgres/pandas microsecond) widths, reintroducing an all-null failure.
   *  STRICT `uuuu` (HEL-1532 D2) so `2026-02-29` is rejected rather than clamped to 28 Feb and `24:00` is
   *  rejected rather than rolled to the next midnight; the year `0000` it would admit is closed by [[passesGate]]. */
  private val SpaceSeparatedFormatter = new DateTimeFormatterBuilder()
    .appendPattern("uuuu-MM-dd HH:mm[:ss]")
    .appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true)
    .toFormatter()
    .withResolverStyle(ResolverStyle.STRICT)

  /** Magnitude above which an epoch is read as milliseconds rather than seconds. */
  private val EpochMillisThreshold = 9999999999L

  /** Widest decimal exponent magnitude tried before giving up: a Long has at most 19 digits, so a
   *  larger scale can never be a whole number in range, and bounding it keeps `1e999999999` cheap. */
  private val MaxScaleMagnitude = 40

  /** `MM/dd/yyyy` (two-digit month and day), STRICT so `02/30/2026` is rejected rather than clamped to
   *  28 Feb as inference's SMART `MM/dd/yyyy` reader would (HEL-1502 D2). */
  private val UsDateFormatter = DateTimeFormatter.ofPattern("MM/dd/uuuu").withResolverStyle(ResolverStyle.STRICT)

  /** HEL-1502 D1/D2: `<date>[T t space]<time><offset>[<id>]`. The offset is `Z`/`z` (only after a `T`),
   *  or a sign then `HH`, `HHMM`, `HH:MM` or `HH:MM:SS`. The optional `[id]` is stripped syntactically
   *  and never validated against a time-zone database: the written offset alone decides the instant.
   *  The same grammar is mirrored by the frontend `parseChartInstant`. */
  private val OffsetDateTimeRegex =
    ("""^(\d{4}-\d{2}-\d{2})([Tt ])(\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)""" +
      """([Zz]|[+-](?:\d{4}|\d{2}(?::\d{2}(?::\d{2})?)?))(?:\[[A-Za-z0-9_+\-/:]+\])?$""").r

  /** HEL-1532 D2 gate inputs: a leading date (`[+-]?\d+-`), a `MM/dd/yyyy` date, and a date followed by a
   *  time field. Only the field each check names is read, so offsets (`+18:00`) and bracketed ids
   *  (`[UTC+01:00]`) are never inspected. */
  private val LeadingYearRegex = """^([+-]?\d+)-.*""".r
  private val UsYearRegex      = """^\d{2}/\d{2}/(.*)$""".r
  private val DateTimeRestRegex = """^[+-]?\d+-\d{2}-\d{2}[Tt ](.*)$""".r
  private val TimeStartRegex    = """^(\d{2}):(\d{2})(?::(\d{2}))?.*""".r
  private val FractionAfterSeconds = """^\d{2}:\d{2}:\d{2}\..*""".r

  /** HEL-1532 D2: the syntactic gate that runs before EVERY reader, so none of them can fold, roll or clamp
   *  a value into an instant the text does not denote. Rejects: a written year that is not exactly four
   *  digits, signed, or `0000` (also for `MM/dd/yyyy`); in the time field only, a `.` not followed by a
   *  digit, a fraction after minutes, seconds `60` and hour `24`. */
  private def passesGate(str: String): Boolean = {
    val yearOk = str match {
      case UsYearRegex(year)      => year.length == 4 && year.forall(c => c >= '0' && c <= '9') && year != "0000"
      case LeadingYearRegex(year) => year.length == 4 && year.forall(c => c >= '0' && c <= '9') && year != "0000"
      case _                      => true
    }
    yearOk && (str match {
      case DateTimeRestRegex(rest) => timeFieldOk(rest.takeWhile(c => !"Zz+-[".contains(c)))
      case _                       => true
    })
  }

  /** `field` is the text between the date-time separator and the first offset character or `[`. */
  private def timeFieldOk(field: String): Boolean = {
    val dotsOk = field.indices.forall(i => field(i) != '.' || (i + 1 < field.length && field(i + 1).isDigit))
    val fractionOk = !field.contains('.') || FractionAfterSeconds.matches(field)
    val fieldsOk = field match {
      case TimeStartRegex(h, _, sec) => h != "24" && sec != "60"
      case _                => true
    }
    dotsOk && fractionOk && fieldsOk
  }

  private val MinEpochInstant = Instant.parse("0001-01-01T00:00:00Z")
  private val MaxEpochInstant = Instant.parse("9999-12-31T23:59:59.999999999Z")

  /** The instant `value` denotes (UTC), or `None` when it is not a timestamp. Accepted, in this order:
   *  a whole-number epoch (number or numeric string, seconds, or milliseconds above 9999999999) whose
   *  instant lies in years 0001-9999, an ISO instant, an ISO offset date-time, a `T`- or
   *  space-separated date-time with a numeric offset `+HH`/`+HHMM`/`+HH:MM`/`+HH:MM:SS` (Postgres
   *  `timestamptz` text), either offset form followed by a `[Region/Id]` suffix (read at its written
   *  offset), a tz-less `T`-separated or space-separated local date-time (read as UTC), a bare
   *  `yyyy-MM-dd` date (midnight UTC), and `MM/dd/yyyy` (midnight UTC, strict). Never clamps, rolls or folds
   *  (HEL-1532): an impossible date (`2026-02-29`), hour `24`, a leap second (`:60`), an empty fraction
   *  (`12:00:00.`), a fraction after minutes (`12:00.5`) and a written year outside 0001-9999 (`0000`,
   *  `+12026`) are not timestamps. Never throws. */
  def parseInstant(value: Any): Option[Instant] =
    if (value == null) None
    else epochInstant(value).orElse(parseNonEpochInstant(value.toString.trim))

  /** The epoch half of [[parseInstant]] (bounded to years 0001-9999): the instant a number or numeric string
   *  denotes as an epoch, else `None`. `CastStep` uses it to emit a numeric epoch as an ISO instant. */
  def epochInstant(value: Any): Option[Instant] = if (value == null) None else epochOf(value).flatMap(fromEpoch)

  /** Every accepted shape except an epoch number; the first-run `ColumnClassifier` reads date-like
   *  columns through this so a numeric id column is never mistaken for a date. */
  def parseNonEpochInstant(str: String): Option[Instant] =
    if (str == null || str.isEmpty || !passesGate(str)) None
    else
      Try(Instant.parse(str)).toOption
        .orElse(Try(OffsetDateTime.parse(str).toInstant).toOption)
        .orElse(parseWrittenOffset(str))
        .orElse(Try(LocalDateTime.parse(str, DateTimeFormatter.ISO_LOCAL_DATE_TIME).toInstant(ZoneOffset.UTC)).toOption)
        .orElse(Try(LocalDateTime.parse(str, SpaceSeparatedFormatter).toInstant(ZoneOffset.UTC)).toOption)
        .orElse(Try(LocalDate.parse(str).atStartOfDay().toInstant(ZoneOffset.UTC)).toOption)
        .orElse(Try(LocalDate.parse(str, UsDateFormatter).atStartOfDay().toInstant(ZoneOffset.UTC)).toOption)

  /** The instant of a date-time carrying a numeric (or `T`-only `Z`) offset, with an optional bracketed id. */
  private def parseWrittenOffset(str: String): Option[Instant] = str match {
    case OffsetDateTimeRegex(date, sep, time, offset) if !(offset.equalsIgnoreCase("Z") && sep == " ") =>
      for {
        zone <- offsetOf(offset)
        ldt  <- Try(LocalDateTime.of(LocalDate.parse(date, DateTimeFormatter.ISO_LOCAL_DATE), LocalTime.parse(time, DateTimeFormatter.ISO_LOCAL_TIME))).toOption
      } yield ldt.toInstant(zone)
    case _ => None
  }

  /** The sign applies to EVERY component (`-0330` is -3h -30m); `ofHoursMinutesSeconds` rejects mixed signs
   *  and anything past +-18:00 or with minutes/seconds above 59. */
  private def offsetOf(text: String): Option[ZoneOffset] =
    if (text.equalsIgnoreCase("Z")) Some(ZoneOffset.UTC)
    else {
      val sign   = if (text.head == '-') -1 else 1
      val digits = text.tail.replace(":", "")
      def part(from: Int): Int = if (digits.length >= from + 2) digits.substring(from, from + 2).toInt else 0
      Try(ZoneOffset.ofHoursMinutesSeconds(sign * part(0), sign * part(2), sign * part(4))).toOption
    }

  /** Bounded to years 0001-9999 (HEL-1502 D5), which also drops `Long.MinValue`/`Long.MaxValue`. The
   *  seconds/millis threshold still decides the unit first. */
  private def fromEpoch(epoch: Long): Option[Instant] =
    Try(if (epoch > EpochMillisThreshold || epoch < -EpochMillisThreshold) Instant.ofEpochMilli(epoch) else Instant.ofEpochSecond(epoch)).toOption
      .filter(i => !i.isBefore(MinEpochInstant) && !i.isAfter(MaxEpochInstant))

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
