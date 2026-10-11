package com.helio.domain.engine

import java.time.format.DateTimeFormatter
import java.time.temporal.{ChronoUnit, TemporalAdjusters}
import java.time.{DayOfWeek, Duration, Instant, LocalDate, ZoneOffset}
import scala.util.Try

import ExpressionInterpreter.{VNull, VNum, VStr, Val}

/** HEL-1314: `seconds_between`, `date_trunc` and `add_days`. Each timestamp argument is read through
 *  the shared [[TimestampParsing.parseInstant]] and interpreted in UTC; a value it rejects makes the
 *  row's result `null` (never a run failure). The caller (`ExpressionInterpreter.applyFn`) has already
 *  turned a null argument into a null result.
 *
 *  One object per function family is the pattern: a family adds its names to a registry vector in
 *  `ExpressionEvaluator`, its arities to `ExpressionParser.checkArity`, and one delegating case to
 *  `applyFn`. */
private[engine] object ExpressionDateTimeFunctions {

  val TruncUnits: Vector[String] = Vector("second", "minute", "hour", "day", "week", "month", "quarter", "year")

  /** Parse-time error for a `date_trunc` unit that is not one of [[TruncUnits]] as a string literal. */
  val UnitsMessage: String = s"date_trunc unit must be a string literal, one of: ${TruncUnits.mkString(", ")}"

  private val SecondsPerDay = BigDecimal(86400)
  private val NanosPerSecond = BigDecimal(1000000000L)

  def apply(name: String, args: Vector[Val]): Either[EvaluationError, Val] = name match {
    case "seconds_between" => Right(secondsBetween(args(0), args(1)))
    case "date_trunc"      => dateTrunc(args(0), args(1))
    case "add_days"        => addDays(args(0), args(1))
    case other             => Left(EvaluationError.ParseError(s"Unknown function: $other"))
  }

  private def instantOf(v: Val): Option[Instant] = v match {
    case VStr(s)  => TimestampParsing.parseInstant(s)
    case VNum(n)  => TimestampParsing.parseInstant(n)
    case VNull    => None
  }

  private def secondsBetween(end: Val, start: Val): Val =
    (for {
      e <- instantOf(end)
      s <- instantOf(start)
      d <- Try(Duration.between(s, e)).toOption
    } yield VNum(d.getSeconds.toDouble + d.getNano / 1e9 + 0.0)) // + 0.0 turns -0.0 into 0.0
      .getOrElse(VNull)

  private def dateTrunc(unit: Val, ts: Val): Either[EvaluationError, Val] = unit match {
    case VStr(u) if TruncUnits.contains(u) =>
      Right(instantOf(ts).flatMap(i => Try(truncate(u, i)).toOption).map(i => VStr(format(i))).getOrElse(VNull))
    case _ => Left(EvaluationError.ParseError(UnitsMessage))
  }

  private def truncate(unit: String, i: Instant): Instant = {
    def atDate(f: LocalDate => LocalDate): Instant =
      f(i.atZone(ZoneOffset.UTC).toLocalDate).atStartOfDay(ZoneOffset.UTC).toInstant
    unit match {
      case "second"  => i.truncatedTo(ChronoUnit.SECONDS)
      case "minute"  => i.truncatedTo(ChronoUnit.MINUTES)
      case "hour"    => i.truncatedTo(ChronoUnit.HOURS)
      case "day"     => i.truncatedTo(ChronoUnit.DAYS)
      case "week"    => atDate(_.`with`(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)))
      case "month"   => atDate(_.withDayOfMonth(1))
      case "quarter" => atDate(d => d.withMonth(((d.getMonthValue - 1) / 3) * 3 + 1).withDayOfMonth(1))
      case _         => atDate(_.withDayOfYear(1))
    }
  }

  /** `ts + n * 86400` seconds exactly. Split into whole seconds plus a nanosecond remainder rather
   *  than one Long of nanoseconds, which would cap the shift near 106,751 days. */
  private def addDays(ts: Val, n: Val): Either[EvaluationError, Val] = n match {
    case VNum(days) =>
      Right(
        (for {
          i <- instantOf(ts)
          r <- Try {
                 require(!days.isNaN && !days.isInfinite)
                 val total = (BigDecimal(days) * SecondsPerDay).setScale(9, BigDecimal.RoundingMode.HALF_UP)
                 val whole = total.setScale(0, BigDecimal.RoundingMode.FLOOR)
                 i.plusSeconds(whole.toLongExact).plusNanos(((total - whole) * NanosPerSecond).toLongExact)
               }.toOption
        } yield VStr(format(r))).getOrElse(VNull)
      )
    case other =>
      Left(EvaluationError.TypeError(s"add_days requires a numeric day count, got ${ExpressionInterpreter.typeName(other)}"))
  }

  private def format(i: Instant): String = DateTimeFormatter.ISO_INSTANT.format(i)
}
