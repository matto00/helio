package com.helio.services.pipelines

import com.helio.domain.model.{PipelineId, PipelineRunId}
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.spark.PipelineRunCache
import com.helio.testsupport.DatasetRowsTestSupport
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile

import java.sql.Timestamp
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/** HEL-1511 -- an orphaned non-terminal run (its process died before any terminal write) used to block its pipeline's
 *  auto-runs and schedules forever and held a slot in the owner's concurrency cap. The scheduler tick now reaps it
 *  first, so the same tick fires what it was blocking. Drives only `tick()` and the injected `Clock`, which starts at
 *  real now so `started_at`/`heartbeat_at` and the reaper's `now` share one timeline. The orphan is inserted by raw SQL
 *  that does not name `heartbeat_at` (a legacy row with no heartbeat, judged by its 2 h old `started_at`). */
class OrphanedRunReaperSpec extends AnyWordSpec with Matchers with PipelineSchedulerServiceFixture {

  private var debounceRepo: PipelineAutoRunDebounceRepository = _
  private var runService: PipelineRunService                   = _
  private var scheduler: PipelineSchedulerService              = _
  private val clock = new FakeClock(Instant.now().truncatedTo(ChronoUnit.MILLIS))

  override def beforeAll(): Unit = {
    super.beforeAll()
    val dataSourceRepo = new DataSourceRepository(historyCtx)
    debounceRepo = new PipelineAutoRunDebounceRepository(historyCtx)
    runService = new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, runRepo, new PipelineRunCache(), registry = null, fakeFileSystem,
      outputRepo = new OutputRepository(historyCtx),
      guardConfig = PipelineRunGuardConfig(
        rateLimitPerWindow = 1000, rateWindowSeconds = 60, maxConcurrent = 3, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30
      )
    )
    scheduler = new PipelineSchedulerService(
      scheduleRepo, pipelineRepo, pipelineStepRepo, runRepo, runService, clock,
      autoRunDebounceRepo = debounceRepo,
      autoRunTriggerService = new AutoRunTriggerService(
        new PipelineRootRepository(historyCtx), pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo
      )
    )
  }

  /** A pipeline over a dataset with rows (an auto-run's fire-time verdict needs a row estimate). */
  private def seedDatasetPipeline(): PipelineId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    val payload = """{"columns":[{"name":"name","type":"string"}],"rows":[["alice"]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', $ownerId::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload),
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES (${UUID.randomUUID().toString}, $pid, $dsId, 0)"""
    )))
    PipelineId(pid)
  }

  private def freshNow(): Instant = {
    val n = Instant.now().truncatedTo(ChronoUnit.MILLIS)
    clock.set(n)
    n
  }

  /** A non-terminal `queued` row, inserted without naming `heartbeat_at`. */
  private def insertOpenRun(pid: PipelineId, startedAt: Instant): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    val ts = Timestamp.from(startedAt)
    await(db.run(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, trigger_source)
                        VALUES ($id, ${pid.value}, 'queued', $ts, NULL, 'manual')"""))
    id
  }

  private def runStatus(runId: String): String = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT status FROM pipeline_runs WHERE id = $runId".as[String].head))
  }

  private def otherRunCount(pid: PipelineId, excluding: String): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM pipeline_runs WHERE pipeline_id = ${pid.value} AND id <> $excluding".as[Int].head))
  }

  "an orphaned run (HEL-1511)" should {

    "no longer block a pending auto-run of its pipeline: the tick reaps it, then fires the auto-run" in {
      cleanDb(); seedUser()
      val pid    = seedDatasetPipeline()
      val now    = freshNow()
      val orphan = insertOpenRun(pid, now.minusSeconds(7200))
      await(debounceRepo.upsertDebounce(pid, now.minusSeconds(1)))

      await(scheduler.tick())

      runStatus(orphan) shouldBe "failed"
      otherRunCount(pid, orphan) shouldBe 1
    }

    "no longer block a due schedule of its pipeline" in {
      cleanDb(); seedUser()
      val pid    = seedStaticPipeline()
      val now    = freshNow()
      val orphan = insertOpenRun(pid, now.minusSeconds(7200))
      seedSchedule(pid, nextRunAt = Some(now.minusSeconds(60)))

      await(scheduler.tick())

      runStatus(orphan) shouldBe "failed"
      otherRunCount(pid, orphan) shouldBe 1
    }

    "stop holding a slot in the owner's concurrency cap, so another pipeline's auto-run fires" in {
      cleanDb(); seedUser()
      val orphanPipe = seedStaticPipeline()
      val otherA     = seedStaticPipeline()
      val otherB     = seedStaticPipeline()
      val target     = seedDatasetPipeline()
      val now        = freshNow()
      val orphan     = insertOpenRun(orphanPipe, now.minusSeconds(7200))
      val liveA      = insertOpenRun(otherA, now)
      val liveB      = insertOpenRun(otherB, now)
      await(debounceRepo.upsertDebounce(target, now.minusSeconds(1)))

      await(scheduler.tick())

      runStatus(orphan) shouldBe "failed"
      runStatus(liveA) shouldBe "queued"
      runStatus(liveB) shouldBe "queued"
      otherRunCount(target, orphan) shouldBe 1
    }
  }
  // ── 4.1: the legacy bound, the heartbeat bound, and what a reaped row records ─────────────────

  private def insertHeartbeatRun(pid: PipelineId, startedAt: Instant, heartbeatAt: Instant): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, trigger_source, heartbeat_at)
                        VALUES ($id, ${pid.value}, 'queued', ${Timestamp.from(startedAt)}, NULL, 'manual', ${Timestamp.from(heartbeatAt)})"""))
    id
  }

  private def runRow(runId: String): (String, Boolean, String, String) = {
    import PostgresProfile.api._
    await(db.run(sql"""SELECT status, completed_at IS NOT NULL, coalesce(error_log, ''), coalesce(truncated_reads::text, '')
                       FROM pipeline_runs WHERE id = $runId""".as[(String, Boolean, String, String)].head))
  }

  private def lastRunStatus(pid: PipelineId): Option[String] = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT last_run_status FROM pipelines WHERE id = ${pid.value}".as[Option[String]].head))
  }

  "the reaper's bounds (HEL-1511 4.1)" should {

    "leave a legacy row with no heartbeat alone at 30 minutes and reap it at 61 minutes" in {
      cleanDb(); seedUser()
      val young = seedStaticPipeline(); val old = seedStaticPipeline()
      val now   = freshNow()
      val a = insertOpenRun(young, now.minus(30, ChronoUnit.MINUTES))
      val b = insertOpenRun(old, now.minus(61, ChronoUnit.MINUTES))

      await(scheduler.tick())

      runStatus(a) shouldBe "queued"
      val (status, completed, errorLog, truncated) = runRow(b)
      status shouldBe "failed"
      completed shouldBe true
      errorLog should (include("Run abandoned") and include("no heartbeat recorded"))
      truncated should include("\"reads\"")
    }

    "reap on a stale heartbeat (not on run age) and name how long it has been silent" in {
      cleanDb(); seedUser()
      val fresh = seedStaticPipeline(); val stale = seedStaticPipeline()
      val now   = freshNow()
      // Both started hours ago: only the heartbeat decides.
      val live = insertHeartbeatRun(fresh, now.minusSeconds(7200), now.minusSeconds(300))
      val dead = insertHeartbeatRun(stale, now.minusSeconds(7200), now.minusSeconds(660))

      await(scheduler.tick())

      runStatus(live) shouldBe "queued"
      val (status, _, errorLog, _) = runRow(dead)
      status shouldBe "failed"
      errorLog shouldBe "Run abandoned: no heartbeat for 660 s (the server running it likely stopped)"
    }

    "mark the pipeline's last run failed only when the reaped run is its latest real run" in {
      import PostgresProfile.api._
      cleanDb(); seedUser()
      val latest = seedStaticPipeline(); val superseded = seedStaticPipeline()
      val now    = freshNow()
      insertOpenRun(latest, now.minusSeconds(7200))
      insertOpenRun(superseded, now.minusSeconds(7200))
      // A newer, finished run exists on `superseded`; its pipeline already says succeeded.
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, trigger_source)
               VALUES (${UUID.randomUUID().toString}, ${superseded.value}, 'succeeded', ${Timestamp.from(now.minusSeconds(3600))},
                       ${Timestamp.from(now.minusSeconds(3500))}, 'manual')""",
        sqlu"UPDATE pipelines SET last_run_status = 'succeeded' WHERE id = ${superseded.value}"
      )))

      await(scheduler.tick())

      lastRunStatus(latest) shouldBe Some("failed")
      lastRunStatus(superseded) shouldBe Some("succeeded")
    }
  }
  // ── 3.4: the terminal update is conditional (first terminal write wins) ───────────────────────

  "the conditional terminal update (HEL-1511 3.4)" should {

    "not overwrite a reaped run, from either entry point, and report false" in {
      cleanDb(); seedUser()
      val pid    = seedStaticPipeline()
      val now    = freshNow()
      val orphan = insertOpenRun(pid, now.minusSeconds(7200))
      await(runRepo.reapStaleRunsInternal(now, 600L, 3600L, PipelineRunService.EmptyTruncationJson)).map(_.runId.value) shouldBe Vector(orphan)
      val before = runRow(orphan)

      val json = Some(PipelineRunService.EmptyTruncationJson)
      await(runRepo.updateRunTerminalInternal(PipelineRunId(orphan), "succeeded", now.plusSeconds(5), Some(3), None, json)) shouldBe false
      await(runRepo.updateRunTerminal(PipelineRunId(orphan), "succeeded", now.plusSeconds(5), Some(3), None, user, json)) shouldBe false
      runRow(orphan) shouldBe before
      runStatus(orphan) shouldBe "failed"
    }

    "finalize an open run exactly once (control)" in {
      cleanDb(); seedUser()
      val pid  = seedStaticPipeline()
      val now  = freshNow()
      val open = insertOpenRun(pid, now)
      val json = Some(PipelineRunService.EmptyTruncationJson)
      await(runRepo.updateRunTerminal(PipelineRunId(open), "succeeded", now, Some(1), None, user, json)) shouldBe true
      await(runRepo.updateRunTerminalInternal(PipelineRunId(open), "failed", now, None, Some("late"), json)) shouldBe false
      runStatus(open) shouldBe "succeeded"
    }
  }
}
