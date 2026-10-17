package com.helio.services.home

import com.helio.domain.model.ScheduleKind
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

/** HEL-1578: every `home-summary-api` scenario against the pure builder, with a fixture clock off the hour (10:07). */
class HomeSummaryBuilderSpec extends AnyWordSpec with Matchers {

  private val now = Instant.parse("2026-10-15T10:07:00Z")
  private def ago(minutes: Long): Instant = now.minusSeconds(minutes * 60)
  private def at(hhmm: String): Instant = Instant.parse(s"2026-10-15T${hhmm}:00Z")

  private def run(p: String, name: String, status: String, started: Instant, error: Option[String] = None, id: String = null): HomeRunRow =
    HomeRunRow(Option(id).getOrElse(s"$p-$status-${started.getEpochSecond}"), p, name, status, started, Some(started.plusSeconds(30)), "manual", Some(3), error)

  private def hourly(p: String, name: String, next: Instant) =
    HomeScheduleRow(p, name, ScheduleKind.Cron, "0 * * * *", "UTC", Some(next))
  private def every2h(p: String, name: String, next: Instant) =
    HomeScheduleRow(p, name, ScheduleKind.Interval, "2h", "UTC", Some(next))

  private def build(runs: Seq[HomeRunRow], schedules: Seq[HomeScheduleRow] = Nil) =
    HomeSummaryBuilder.build(HomeSummaryRows(runs.toVector, schedules.toVector), now)

  "window" should {
    "span 24h back and 6h ahead of serverNow" in {
      val s = build(Nil)
      s.windowStart shouldBe now.minusSeconds(24 * 3600)
      s.horizonEnd shouldBe now.plusSeconds(6 * 3600)
    }
  }

  "runs and fires" should {
    "list only in-window runs and six hourly fires for an hourly cron schedule" in {
      val s = build(
        Seq(run("p", "P", "succeeded", ago(120)), run("p", "P", "failed", ago(30 * 60))),
        Seq(hourly("p", "P", at("11:00")))
      )
      val p = s.pipelines.head
      p.runs.map(_.status) shouldBe Vector("succeeded")
      p.upcoming shouldBe Vector("11:00", "12:00", "13:00", "14:00", "15:00", "16:00").map(at)
    }

    "follow the stored next fire for an interval schedule, not now" in {
      val s = build(Nil, Seq(every2h("p", "P", at("11:00"))))
      s.pipelines.head.upcoming shouldBe Vector("11:00", "13:00", "15:00").map(at)
    }

    "project a due fire at now and raise no missed item" in {
      val s = build(Nil, Seq(every2h("p", "P", now.minusSeconds(180))))
      s.pipelines.head.upcoming shouldBe Vector(now, now.plusSeconds(7200), now.plusSeconds(14400))
      s.attention shouldBe empty
    }

    "treat a fire due exactly now as projected at now" in {
      val s = build(Nil, Seq(every2h("p", "P", now)))
      s.pipelines.head.upcoming.head shouldBe now
    }

    "project a never-computed schedule forward from now, as the scheduler's first tick does" in {
      val s = build(Nil, Seq(hourly("p", "P", now).copy(nextRunAt = None)))
      s.pipelines.head.upcoming shouldBe Vector("11:00", "12:00", "13:00", "14:00", "15:00", "16:00").map(at)
      s.upNext.map(_.at) shouldBe Vector(at("11:00"))
      s.attention shouldBe empty
    }

    "exclude a pipeline whose only run is a dry run (never passed to the builder) and an idle pipeline" in {
      build(Nil).pipelines shouldBe empty
      build(Nil).pipelinesWithActivity shouldBe 0
    }

    "bound runs per pipeline and report the omitted count" in {
      val runs = (1 to 160).map(i => run("p", "P", "succeeded", ago(i.toLong), id = s"r$i"))
      val p    = build(runs).pipelines.head
      p.runs should have size 150
      p.runsOmitted shouldBe 10
      p.runs.head.runId shouldBe "r1"
    }

    "not list a live run started before the window under runs (attention only)" in {
      val old = run("p", "P", "running", now.minusSeconds(30 * 3600))
      val s   = build(Seq(old))
      s.pipelines shouldBe empty
      s.attention.map(_.kind) shouldBe Vector("stuck")
    }
  }

