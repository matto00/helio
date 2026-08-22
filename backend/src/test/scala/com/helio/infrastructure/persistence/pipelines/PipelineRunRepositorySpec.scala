package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository
import com.helio.domain.model.{AssertionResult, AuthenticatedUser, DataTypeId, PipelineId, PipelineRunId, UserId}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

class PipelineRunRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres      = _
  private var db: JdbcBackend.Database                = _
  private var pipelineRunRepo: PipelineRunRepository  = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    pipelineRunRepo = new PipelineRunRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val systemUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  private def seedPipeline(): PipelineId = {
    import PostgresProfile.api._
    val ownerId = "00000000-0000-0000-0000-000000000001"
    val dsId    = UUID.randomUUID().toString
    val dtId    = UUID.randomUUID().toString
    val pid     = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources
               (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'static', '{"columns":[],"rows":[]}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types
               (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId, 'dt', '[]', 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, output_data_type_id, created_at, updated_at)
               VALUES ($pid, 'pipe', $dsId, $dtId, now(), now())"""
    )))
    PipelineId(pid)
  }

  /** HEL-576: like `seedPipeline`, but also returns the pipeline's
   *  `output_data_type_id` — `findLatestRunIdByOutputDataTypeIdInternal`
   *  looks up runs by that DataType, not by pipeline id directly. */
  private def seedPipelineWithDataType(): (PipelineId, DataTypeId) = {
    import PostgresProfile.api._
    val ownerId = "00000000-0000-0000-0000-000000000001"
    val dsId    = UUID.randomUUID().toString
    val dtId    = UUID.randomUUID().toString
    val pid     = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources
               (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'static', '{"columns":[],"rows":[]}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types
               (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId, 'dt', '[]', 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, output_data_type_id, created_at, updated_at)
               VALUES ($pid, 'pipe', $dsId, $dtId, now(), now())"""
    )))
    (PipelineId(pid), DataTypeId(dtId))
  }

  "PipelineRunRepository" should {

    "insertRun creates a run with queued status" in {
      val pid    = seedPipeline()
      val runId  = PipelineRunId(UUID.randomUUID().toString)
      val now    = Instant.now()
      await(pipelineRunRepo.insertRun(runId, pid, now, systemUser))

      val runs = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      runs should have size 1
      runs.head.id        shouldBe runId.value
      runs.head.pipelineId shouldBe pid.value
      runs.head.status     shouldBe "queued"
      runs.head.completedAt shouldBe None
      runs.head.rowCount    shouldBe None
      runs.head.errorLog    shouldBe None
      runs.head.triggerSource shouldBe "manual"
    }

    // ── HEL-417: trigger_source persistence ─────────────────────────────────

    "insertRun persists the passed triggerSource (scheduled)" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRun(runId, pid, Instant.now(), systemUser, triggerSource = "scheduled"))

      val runs = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      runs.head.triggerSource shouldBe "scheduled"
    }

    "insertRunInternal persists the passed triggerSource (external)" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRunInternal(runId, pid, Instant.now(), triggerSource = "external"))

      val runs = await(pipelineRunRepo.listByPipelineInternal(pid))
      runs.head.triggerSource shouldBe "external"
    }

    "insertDryRun persists triggerSource manual" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertDryRun(runId, pid, Instant.now(), rowCount = 1, systemUser))

      val runs = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      runs.head.triggerSource shouldBe "manual"
    }

    "insertDryRunInternal persists triggerSource manual" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertDryRunInternal(runId, pid, Instant.now(), rowCount = 1))

      val runs = await(pipelineRunRepo.listByPipelineInternal(pid))
      runs.head.triggerSource shouldBe "manual"
    }

    "updateRunTerminal sets succeeded status with rowCount" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      val start = Instant.now()
      await(pipelineRunRepo.insertRun(runId, pid, start, systemUser))

      val end = Instant.now()
      await(pipelineRunRepo.updateRunTerminal(runId, "succeeded", end, rowCount = Some(42), errorLog = None, systemUser))

      val runs = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      runs.head.status      shouldBe "succeeded"
      runs.head.completedAt shouldBe defined
      runs.head.rowCount    shouldBe Some(42)
      runs.head.errorLog    shouldBe None
    }

    "updateRunTerminal sets failed status with errorLog" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      val start = Instant.now()
      await(pipelineRunRepo.insertRun(runId, pid, start, systemUser))

      val end = Instant.now()
      await(pipelineRunRepo.updateRunTerminal(runId, "failed", end, rowCount = None, errorLog = Some("boom"), systemUser))

      val runs = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      runs.head.status   shouldBe "failed"
      runs.head.errorLog shouldBe Some("boom")
      runs.head.rowCount shouldBe None
    }

    "deleteOldRuns retains only the N most recent runs" in {
      val pid = seedPipeline()
      // Insert 12 runs
      val base = Instant.now()
      for (i <- 1 to 12) {
        val runId = PipelineRunId(UUID.randomUUID().toString)
        await(pipelineRunRepo.insertRun(runId, pid, base.plusSeconds(i.toLong), systemUser))
      }

      val before = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      before should have size 12

      await(pipelineRunRepo.deleteOldRuns(pid, systemUser, keepN = 10))

      val after = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      after should have size 10
      // The most recent 10 should be kept (highest startedAt); after is ordered DESC
      // The first element should have the latest startedAt (base + 12s)
      // Compare epoch seconds to avoid nanosecond precision mismatch with DB
      after.head.startedAt.getEpochSecond shouldBe base.plusSeconds(12).getEpochSecond
    }

    "listByPipeline returns runs ordered by startedAt DESC" in {
      val pid = seedPipeline()
      val base = Instant.now()
      val ids = (1 to 3).map { i =>
        val runId = PipelineRunId(UUID.randomUUID().toString)
        await(pipelineRunRepo.insertRun(runId, pid, base.plusSeconds(i.toLong), systemUser))
        runId.value
      }

      val runs = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      runs should have size 3
      // Most recent first
      runs.head.startedAt.isAfter(runs(1).startedAt) shouldBe true
      runs(1).startedAt.isAfter(runs(2).startedAt)   shouldBe true
      // Corresponds to ids(2), ids(1), ids(0)
      runs.map(_.id) shouldBe Seq(ids(2), ids(1), ids(0))
    }

    "listByPipeline returns empty for a pipeline with no runs" in {
      val pid  = seedPipeline()
      val runs = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      runs shouldBe empty
    }

    "insertDryRun inserts a row with status dry_run and non-null completedAt" in {
      val pid    = seedPipeline()
      val runId  = PipelineRunId(UUID.randomUUID().toString)
      val now    = Instant.now()
      await(pipelineRunRepo.insertDryRun(runId, pid, now, rowCount = 3, systemUser))

      val runs = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      runs should have size 1
      runs.head.id          shouldBe runId.value
      runs.head.pipelineId  shouldBe pid.value
      runs.head.status      shouldBe "dry_run"
      runs.head.completedAt shouldBe defined
      runs.head.rowCount    shouldBe Some(3)
      runs.head.errorLog    shouldBe None
    }

    "deleteOldDryRuns retains only the N most recent dry-run rows" in {
      val pid  = seedPipeline()
      val base = Instant.now()
      // Insert 12 dry-run rows
      for (i <- 1 to 12) {
        val runId = PipelineRunId(UUID.randomUUID().toString)
        await(pipelineRunRepo.insertDryRun(runId, pid, base.plusSeconds(i.toLong), rowCount = i, systemUser))
      }

      val before = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      before should have size 12
      before.map(_.status).distinct shouldBe Seq("dry_run")

      await(pipelineRunRepo.deleteOldDryRuns(pid, systemUser, keepN = 10))

      val after = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      after should have size 10
      // Most recent 10 are kept; the first (DESC) should be base + 12s
      after.head.startedAt.getEpochSecond shouldBe base.plusSeconds(12).getEpochSecond
      after.map(_.status).distinct shouldBe Seq("dry_run")
    }

    "deleteOldDryRuns does not affect normal run records" in {
      val pid  = seedPipeline()
      val base = Instant.now()
      // Insert 5 normal runs and 12 dry-run rows
      for (i <- 1 to 5) {
        val runId = PipelineRunId(UUID.randomUUID().toString)
        await(pipelineRunRepo.insertRun(runId, pid, base.plusSeconds(i.toLong), systemUser))
      }
      for (i <- 1 to 12) {
        val runId = PipelineRunId(UUID.randomUUID().toString)
        await(pipelineRunRepo.insertDryRun(runId, pid, base.plusSeconds((100 + i).toLong), rowCount = i, systemUser))
      }

      await(pipelineRunRepo.deleteOldDryRuns(pid, systemUser, keepN = 10))

      val after = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      // 5 normal + 10 dry-run = 15 total
      after should have size 15
      after.count(_.status == "dry_run") shouldBe 10
      after.count(_.status != "dry_run") shouldBe 5
    }

    // ── HEL-265 CS2: cross-user ACL enforcement (JOIN to pipelines.owner_id) ──

    val otherUser = AuthenticatedUser(UserId(UUID.randomUUID().toString))

    "listByPipeline returns empty vector for a non-owner (CS2)" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRun(runId, pid, Instant.now(), systemUser))
      await(pipelineRunRepo.listByPipeline(pid, systemUser)) should have size 1
      await(pipelineRunRepo.listByPipeline(pid, otherUser))  shouldBe empty
    }

    "insertRun is a silent no-op for a non-owner (CS2)" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRun(runId, pid, Instant.now(), otherUser))
      await(pipelineRunRepo.listByPipeline(pid, systemUser)) shouldBe empty
    }

    "insertDryRun is a silent no-op for a non-owner (CS2)" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertDryRun(runId, pid, Instant.now(), rowCount = 5, otherUser))
      await(pipelineRunRepo.listByPipeline(pid, systemUser)) shouldBe empty
    }

    "updateRunTerminal is a silent no-op for a non-owner (CS2)" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRun(runId, pid, Instant.now(), systemUser))
      await(pipelineRunRepo.updateRunTerminal(
        runId, "succeeded", Instant.now(), rowCount = Some(42), errorLog = None, otherUser
      ))
      // Owner's view still shows queued — the cross-user write was rejected.
      val runs = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      runs.head.status shouldBe "queued"
    }

    "deleteOldRuns is a silent no-op for a non-owner (CS2)" in {
      val pid = seedPipeline()
      for (i <- 1 to 12) {
        val runId = PipelineRunId(UUID.randomUUID().toString)
        await(pipelineRunRepo.insertRun(runId, pid, Instant.now().plusMillis(i.toLong), systemUser))
      }
      await(pipelineRunRepo.deleteOldRuns(pid, otherUser, keepN = 5))
      // All 12 still present — the cross-user deletion was rejected.
      await(pipelineRunRepo.listByPipeline(pid, systemUser)) should have size 12
    }

    "deleteOldRuns does not affect dry-run records" in {
      val pid  = seedPipeline()
      val base = Instant.now()
      // Insert 12 normal runs and 5 dry-run rows
      for (i <- 1 to 12) {
        val runId = PipelineRunId(UUID.randomUUID().toString)
        await(pipelineRunRepo.insertRun(runId, pid, base.plusSeconds(i.toLong), systemUser))
      }
      for (i <- 1 to 5) {
        val runId = PipelineRunId(UUID.randomUUID().toString)
        await(pipelineRunRepo.insertDryRun(runId, pid, base.plusSeconds((100 + i).toLong), rowCount = i, systemUser))
      }

      await(pipelineRunRepo.deleteOldRuns(pid, systemUser, keepN = 10))

      val after = await(pipelineRunRepo.listByPipeline(pid, systemUser))
      // 10 normal + 5 dry-run = 15 total
      after should have size 15
      after.count(_.status == "dry_run") shouldBe 5
      after.count(_.status != "dry_run") shouldBe 10
    }

    // ── HEL-509 (419-B): pipeline_run_assertions ────────────────────────────

    def sampleResults(): Vector[AssertionResult] = Vector(
      AssertionResult("step-1", "notNull", Some("email"), "error", passed = true, observed = Some("0 nulls"), message = None),
      AssertionResult("step-1", "rowCountMin", None, "warn", passed = false, observed = Some("3 rows"), message = Some("below minimum"))
    )

    "insertAssertions persists one row per AssertionResult, linked to the run" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRun(runId, pid, Instant.now(), systemUser))

      await(pipelineRunRepo.insertAssertions(runId, sampleResults()))

      val rows = await(pipelineRunRepo.listAssertionsByRunInternal(runId))
      rows should have size 2
      rows.map(_.kind) should contain allOf ("notNull", "rowCountMin")
      val notNullRow = rows.find(_.kind == "notNull").get
      notNullRow.runId    shouldBe runId.value
      notNullRow.stepId   shouldBe "step-1"
      notNullRow.field    shouldBe Some("email")
      notNullRow.severity shouldBe "error"
      notNullRow.passed   shouldBe true
      notNullRow.observed shouldBe Some("0 nulls")
      notNullRow.message  shouldBe None
      val rowCountRow = rows.find(_.kind == "rowCountMin").get
      rowCountRow.field   shouldBe None
      rowCountRow.passed  shouldBe false
      rowCountRow.message shouldBe Some("below minimum")
    }

    "insertAssertions is a no-op for an empty results sequence" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRun(runId, pid, Instant.now(), systemUser))

      await(pipelineRunRepo.insertAssertions(runId, Vector.empty))

      await(pipelineRunRepo.listAssertionsByRunInternal(runId)) shouldBe empty
    }

    "listAssertionsByRun (owner-scoped) returns the persisted results for the owning user" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRun(runId, pid, Instant.now(), systemUser))
      await(pipelineRunRepo.insertAssertions(runId, sampleResults()))

      val rows = await(pipelineRunRepo.listAssertionsByRun(runId, systemUser))
      rows should have size 2
    }

    "listAssertionsByRun (owner-scoped) returns empty for a non-owner (CS2 parity)" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRun(runId, pid, Instant.now(), systemUser))
      await(pipelineRunRepo.insertAssertions(runId, sampleResults()))

      await(pipelineRunRepo.listAssertionsByRun(runId, otherUser)) shouldBe empty
      // Owner's view is unaffected by the non-owner's read attempt.
      await(pipelineRunRepo.listAssertionsByRun(runId, systemUser)) should have size 2
    }

    "listAssertionsByRunInternal (system-context) returns results regardless of caller identity" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRun(runId, pid, Instant.now(), systemUser))
      await(pipelineRunRepo.insertAssertions(runId, sampleResults()))

      await(pipelineRunRepo.listAssertionsByRunInternal(runId)) should have size 2
    }

    "listAssertionsByRunInternal returns empty for a run with no assertion results" in {
      val pid   = seedPipeline()
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRun(runId, pid, Instant.now(), systemUser))

      await(pipelineRunRepo.listAssertionsByRunInternal(runId)) shouldBe empty
    }

    // ── HEL-576: findLatestRunIdByOutputDataTypeIdInternal ─────────────────

    "findLatestRunIdByOutputDataTypeIdInternal returns None when the pipeline has never had a non-dry run" in {
      val (_, dtId) = seedPipelineWithDataType()
      await(pipelineRunRepo.findLatestRunIdByOutputDataTypeIdInternal(dtId)) shouldBe None
    }

    "findLatestRunIdByOutputDataTypeIdInternal returns the most recent NON-DRY run id" in {
      val (pid, dtId) = seedPipelineWithDataType()
      val base    = Instant.now()
      val earlier = PipelineRunId(UUID.randomUUID().toString)
      val latest  = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRunInternal(earlier, pid, base))
      await(pipelineRunRepo.insertRunInternal(latest, pid, base.plusSeconds(10)))

      await(pipelineRunRepo.findLatestRunIdByOutputDataTypeIdInternal(dtId)) shouldBe Some(latest)
    }

    // Dedicated case (design gate round 1): a dry run more recent than the
    // last real run must never be mistaken for the "latest run".
    "findLatestRunIdByOutputDataTypeIdInternal excludes a dry run more recent than the last real run" in {
      val (pid, dtId) = seedPipelineWithDataType()
      val base    = Instant.now()
      val realRun = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRunInternal(realRun, pid, base))

      val dryRun = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertDryRunInternal(dryRun, pid, base.plusSeconds(60), rowCount = 3))

      await(pipelineRunRepo.findLatestRunIdByOutputDataTypeIdInternal(dtId)) shouldBe Some(realRun)
    }

    "findLatestRunIdByOutputDataTypeIdInternal returns None when the pipeline has only dry runs" in {
      val (pid, dtId) = seedPipelineWithDataType()
      val dryRun = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertDryRunInternal(dryRun, pid, Instant.now(), rowCount = 3))

      await(pipelineRunRepo.findLatestRunIdByOutputDataTypeIdInternal(dtId)) shouldBe None
    }
  }
}
