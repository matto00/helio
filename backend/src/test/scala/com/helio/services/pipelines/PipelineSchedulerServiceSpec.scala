package com.helio.services.pipelines

import com.helio.domain.util.CronSchedule
import com.helio.domain.model._
import slick.jdbc.PostgresProfile
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import scala.concurrent.{Future, Promise}

/** HEL-415 — `PipelineSchedulerService.tick`: due-schedule firing through the
 *  real `PipelineRunService.submit` path (embedded Postgres, mirrors
 *  `AlertEvaluationServiceSpec`'s fixture shape), both overlap-guard layers,
 *  the restart/null-recompute catch-up policy, the failure-recorded path,
 *  and the no-schedule no-op (task 6.2). Uses an injected fake `Clock` —
 *  never exercises Pekko's real timer (`PipelineSchedulerActor` is untested
 *  here by design; see design.md Decision 6). */
class PipelineSchedulerServiceSpec extends AnyWordSpec with Matchers with PipelineSchedulerServiceFixture {

  "PipelineSchedulerService.tick" should {

    "fire a due interval schedule, submit a run, and advance next_run_at/last_run_at" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), expression = "30m")

      await(service.tick())

      val runs = await(runRepo.listByPipelineInternal(pid))
      runs should have size 1
      runs.head.status        shouldBe "succeeded"
      // HEL-417: the scheduler-fired run must persist trigger_source = 'scheduled'.
      runs.head.triggerSource shouldBe "scheduled"

      val updated = await(scheduleRepo.findByPipelineId(pid, user)).get
      updated.lastRunAt shouldBe Some(fakeClock.now())
      updated.nextRunAt shouldBe Some(fakeClock.now().plus(30, ChronoUnit.MINUTES))
    }

    // HEL-483 design.md Decision 6 / spec's "A scheduler-triggered mutation
    // is recorded with source `system`" requirement.
    "record the fired run's pipeline.run.submit audit event with source=system, not ui" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), expression = "30m")

      await(service.tick())

      import PostgresProfile.api._
      val rows = await(db.run(
        sql"""SELECT source, actor_token_id FROM audit_events WHERE action = 'pipeline.run.submit' AND resource_id = ${pid.value}"""
          .as[(String, Option[String])]
      ))
      rows should have size 1
      rows.head._1 shouldBe "system"
      rows.head._2 shouldBe None
    }

    "fire a due cron schedule, submit a run, and advance next_run_at/last_run_at" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()
      fakeClock.set(Instant.parse("2026-03-01T00:02:00Z"))
      val expression = "*/5 * * * *"
      seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), kind = ScheduleKind.Cron, expression = expression)

      await(service.tick())

      val runs = await(runRepo.listByPipelineInternal(pid))
      runs should have size 1
      runs.head.status shouldBe "succeeded"

      val updated = await(scheduleRepo.findByPipelineId(pid, user)).get
      updated.lastRunAt shouldBe Some(fakeClock.now())
      updated.nextRunAt shouldBe CronSchedule.nextFireTime(ScheduleKind.Cron, expression, "UTC", fakeClock.now())
    }

    "never submit a run for a pipeline with no schedule" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()

      await(service.tick())

      await(runRepo.listByPipelineInternal(pid)) shouldBe empty
    }

    "recompute next_run_at without submitting a run when it is unset (restart / first-deploy case)" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      seedSchedule(pid, nextRunAt = None, lastRunAt = None, expression = "30m")

      await(service.tick())

      await(runRepo.listByPipelineInternal(pid)) shouldBe empty

      val updated = await(scheduleRepo.findByPipelineId(pid, user)).get
      updated.nextRunAt shouldBe Some(fakeClock.now().plus(30, ChronoUnit.MINUTES))
      updated.lastRunAt shouldBe None
    }

    "record a failed scheduled run in run history and still advance next_run_at/last_run_at" in {
      cleanDb(); seedUser()
      val pid = seedCsvPipeline("") // empty path fails synchronously in InProcessPipelineEngine.loadRows
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), expression = "30m")

      await(service.tick())

      val runs = await(runRepo.listByPipelineInternal(pid))
      runs should have size 1
      runs.head.status shouldBe "failed"
      runs.head.errorLog shouldBe defined
      runs.head.errorLog.get should not be empty
      // HEL-417: trigger_source is set at insert time (submit), independent
      // of the terminal outcome.
      runs.head.triggerSource shouldBe "scheduled"

      val updated = await(scheduleRepo.findByPipelineId(pid, user)).get
      updated.lastRunAt shouldBe Some(fakeClock.now())
      updated.nextRunAt shouldBe Some(fakeClock.now().plus(30, ChronoUnit.MINUTES))
    }

    "leave next_run_at untouched and skip firing when a persisted active run blocks the pipeline" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      val due = fakeClock.now().minusSeconds(60)
      seedSchedule(pid, nextRunAt = Some(due), expression = "30m")

      import PostgresProfile.api._
      await(db.run(
        sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, row_count, error_log)
               VALUES (${UUID.randomUUID().toString}, ${pid.value}, 'queued', now(), NULL, NULL, NULL)"""
      ))

      await(service.tick())

      val runs = await(runRepo.listByPipelineInternal(pid))
      runs should have size 1 // the pre-seeded active run only — no new fire

      val updated = await(scheduleRepo.findByPipelineId(pid, user)).get
      updated.nextRunAt shouldBe Some(due) // unchanged — retried next tick
      updated.lastRunAt shouldBe None
    }

    "guard two back-to-back tick() calls against firing the same due pipeline twice (in-memory guard)" in {
      cleanDb(); seedUser()
      val path = s"hang-${UUID.randomUUID()}.csv"
      val pid  = seedCsvPipeline(path)
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), expression = "30m")

      val entry = HangEntry(Promise[Array[Byte]](), Promise[Unit]())
      hangingReads.put(path, entry)

      val f1 = service.tick()
      val f2 = service.tick()

      // Block until whichever call reserved the pipeline reaches the hang
      // point (proves it started firing).
      await(entry.reached.future)

      // The winner cannot possibly have completed yet (still hanging on
      // entry.bytes) — the ONLY future able to complete at this point is
      // the loser's, so this deterministically resolves without a race.
      await(Future.firstCompletedOf(Seq(f1, f2)))
      readCount.get() shouldBe 1 // only the winner ever reached FileSystem.read

      entry.bytes.success("col\n1\n".getBytes(StandardCharsets.UTF_8))
      await(Future.sequence(Seq(f1, f2)))

      readCount.get() shouldBe 1
      val runs = await(runRepo.listByPipelineInternal(pid))
      runs should have size 1
    }
  }
}
