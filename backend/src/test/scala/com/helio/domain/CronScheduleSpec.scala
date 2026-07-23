package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

/** HEL-415 — `CronSchedule.nextFireTime`: interval next-fire, cron next-fire
 *  (list/range/step syntax, timezone handling), and the infeasible-expression
 *  `None` case (task 6.1). */
class CronScheduleSpec extends AnyWordSpec with Matchers {

  "CronSchedule.nextFireTime (Interval)" should {

    "advance by minutes for an 'Nm' expression" in {
      val after = Instant.parse("2026-01-01T00:00:00Z")
      CronSchedule.nextFireTime(ScheduleKind.Interval, "30m", "UTC", after) shouldBe
        Some(Instant.parse("2026-01-01T00:30:00Z"))
    }

    "advance by hours for an 'Nh' expression" in {
      val after = Instant.parse("2026-01-01T00:00:00Z")
      CronSchedule.nextFireTime(ScheduleKind.Interval, "2h", "UTC", after) shouldBe
        Some(Instant.parse("2026-01-01T02:00:00Z"))
    }

    "advance by seconds for an 'Ns' expression" in {
      val after = Instant.parse("2026-01-01T00:00:00Z")
      CronSchedule.nextFireTime(ScheduleKind.Interval, "45s", "UTC", after) shouldBe
        Some(Instant.parse("2026-01-01T00:00:45Z"))
    }

    "advance by days for an 'Nd' expression" in {
      val after = Instant.parse("2026-01-01T00:00:00Z")
      CronSchedule.nextFireTime(ScheduleKind.Interval, "1d", "UTC", after) shouldBe
        Some(Instant.parse("2026-01-02T00:00:00Z"))
    }

    "return None for a malformed interval expression" in {
      val after = Instant.parse("2026-01-01T00:00:00Z")
      CronSchedule.nextFireTime(ScheduleKind.Interval, "not-an-interval", "UTC", after) shouldBe None
    }
  }

  "CronSchedule.nextFireTime (Cron)" should {

    "find the next matching minute for a simple every-5-minutes expression" in {
      val after = Instant.parse("2026-01-01T00:02:00Z")
      CronSchedule.nextFireTime(ScheduleKind.Cron, "*/5 * * * *", "UTC", after) shouldBe
        Some(Instant.parse("2026-01-01T00:05:00Z"))
    }

    "skip to the next hour boundary for a top-of-the-hour expression" in {
      val after = Instant.parse("2026-01-01T00:30:00Z")
      CronSchedule.nextFireTime(ScheduleKind.Cron, "0 * * * *", "UTC", after) shouldBe
        Some(Instant.parse("2026-01-01T01:00:00Z"))
    }

    "match a comma list, range, and step across all five fields" in {
      // Minute 0/15/30/45, hour 8-18, every 2nd day-of-month, month 1 or 6,
      // weekday 1-5 (Mon-Fri). 2026-01-05 is a Monday.
      val after = Instant.parse("2026-01-05T07:59:00Z")
      CronSchedule.nextFireTime(ScheduleKind.Cron, "0,15,30,45 8-18 */2 1,6 1-5", "UTC", after) shouldBe
        Some(Instant.parse("2026-01-05T08:00:00Z"))
    }

    "always compute strictly after the given instant, even at an exact match" in {
      // after is already exactly on a 5-minute boundary — next fire must be
      // the *following* boundary, not the same instant.
      val after = Instant.parse("2026-01-01T00:05:00Z")
      CronSchedule.nextFireTime(ScheduleKind.Cron, "*/5 * * * *", "UTC", after) shouldBe
        Some(Instant.parse("2026-01-01T00:10:00Z"))
    }

    "convert to the schedule's timezone before matching fields" in {
      // 09:00 America/New_York in January (EST, UTC-5) is 14:00 UTC.
      val after = Instant.parse("2026-01-01T00:00:00Z")
      val result = CronSchedule.nextFireTime(ScheduleKind.Cron, "0 9 * * *", "America/New_York", after)
      result shouldBe Some(Instant.parse("2026-01-01T14:00:00Z"))
    }

    "return None for a malformed field count" in {
      val after = Instant.parse("2026-01-01T00:00:00Z")
      CronSchedule.nextFireTime(ScheduleKind.Cron, "* * * *", "UTC", after) shouldBe None
    }

    "return None for an infeasible day/month combination (Feb 30 never occurs)" in {
      val after = Instant.parse("2026-01-01T00:00:00Z")
      CronSchedule.nextFireTime(ScheduleKind.Cron, "0 0 30 2 *", "UTC", after) shouldBe None
    }
  }
}