  "top eight" should {
    "pin a quiet failing pipeline above nine busy healthy ones" in {
      val busy = (1 to 9).flatMap(i => (1 to 5).map(j => run(s"b$i", s"busy-$i", "succeeded", ago((i * 10 + j).toLong), id = s"b$i-$j")))
      val bad  = run("bad", "quiet-fail", "failed", ago(200), Some("boom"))
      val s    = build(busy :+ bad)
      s.pipelines should have size 8
      s.pipelines.map(_.pipelineId) should contain("bad")
      s.pipelines.head.pipelineId shouldBe "bad"
      s.pipelinesWithActivity shouldBe 10
    }

    "rank the rest by activity, then latest run, then name" in {
      val s = build(Seq(
        run("a", "alpha", "succeeded", ago(60)),
        run("b", "bravo", "succeeded", ago(10)),
        run("c", "charlie", "succeeded", ago(10), id = "c1"), run("c", "charlie", "succeeded", ago(20), id = "c2")
      ))
      s.pipelines.map(_.name) shouldBe Vector("charlie", "bravo", "alpha")
    }
  }

  "attention" should {
    "carry a failed run with its reason and no resolution" in {
      val s = build(Seq(run("p", "P", "failed", ago(180), Some("source returned 0 rows"))))
      val a = s.attention.head
      (a.kind, a.reason, a.resolvedAt, a.inFlight) shouldBe (("failed", Some("source returned 0 rows"), None, false))
    }

    "keep a resolved failure with resolvedAt equal to the later success's start" in {
      val ok = run("p", "P", "succeeded", ago(120))
      val s  = build(Seq(run("p", "P", "failed", ago(300), Some("x")), ok))
      s.attention.head.resolvedAt shouldBe Some(ok.startedAt)
    }

    "report the most recent failed run only, once per pipeline" in {
      val s = build(Seq(run("p", "P", "failed", ago(300), Some("old")), run("p", "P", "failed", ago(60), Some("new"))))
      s.attention.map(_.reason) shouldBe Vector(Some("new"))
    }

    "report stuck (live > 15 min) and missed (due > 10 min) items" in {
      val s = build(
        Seq(run("s", "stuck-p", "running", ago(20))),
        Seq(every2h("m", "missed-p", ago(12)))
      )
      s.attention.map(a => (a.kind, a.pipelineId)).toSet shouldBe Set(("stuck", "s"), ("missed", "m"))
      s.attention.find(_.kind == "missed").get.runId shouldBe None
    }

    "not flag a run live for under 15 minutes or a fire due under 10 minutes ago" in {
      build(Seq(run("s", "s", "running", ago(14))), Seq(every2h("m", "m", ago(9)))).attention shouldBe empty
    }

    "mark inFlight on a failed item whose pipeline has a live run, also outside the top eight" in {
      val s = build(Seq(run("p", "P", "failed", ago(60), Some("x")), run("p", "P", "running", ago(2))))
      s.attention.find(_.kind == "failed").get.inFlight shouldBe true
    }
  }

  "upNext" should {
    "list the five soonest first fires, one per schedule, regardless of the horizon" in {
      val schedules = (1 to 7).map(i => hourly(s"p$i", s"p$i", now.plusSeconds((i * 3L + 1) * 3600)))
      val s         = build(Nil, schedules)
      s.upNext should have size 5
      s.upNext.map(_.at) shouldBe s.upNext.map(_.at).sorted
      s.upNext.head.pipelineId shouldBe "p1"
    }
  }
}
