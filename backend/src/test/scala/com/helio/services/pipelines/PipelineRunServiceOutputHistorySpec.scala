package com.helio.services.pipelines

import com.helio.domain.model._
import com.helio.domain.steps.{AssertConfig, AssertRule, ComputeConfig, UpsertSourceConfig, UpsertTarget}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import com.helio.testsupport.{DatasetRowsTestSupport, OutputHistoryFixtures}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api.DBIO
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.util.UUID
import scala.concurrent.ExecutionContext
import scala.util.Try

/** HEL-1271 D5/D9: history is written by real, unblocked, successful runs only, in the node's own
 *  transaction. Each exclusion is a structural property (the path never reaches the history
 *  write); every test here was shown red by a mutation that leaks history onto that path. */
class PipelineRunServiceOutputHistorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var stepRepo: PipelineStepRepository   = _
  private var outputRepo: OutputRepository       = _
  private var snapshots: NodeSnapshotRepository  = _
  private var history: OutputHistoryRepository   = _
  private var runRepo: PipelineRunRepository     = _
  private var dataSourceRepo: DataSourceRepository = _
  private var pipelineRepo: PipelineRepository   = _
  private var service: PipelineRunService        = _

  private val user    = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))
  private val ownerId = user.id.value

  override protected def seedDb: JdbcBackend.Database = db

  private def buildService(historyRepo: OutputHistoryRepository): PipelineRunService =
    new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, runRepo, new PipelineRunCache(), registry = null,
      new LocalFileSystem(Paths.get("/")), outputRepo = outputRepo, nodeSnapshotRepo = snapshots, outputHistoryRepo = historyRepo
    )

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx            = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    stepRepo       = new PipelineStepRepository(ctx)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
    runRepo        = new PipelineRunRepository(ctx)
    outputRepo     = new OutputRepository(ctx)
    snapshots      = new NodeSnapshotRepository(ctx)
    history        = new OutputHistoryRepository(ctx)
    service        = buildService(history)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  // ── Fixtures ─────────────────────────────────────────────────────────────

  /** A pipeline over a two-row dataset (`amount` = "10", "20"), an assert step carrying `rules`,
   *  a root-bound metric Output summing `amount`, and a table Output on the assert step. */
  private final case class Fx(pid: PipelineId, rootOutput: String, stepOutput: String, assertStepId: String)

  private def seedPipeline(rules: Vector[AssertRule] = Vector.empty, withOutputs: Boolean = true): Fx = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    val payload = """{"columns":[{"name":"amount","type":"string"}],"rows":[["10"],["20"]]}"""
    awaitDb(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', $ownerId::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload),
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'p', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    val pipelineId = PipelineId(pid)
    val step = awaitDb(stepRepo.insertInternal(pipelineId, "assert", AssertConfig(rules), enabled = true, None, explicitRootId = None))
    if (!withOutputs) Fx(pipelineId, "", "", step.id.value)
    else {
      val cfg = """{"fieldMapping":{"value":"amount"},"aggregation":{"value":"amount","agg":"sum"}}""".parseJson.asJsObject
      val rootOut = awaitDb(outputRepo.insertInternal(pipelineId, None, user.id, "root-metric", OutputKind.Metric, cfg, explicitRootId = Some(PipelineRootId(pid))))
      val stepOut = awaitDb(outputRepo.insertInternal(pipelineId, Some(step.id), user.id, "step-table", OutputKind.Table, explicitRootId = None))
      Fx(pipelineId, rootOut.id.value, stepOut.id.value, step.id.value)
    }
  }

  private def points(outputId: String) = awaitDb(history.listRecent(outputId, 50))

  private def totalHistory(fx: Fx): Int = historyCount(fx.rootOutput) + historyCount(fx.stepOutput)

  private def snapshotCount(fx: Fx): Int = {
    import PostgresProfile.api._
    awaitDb(db.run(sql"SELECT count(*) FROM node_snapshots WHERE pipeline_id = ${fx.pid.value}".as[Int].head))
  }

  private val FailingRule = AssertRule("rowCountMin", None, JsObject("count" -> JsNumber(100)), "error")

  // ── Tests ────────────────────────────────────────────────────────────────

  "a real, unblocked, successful run" should {

    "record one history point per Output on each materialized node, with run id, trigger source and summary" in {
      val fx = seedPipeline()
      val r1 = awaitDb(service.submit(fx.pid, isDry = false, user, TriggerSource.Manual))
      val r2 = awaitDb(service.submit(fx.pid, isDry = false, user, TriggerSource.Scheduled))
      val runIds = Seq(r1, r2).map(_.toOption.get.runId.get)

      for (out <- Seq(fx.rootOutput, fx.stepOutput)) {
        val pts = points(out)
        pts should have size 2
        pts.flatMap(_.runId).toSet shouldBe runIds.toSet
        pts.map(_.triggerSource).toSet shouldBe Set("manual", "scheduled")
        pts.foreach(_.rowCount shouldBe 2)
      }
      val metric = points(fx.rootOutput).head.summary.fields("metric").asJsObject
      metric.fields("value") shouldBe JsNumber(30)
      points(fx.stepOutput).head.summary.fields("columns").asJsObject.fields("amount").asJsObject.fields("sum") shouldBe JsNumber(30)
    }

    "write nothing for a pipeline with no Outputs" in {
      val fx = seedPipeline(withOutputs = false)
      awaitDb(service.submit(fx.pid, isDry = false, user)) shouldBe a[Right[_, _]]
      snapshotCount(fx) shouldBe 0
    }
  }

  "runs that must not record history" should {

    "write none for a dry run" in {
      val fx = seedPipeline()
      awaitDb(service.submit(fx.pid, isDry = true, user)) shouldBe a[Right[_, _]]
      totalHistory(fx) shouldBe 0
    }

    "write none for a blocked run (error-severity assertion fails), and leave no snapshot" in {
      val fx     = seedPipeline(rules = Vector(FailingRule))
      val result = awaitDb(service.submit(fx.pid, isDry = false, user))
      result.toOption.get.blocked shouldBe true
      totalHistory(fx) shouldBe 0
      snapshotCount(fx) shouldBe 0
    }

    "write none for a failed run" in {
      val fx = seedPipeline()
      awaitDb(stepRepo.insertInternal(fx.pid, "compute", ComputeConfig("bad", "stats.adp_ppr - stats.pts_ppr", None), enabled = true, Some(PipelineStepId(fx.assertStepId)), explicitRootId = None))
      awaitDb(service.submit(fx.pid, isDry = false, user)) shouldBe a[Left[_, _]]
      totalHistory(fx) shouldBe 0
    }

    "write none for a write-back failure" in {
      import PostgresProfile.api._
      val fx       = seedPipeline()
      val targetId = UUID.randomUUID().toString
      // The target declares no columns, so the source's `amount` column is undeclared and the write-back fails.
      awaitDb(db.run(DBIO.seq(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($targetId, 'target', 'dataset', '{}', $ownerId::uuid, now(), now())""",
        DatasetRowsTestSupport.seedActionsFromRaw(targetId, """{"columns":[],"rows":[]}""")
      )))
      awaitDb(stepRepo.insertInternal(fx.pid, "upsertsource", UpsertSourceConfig(UpsertTarget.ExistingSource(targetId), "append"), enabled = true, Some(PipelineStepId(fx.assertStepId)), explicitRootId = None, actingUserId = ownerId))
      awaitDb(service.submit(fx.pid, isDry = false, user)) shouldBe a[Left[_, _]]
      totalHistory(fx) shouldBe 0
    }

    "write none for the Output backfill that materializes a newly bound node" in {
      val fx = seedPipeline(withOutputs = false)
      awaitDb(service.submit(fx.pid, isDry = false, user)) shouldBe a[Right[_, _]] // a prior success, which backfill requires
      val out = awaitDb(outputRepo.insertInternal(fx.pid, Some(PipelineStepId(fx.assertStepId)), user.id, "late", OutputKind.Table, explicitRootId = None))
      snapshotCount(fx) shouldBe 0
      awaitDb(service.backfillOutputNode(fx.pid, Some(PipelineStepId(fx.assertStepId)), user, None))
      snapshotCount(fx) shouldBe 2
      historyCount(out.id.value) shouldBe 0
    }
  }

  "a failing history insert" should {

    "roll back the node's snapshot replace and fail the run" in {
      val fx = seedPipeline()
      val sentinel = Vector(JsObject("amount" -> JsString("999")))
      // Nodes are written one transaction each in no guaranteed order, so BOTH carry a sentinel: the
      // first node's replace is the one a split transaction would leak before the run aborts.
      awaitDb(snapshots.overwriteRows(fx.pid.value, Some(fx.assertStepId), sentinel, None))
      awaitDb(snapshots.overwriteRows(fx.pid.value, None, sentinel, Some(fx.pid.value)))
      val failing = new OutputHistoryRepository(ctx) {
        override def insertAction(entries: Seq[OutputHistoryInsert]): DBIO[Unit] =
          DBIO.failed(new IllegalStateException("history insert failed"))
      }
      val outcome = Try(awaitDb(buildService(failing).submit(fx.pid, isDry = false, user)))
      outcome.isFailure || outcome.get.isLeft shouldBe true
      awaitDb(snapshots.listRows(fx.pid.value, Some(fx.assertStepId), explicitRootId = None)) shouldBe sentinel
      awaitDb(snapshots.listRows(fx.pid.value, None, explicitRootId = Some(fx.pid.value))) shouldBe sentinel
      totalHistory(fx) shouldBe 0
    }
  }
}
