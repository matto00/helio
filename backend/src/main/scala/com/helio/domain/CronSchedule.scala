package com.helio.domain

import java.time.{Instant, ZoneId, ZonedDateTime}
import java.time.temporal.ChronoUnit
import scala.util.matching.Regex

/** Next-fire-time computation for a [[PipelineSchedule]] (HEL-415).
 *  Hand-rolled, no new dependency (design.md Decision 1) — mirrors
 *  `PipelineScheduleService`'s cron-field bounds *shape*, but this object
 *  performs field *matching* against a candidate instant rather than
 *  *validation* of the raw expression string; expressions are already
 *  validated at write time by `PipelineScheduleService.validateCron` /
 *  `validateInterval`. */
object CronSchedule {

  private val intervalPattern: Regex = "^(\\d+)(s|m|h|d)$".r

  /** Per-field (minute hour day-of-month month day-of-week) bounds — same
   *  shape as `PipelineScheduleService.cronFieldBounds`. Day-of-week is
   *  mapped `DayOfWeek.getValue % 7` so Sunday=0, matching standard cron. */
  private val fieldBounds: Vector[(Int, Int)] = Vector(0 -> 59, 0 -> 23, 1 -> 31, 1 -> 12, 0 -> 6)

  /** Minute-granularity scan cap (~4 years) for cron expressions — bounds
   *  the worst case for an expression that can never match (e.g. a
   *  day-of-month/month combination that never occurs, such as Feb 30).
   *  Fits comfortably within Int range (~2.1M). See design.md
   *  Risks/Trade-offs. */
  private val maxScanMinutes: Int = 4 * 365 * 24 * 60

  /** Compute the next instant strictly after `after` at which `expression`
   *  fires, or `None` if `kind`/`expression` is malformed or (for cron) no
   *  match exists within the scan cap. */
  def nextFireTime(kind: ScheduleKind, expression: String, timezone: String, after: Instant): Option[Instant] =
    kind match {
      case ScheduleKind.Interval => nextIntervalFire(expression, after)
      case ScheduleKind.Cron     => nextCronFire(expression, timezone, after)
    }

  private def nextIntervalFire(expression: String, after: Instant): Option[Instant] =
    expression.trim match {
      case intervalPattern(n, unit) =>
        val amount = n.toLongOption.getOrElse(0L)
        if (amount <= 0) None
        else
          unit match {
            case "s" => Some(after.plus(amount, ChronoUnit.SECONDS))
            case "m" => Some(after.plus(amount, ChronoUnit.MINUTES))
            case "h" => Some(after.plus(amount, ChronoUnit.HOURS))
            case "d" => Some(after.plus(amount, ChronoUnit.DAYS))
            case _   => None
          }
      case _ => None
    }

  private def nextCronFire(expression: String, timezone: String, after: Instant): Option[Instant] = {
    val fields = expression.trim.split("\\s+")
    if (fields.length != 5) None
    else {
      val zone  = ZoneId.of(timezone)
      val start = after.atZone(zone).plusMinutes(1).withSecond(0).withNano(0)
      (0 until maxScanMinutes).iterator
        .map(offset => start.plusMinutes(offset.toLong))
        .find(matches(_, fields))
        .map(_.toInstant)
    }
  }

  private def matches(zdt: ZonedDateTime, fields: Array[String]): Boolean =
    matchesField(fields(0), zdt.getMinute, fieldBounds(0)) &&
      matchesField(fields(1), zdt.getHour, fieldBounds(1)) &&
      matchesField(fields(2), zdt.getDayOfMonth, fieldBounds(2)) &&
      matchesField(fields(3), zdt.getMonthValue, fieldBounds(3)) &&
      matchesField(fields(4), zdt.getDayOfWeek.getValue % 7, fieldBounds(4))

  private def matchesField(field: String, value: Int, bounds: (Int, Int)): Boolean =
    field.split(",").exists(matchesToken(_, value, bounds))

  private def matchesToken(token: String, value: Int, bounds: (Int, Int)): Boolean = token match {
    case "*" => true
    case t if t.contains("/") =>
      t.split("/", 2) match {
        case Array(base, step) =>
          step.toIntOption match {
            case Some(stepN) if stepN > 0 =>
              val baseN = if (base == "*") bounds._1 else base.toIntOption.getOrElse(bounds._1)
              value >= baseN && (value - baseN) % stepN == 0
            case _ => false
          }
        case _ => false
      }
    case t if t.contains("-") =>
      t.split("-", 2) match {
        case Array(lo, hi) =>
          (lo.toIntOption, hi.toIntOption) match {
            case (Some(l), Some(h)) => value >= l && value <= h
            case _                  => false
          }
        case _ => false
      }
    case t => t.toIntOption.contains(value)
  }
}
