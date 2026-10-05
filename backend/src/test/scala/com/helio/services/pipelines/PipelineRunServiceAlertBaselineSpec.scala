package com.helio.services.pipelines

import com.helio.domain.model._
import com.helio.domain.steps.{AssertConfig, AssertRule}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.alerts.{AlertEventRepository, AlertRuleRepository}
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.alerts.AlertEvaluationService
import com.helio.spark.PipelineRunCache
import com.helio.testsupport.{DatasetRowsTestSupport, OutputHistoryFixtures}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1278 seam check: a real PipelineRunService with the real AlertEvaluationService and history
 *  repository wired, two real runs, one `previous` baseline rule. NOT the exclusion proof -- whether
 *  the current run's history point is visible during evaluation is a race here, so the
 *  deterministic exclusion proof lives in AlertEvaluationServiceSpec. */
class PipelineRunServiceAlertBaselineSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var service: PipelineRunService        = _
  private var stepRepo: PipelineStepRepository   = _
  private var outputRepo: OutputRepository       = _
  private var ruleRepo: AlertRuleRepository      = _
  private var eventRepo: AlertEventRepository    = _

  private val user    = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))
  private val ownerId = user.id.value

  override protected def seedDb: JdbcBackend.Database = db

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)
    val dataSourceRepo = new DataSourceRepository(ctx)
    stepRepo   = new PipelineStepRepository(ctx)
    outputRepo = new OutputRepository(ctx)
    ruleRepo   = new AlertRuleRepository(ctx)
    eventRepo  = new AlertEventRepository(ctx)
    val history = new OutputHistoryRepository(ctx)
    service = new PipelineRunService(
      new PipelineRepository(ctx, dataSourceRepo), stepRepo, dataSourceRepo, new PipelineRunRepository(ctx),
      new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      alertEvaluationService = new AlertEvaluationService(ruleRepo, eventRepo, history),
      outputRepo = outputRepo, nodeSnapshotRepo = new NodeSnapshotRepository(ctx), outputHistoryRepo = history
    )
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  "a `previous` baseline rule on a real pipeline" should {
    "fire on the second real run with run 1's value as the baseline" in {
      import PostgresProfile.api._
      val dsId = UUID.randomUUID().toString
      val pid  = UUID.randomUUID().toString
      awaitDb(db.run(DBIO.seq(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'dataset', '{}', $ownerId::uuid, now(), now())""",
        DatasetRowsTestSupport.seedActionsFromRaw(dsId, """{"columns":[{"name":"amount","type":"string"}],"rows":[["10"],["20"]]}"""),
        sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'p', $ownerId::uuid, now(), now())""",
        sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
      )))
      val pipelineId = PipelineId(pid)
      val step = awaitDb(stepRepo.insertInternal(pipelineId, "assert", AssertConfig(Vector.empty[AssertRule]), enabled = true, None, explicitRootId = None))
      val out  = awaitDb(outputRepo.insertInternal(pipelineId, Some(step.id), user.id, "step-table", OutputKind.Table, explicitRootId = None))
      val now  = Instant.now()
      val rule = awaitDb(ruleRepo.insert(AlertRule(
        id = AlertRuleId(UUID.randomUUID().toString), ownerId = user.id, targetOutputId = out.id, metric = "amount",
        condition = JsObject("baseline" -> JsString("previous"), "mode" -> JsString("abs"), "comparator" -> JsString("gte"), "threshold" -> JsNumber(0)),
        name = "baseline rule", enabled = true, severity = Severity.Warning, createdAt = now, updatedAt = now
      ), user))

      val run1 = awaitDb(service.submit(pipelineId, isDry = false, user)).toOption.get.runId.get
      awaitDb(eventRepo.findActiveByRule(rule.id)) shouldBe None // no prior point: skipped, never fires

      val run2 = awaitDb(service.submit(pipelineId, isDry = false, user)).toOption.get.runId.get
      val ev   = awaitDb(eventRepo.findActiveByRule(rule.id)).get
      ev.pipelineRunId.map(_.toString) should (contain(run2) or be(Some(run2)))
      ev.value shouldBe JsObject("value" -> JsNumber(30), "baseline" -> JsNumber(30), "delta" -> JsNumber(0), "mode" -> JsString("abs"))
      run1 should not be run2
    }
  }
}
