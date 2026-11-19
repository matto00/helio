package com.helio.domain.insights

import java.time.{Duration, Instant, LocalDate, ZoneOffset}

/** One insight Output as the tick pass sees it: its refresh mode and the three instants the schedule predicates read. */
final case class InsightCandidate(
    outputId: String,
    pipelineId: String,
    refresh: String,
    outputCreatedAt: Instant,
    newestAttempt: Option[Instant],
    lastModelCall: Option[Instant],
    pipelineLastRunAt: Option[Instant]
)

/** HEL-1743 D4/D5: which candidates the tick pass renders. Pure so each rule is tested on its own. */
object InsightSchedule {

  def dayStart(now: Instant, hourUtc: Int): Instant =
    LocalDate.ofInstant(now, ZoneOffset.UTC).atStartOfDay(ZoneOffset.UTC).plusHours(hourUtc.toLong).toInstant

  /** `daily`: once per UTC day, at or after the daily hour, when the newest attempt is older than that day's cut. Restart-safe
   *  because it reads the stored attempt, not memory. */
  def dailyDue(c: InsightCandidate, now: Instant, hourUtc: Int): Boolean = {
    val cut = dayStart(now, hourUtc)
    c.refresh == "daily" && !now.isBefore(cut) && c.newestAttempt.forall(_.isBefore(cut))
  }

  /** `on_run` catch-up: the last model call is at least `throttle` old, and the pipeline's last run (ANY status, so a later
   *  failed run cannot hide an earlier success) began no earlier than `overlapGrace` before the newest attempt. `last_run_at`
   *  is stamped when a run's writes BEGIN, so a run that began before the newest render started but committed after it read
   *  its inputs is still caught as long as its write phase is shorter than the grace. A false positive costs a digest check
   *  and a coalesced row, never a send. The loop ends because the catch-up's own row is stamped after that run. */
  def catchUpDue(c: InsightCandidate, now: Instant, throttle: Duration, overlapGrace: Duration): Boolean =
    c.refresh == "on_run" &&
      c.lastModelCall.forall(last => !last.isAfter(now.minus(throttle))) &&
      c.pipelineLastRunAt.exists { run =>
        // No attempt yet: only a run that began after the insight existed owes it a render (an insight created after the
        // pipeline last ran waits for the next run, or a pin/refresh). Otherwise the overlap grace applies.
        c.newestAttempt.fold(!run.isBefore(c.outputCreatedAt))(att => !run.isBefore(att.minus(overlapGrace)))
      }
}
