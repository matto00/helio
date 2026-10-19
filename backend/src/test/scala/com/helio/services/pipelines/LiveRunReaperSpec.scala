package com.helio.services.pipelines

import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, NodeKey, PipelineExecutionBackend, PipelineExecutionOutcome}
import com.helio.domain.model._
import com.helio.domain.steps.{AssertConfig, AssertRule, UpsertMode, UpsertSourceConfig, UpsertTarget}
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import com.helio.testkit.VerifiedEmbeddedPostgres
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json.{JsNumber, JsObject}

import java.nio.file.Paths
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future, Promise}

/** HEL-1511 -- a REAL [[PipelineRunService]] run (the in-process engine behind a gate) against the orphaned-run reaper.
 *
 *  - 4.2: a live run, however long, is never reaped while the heartbeat keeps stamping it, and completes with its real
 *    outcome. The clock starts at real now (so `started_at`/`heartbeat_at` and the reaper's `now` share one timeline)
 *    and is advanced past ten times the stale bound, stamping between ticks.
 *  - 4.4: a run reaped while its instance stalled is a late finisher; its real outcome (write-back, snapshots, history,
 *    last-run) is dropped whole. The positive control is the same fixture, not reaped.
 *  No sleeps: the gate is a Promise, time is the injected clock. */
class LiveRunReaperSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var runRepo: PipelineRunRepository     = _
  private var service: PipelineRunService        = _
  private var scheduler: PipelineSchedulerService = _
  private var heartbeat: RunHeartbeatService     = _
  private var stepRepo: PipelineStepRepository   = _
  private var outputRepo: OutputRepository       = _

  private class FakeClock(@volatile private var instant: Instant) extends Clock {
    def set(i: Instant): Unit   = instant = i
    override def now(): Instant = instant
  }
  private val clock = new FakeClock(Instant.now().truncatedTo(ChronoUnit.MILLIS))

  /** One gate per case; the backend blocks every `execute` on it, then delegates to the real engine. */
  @volatile private var entered: Promise[Unit] = Promise[Unit]()
  @volatile private var gate: Promise[Unit]    = Promise[Unit]()

  private final class GatingBackend(delegate: PipelineExecutionBackend) extends PipelineExecutionBackend {
    override def supportsWriteBack: Boolean = delegate.supportsWriteBack
    override def execute(
        pipeline: Pipeline, roots: Vector[(String, DataSource)], steps: Vector[PipelineStep], dataSourceRepo: DataSourceRepository,
        assertionSink: AssertionSink, truncationSink: TruncationSink, retain: Set[NodeKey], onNodeProgress: (NodeKey, Long) => Unit = (_, _) => (),
        writeBackSink: WriteBackSink = new WriteBackSink, ownerUserId: Option[String] = None
    )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] = {
      entered.trySuccess(())
      gate.future.flatMap(_ => delegate.execute(pipeline, roots, steps, dataSourceRepo, assertionSink, truncationSink, retain, onNodeProgress, writeBackSink, ownerUserId))
    }
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)
    val dataSourceRepo = new DataSourceRepository(ctx)
    stepRepo   = new PipelineStepRepository(ctx)
    outputRepo = new OutputRepository(ctx)
    val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)
    runRepo = new PipelineRunRepository(ctx)
    val fs   = new LocalFileSystem(Paths.get("/"))
    val real = new InProcessExecutionBackend(new InProcessPipelineEngine(fs), stepRepo)
    service = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, runRepo, new PipelineRunCache(), registry = null, fs,
      executionBackend = new GatingBackend(real),
      outputRepo = outputRepo, nodeSnapshotRepo = new NodeSnapshotRepository(ctx), outputHistoryRepo = new OutputHistoryRepository(ctx),
      guardConfig = PipelineRunGuardConfig(rateLimitPerWindow = 1000, rateWindowSeconds = 60, maxConcurrent = 1000, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30)
    )
    heartbeat = new RunHeartbeatService(service.liveRunTracker, runRepo)
    scheduler = new PipelineSchedulerService(new PipelineScheduleRepository(ctx), pipelineRepo, stepRepo, runRepo, service, clock)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  private val bound = PipelineRunGuardConfig.DefaultStaleRunAfterSeconds

  private final case class Fx(owner: AuthenticatedUser, pid: PipelineId, targetId: Option[String])

  private def seed(withWriteBack: Boolean, blockingAssert: Boolean = false): Fx = {
    import PostgresProfile.api._
    val owner = AuthenticatedUser(UserId(UUID.randomUUID().toString))
    val dsId  = UUID.randomUUID().toString
    val pid   = UUID.randomUUID().toString
    val payload = """{"columns":[{"name":"name","type":"string"}],"rows":[["alice"],["bob"]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${owner.id.value}::uuid, ${s"${owner.id.value}@test.local"}, now())""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', ${owner.id.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload),
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', ${owner.id.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    // Bound to the root: node snapshots and history are only written for Output-bound nodes.
    await(outputRepo.insertInternal(PipelineId(pid), None, owner.id, "root-out", OutputKind.Table, explicitRootId = Some(PipelineRootId(pid))))
    if (blockingAssert)
      await(stepRepo.insertInternal(PipelineId(pid), "assert", AssertConfig(Vector(AssertRule("rowCountMax", None, JsObject("count" -> JsNumber(1)), "error"))),
        enabled = true, None, explicitRootId = None))
    val target =
      if (!withWriteBack) None
      else {
        val targetId = UUID.randomUUID().toString
        await(db.run(DBIO.seq(
          sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                 VALUES ($targetId, 'ds-target', 'dataset', '{}', ${owner.id.value}::uuid, now(), now())""",
          DatasetRowsTestSupport.seedActionsFromRaw(targetId, """{"columns":[{"name":"name","type":"string"}],"rows":[]}""")
        )))
        await(stepRepo.insertInternal(PipelineId(pid), "upsertsource", UpsertSourceConfig(UpsertTarget.ExistingSource(targetId), UpsertMode.Append),
          enabled = true, None, explicitRootId = None, actingUserId = owner.id.value))
        Some(targetId)
      }
    Fx(owner, PipelineId(pid), target)
  }

  private def newGate(): Unit = { entered = Promise[Unit](); gate = Promise[Unit]() }

  private def scalar(sql: String): String = {
    val c = embeddedPostgres.getPostgresDatabase.getConnection
    try { val rs = c.createStatement().executeQuery(sql); rs.next(); rs.getString(1) } finally c.close()
  }
  private def runStatus(pid: PipelineId): String =
    scalar(s"SELECT status FROM pipeline_runs WHERE pipeline_id = '${pid.value}'")
  private def count(table: String, col: String, id: String): Int =
    scalar(s"SELECT count(*) FROM $table WHERE $col = '$id'").toInt

  "a live long run (HEL-1511 4.2)" should {

    "never be reaped while the heartbeat stamps it, and complete with its real outcome" in {
      val fx = seed(withWriteBack = false)
      newGate()
      val base = Instant.now().truncatedTo(ChronoUnit.MILLIS)
      clock.set(base)
      val submitted = service.submit(fx.pid, isDry = false, fx.owner)
      await(entered.future)
      runStatus(fx.pid) shouldBe "queued"

      // Ten times the stale bound, in 300 s steps (< the bound), stamping between ticks.
      val steps = (10 * bound / 300).toInt + 1
      for (i <- 1 to steps) {
        clock.set(base.plusSeconds(300L * i))
        await(heartbeat.stampOnce(clock.now())) shouldBe 1
        await(scheduler.tick())
        withClue(s"after ${300 * i} s of simulated run time: ") { runStatus(fx.pid) shouldBe "queued" }
      }

      gate.success(())
      await(submitted).isRight shouldBe true
      runStatus(fx.pid) shouldBe "succeeded"
      service.liveRunTracker.snapshot() shouldBe empty
    }
  }

  "a run reaped while its instance stalled (HEL-1511 4.4)" should {

    "stay failed and write no snapshot, history or write-back row when it finally finishes" in {
      val fx = seed(withWriteBack = true)
      newGate()
      clock.set(Instant.now().truncatedTo(ChronoUnit.MILLIS))
      val submitted = service.submit(fx.pid, isDry = false, fx.owner)
      await(entered.future)

      // No stamps: more than the bound later the tick reaps it.
      clock.set(clock.now().plusSeconds(bound + 60))
      await(scheduler.tick())
      runStatus(fx.pid) shouldBe "failed"
      scalar(s"SELECT last_run_status FROM pipelines WHERE id = '${fx.pid.value}'") shouldBe "failed"

      gate.success(())
      await(submitted).isLeft shouldBe true

      runStatus(fx.pid) shouldBe "failed"
      scalar(s"SELECT error_log FROM pipeline_runs WHERE pipeline_id = '${fx.pid.value}'") should include("Run abandoned")
      scalar(s"SELECT last_run_status FROM pipelines WHERE id = '${fx.pid.value}'") shouldBe "failed"
      count("node_snapshots", "pipeline_id", fx.pid.value) shouldBe 0
      count("output_snapshot_history", "pipeline_id", fx.pid.value) shouldBe 0
      count("dataset_rows", "data_source_id", fx.targetId.get) shouldBe 0
      service.liveRunTracker.snapshot() shouldBe empty
    }

    "(positive control) write the snapshot, history and write-back row when it is NOT reaped" in {
      val fx = seed(withWriteBack = true)
      newGate()
      clock.set(Instant.now().truncatedTo(ChronoUnit.MILLIS))
      val submitted = service.submit(fx.pid, isDry = false, fx.owner)
      await(entered.future)
      await(scheduler.tick())
      gate.success(())
      await(submitted).isRight shouldBe true

      runStatus(fx.pid) shouldBe "succeeded"
      count("node_snapshots", "pipeline_id", fx.pid.value) should be > 0
      count("output_snapshot_history", "pipeline_id", fx.pid.value) should be > 0
      count("dataset_rows", "data_source_id", fx.targetId.get) shouldBe 2
    }
  }
  // ── First terminal write wins on the paths that never consult the open-check (design.md D4) ──

  /** Reaps a gated run, then releases the engine through `release`; the late outcome must change nothing. */
  private def lateOutcomeIsDropped(fx: Fx, release: => Unit): Unit = {
    newGate()
    clock.set(Instant.now().truncatedTo(ChronoUnit.MILLIS))
    val submitted = service.submit(fx.pid, isDry = false, fx.owner)
    await(entered.future)
    clock.set(clock.now().plusSeconds(bound + 60))
    await(scheduler.tick())
    val q = s"WHERE pipeline_id = '${fx.pid.value}'"
    val errorBefore = scalar(s"SELECT error_log FROM pipeline_runs $q")
    val lastRunBefore = scalar(s"SELECT last_run_at::text FROM pipelines WHERE id = '${fx.pid.value}'")
    errorBefore should include("Run abandoned")

    release
    await(submitted)

    runStatus(fx.pid) shouldBe "failed"
    scalar(s"SELECT error_log FROM pipeline_runs $q") shouldBe errorBefore
    scalar(s"SELECT last_run_at::text FROM pipelines WHERE id = '${fx.pid.value}'") shouldBe lastRunBefore
    scalar(s"SELECT last_run_status FROM pipelines WHERE id = '${fx.pid.value}'") shouldBe "failed"
    count("pipeline_run_assertions", "run_id", scalar(s"SELECT id FROM pipeline_runs $q")) shouldBe 0
    service.liveRunTracker.snapshot() shouldBe empty
  }

  "a reaped run whose engine then FAILS or is BLOCKED (HEL-1511 3.4)" should {

    "keep the reaper's failed row and last_run_* (failure path)" in {
      lateOutcomeIsDropped(seed(withWriteBack = false), gate.failure(new RuntimeException("boom")))
    }

    "keep the reaper's failed row, last_run_* and write no assertions (blocked path)" in {
      lateOutcomeIsDropped(seed(withWriteBack = false, blockingAssert = true), gate.success(()))
    }
  }
}
