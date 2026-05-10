package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{ErrorResponse, JsonProtocols, PipelineRunRecord, RunResultResponse, RunStatusResponse, RunSubmitResponse}
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.spark.{PipelineRunCache, RunStatus, SparkJobSubmitter}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

class PipelineRunRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres      = _
  private var db: JdbcBackend.Database                = _
  private var pipelineRepo: PipelineRepository        = _
  private var stepRepo: PipelineStepRepository        = _
  private var dataSourceRepo: DataSourceRepository    = _
  private var pipelineRunRepo: PipelineRunRepository  = _

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db           = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val dataTypeRepo = new DataTypeRepository(db)(routeEc)
    dataSourceRepo   = new DataSourceRepository(db)(routeEc)
    stepRepo         = new PipelineStepRepository(db)(routeEc)
    pipelineRepo     = new PipelineRepository(db, dataTypeRepo, dataSourceRepo)(routeEc)
    pipelineRunRepo  = new PipelineRunRepository(db)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)
  // ---------------------------------------------------------------------------
  // DB helpers
  // ---------------------------------------------------------------------------

  private def seedDsWithData(): String = {
    import PostgresProfile.api._
    val dsId = java.util.UUID.randomUUID().toString
    val dsConfig = """{"columns":[{"name":"name","type":"string"},{"name":"score","type":"double"}],"rows":[["alice",42.0],["bob",37.0]]}"""
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'ds-with-data', 'static', $dsConfig,
        '00000000-0000-0000-0000-000000000001', now(), now())"""))
    dsId
  }

  private def seedDs(sourceType: String): String = {
    import PostgresProfile.api._
    val dsId = java.util.UUID.randomUUID().toString
    val dsConfig = if (sourceType == "static") """{"columns":[],"rows":[]}"""
                   else if (sourceType == "csv") """{"filePath":"/tmp/test.csv"}"""
                   else "{}"
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'ds', $sourceType, $dsConfig,
        '00000000-0000-0000-0000-000000000001', now(), now())"""))
    dsId
  }

  private def seedPipeline(dsId: String): String = {
    import PostgresProfile.api._
    val pid  = java.util.UUID.randomUUID().toString
    val dtId = java.util.UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId, 'dt', '[]', 1, '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, output_data_type_id, created_at, updated_at)
               VALUES ($pid, 'pipe', $dsId, $dtId, now(), now())"""
    )))
    pid
  }

  // ---------------------------------------------------------------------------
  // Stub SparkJobSubmitter that stores queued in cache without touching Spark
  // ---------------------------------------------------------------------------

  private class StubSparkJobSubmitter()(implicit stubEc: ExecutionContext)
      extends SparkJobSubmitter("local", null, null) {
    override def submit(
        pipeline: Pipeline,
        dataSource: DataSource,
        steps: Seq[com.helio.infrastructure.PipelineStepRepository.PipelineStepRow],
        cache: PipelineRunCache
    ): Future[String] = {
      val runId = java.util.UUID.randomUUID().toString
      cache.put(runId, RunStatus.Queued)
      Future.successful(runId)
    }
  }

  private def makeRoutes(cache: PipelineRunCache, runRepo: PipelineRunRepository = null, dtRepo: DataTypeRepository = null): Route = {
    implicit val ec: ExecutionContext = routeEc
    val submitter = new StubSparkJobSubmitter()
    new PipelineRunRoutes(pipelineRepo, stepRepo, dataSourceRepo, submitter, cache, dummyUser, runRepo, dtRepo).routes
  }

  "PipelineRunRoutes" should {

    "POST /pipelines/:id/run returns 200 with inline rows for a static pipeline" in {
      val cache  = new PipelineRunCache()
      val dsId   = seedDs("static")
      val pid    = seedPipeline(dsId)
      Post(s"/pipelines/$pid/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 0
      }
    }

    "POST /pipelines/:id/run returns 404 for unknown pipeline" in {
      val cache = new PipelineRunCache()
      Post("/pipelines/nonexistent/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "POST /pipelines/:id/run returns 422 for rest_api source type" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDs("rest_api")
      val pid   = seedPipeline(dsId)
      Post(s"/pipelines/$pid/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "POST /pipelines/:id/run returns 422 for sql source type" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDs("sql")
      val pid   = seedPipeline(dsId)
      Post(s"/pipelines/$pid/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "GET /pipelines/:id/runs/:runId returns 200 with queued status" in {
      val cache  = new PipelineRunCache()
      val runId  = "test-run-123"
      cache.put(runId, RunStatus.Queued)
      Get(s"/pipelines/any/runs/$runId") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunStatusResponse]
        resp.runId  shouldBe runId
        resp.status shouldBe RunStatus.Queued
        resp.rows   shouldBe None
        resp.error  shouldBe None
      }
    }

    "GET /pipelines/:id/runs/:runId returns 200 with rows when succeeded" in {
      val cache = new PipelineRunCache()
      val runId = "test-run-456"
      cache.update(runId, RunStatus.Succeeded, rows = Some(Seq(Map("x" -> 1.asInstanceOf[Any]))))
      Get(s"/pipelines/any/runs/$runId") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunStatusResponse]
        resp.status shouldBe RunStatus.Succeeded
        resp.rows   shouldBe defined
      }
    }

    "GET /pipelines/:id/runs/:runId returns 404 for unknown runId" in {
      val cache = new PipelineRunCache()
      Get("/pipelines/any/runs/nonexistent") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // ── run-history tests ──────────────────────────────────────────────────

    "GET /pipelines/:id/run-history returns 200 with empty list when no runs" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDs("static")
      val pid   = seedPipeline(dsId)
      Get(s"/pipelines/$pid/run-history") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.OK
        val records = responseAs[Vector[PipelineRunRecord]]
        records shouldBe empty
      }
    }

    "GET /pipelines/:id/run-history returns 200 with run records" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDs("static")
      val pid   = seedPipeline(dsId)
      val runId = java.util.UUID.randomUUID().toString
      await(pipelineRunRepo.insertRun(runId, pid, java.time.Instant.now()))
      await(pipelineRunRepo.updateRunTerminal(runId, "succeeded", java.time.Instant.now(), rowCount = Some(5)))

      Get(s"/pipelines/$pid/run-history") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.OK
        val records = responseAs[Vector[PipelineRunRecord]]
        records should have size 1
        records.head.id       shouldBe runId
        records.head.status   shouldBe "succeeded"
        records.head.rowCount shouldBe Some(5)
      }
    }

    "GET /pipelines/:id/run-history returns 404 for unknown pipeline" in {
      val cache = new PipelineRunCache()
      Get("/pipelines/nonexistent/run-history") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
    // 6.3 dry-run returns rows without modifying last_run_status
    "POST /pipelines/:id/run?dry=true returns rows without updating last_run_status" in {
      import PostgresProfile.api._
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      Post(s"/pipelines/$pid/run?dry=true") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
      val statusOpt = await(db.run(
        sql"SELECT last_run_status FROM pipelines WHERE id = $pid".as[Option[String]].head
      ))
      statusOpt shouldBe None
    }

    // 6.4 non-dry run updates last_run_status to succeeded and writes to Type Registry
    "POST /pipelines/:id/run updates last_run_status to succeeded and writes Type Registry fields" in {
      import PostgresProfile.api._
      val cache  = new PipelineRunCache()
      val dtRepo = new DataTypeRepository(db)(routeEc)
      val dsId   = seedDsWithData()
      val pid    = seedPipeline(dsId)
      Post(s"/pipelines/$pid/run") ~> makeRoutes(cache, dtRepo = dtRepo) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
      val statusOpt = await(db.run(
        sql"SELECT last_run_status FROM pipelines WHERE id = $pid".as[Option[String]].head
      ))
      statusOpt shouldBe Some("succeeded")
      val pipeline = await(pipelineRepo.findById(pid)).get
      val dt = await(dtRepo.findById(pipeline.outputDataTypeId)).get
      dt.fields.map(_.name) should contain allOf ("name", "score")
    }

    // ── step preview tests ─────────────────────────────────────────────────

    "GET /pipelines/:id/steps/:stepId/preview returns first 10 rows for a valid step" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      val step  = await(stepRepo.insert(pid, "select", """{"fields":["name","score"]}"""))
      Get(s"/pipelines/$pid/steps/${step.id}/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rows.size should be <= 10
        resp.rowCount shouldBe resp.rows.size
      }
    }

    "GET /pipelines/:id/steps/:stepId/preview returns 404 for unknown pipeline" in {
      val cache = new PipelineRunCache()
      Get("/pipelines/nonexistent/steps/any-step-id/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "GET /pipelines/:id/steps/:stepId/preview returns 404 for unknown step" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDs("static")
      val pid   = seedPipeline(dsId)
      Get(s"/pipelines/$pid/steps/nonexistent-step-id/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "GET /pipelines/:id/steps/:stepId/preview returns 422 for rest_api source type" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDs("rest_api")
      val pid   = seedPipeline(dsId)
      val step  = await(stepRepo.insert(pid, "select", """{"fields":[]}"""))
      Get(s"/pipelines/$pid/steps/${step.id}/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val resp = responseAs[ErrorResponse]
        resp.message should include("Unsupported source type")
      }
    }

    "GET /pipelines/:id/steps/:stepId/preview only applies steps up to and including the target step" in {
      val cache = new PipelineRunCache()
      // seed DS with 2 rows
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      // select step at position 0 — keeps both rows
      val selectStep = await(stepRepo.insert(pid, "select", """{"fields":["name","score"]}"""))
      // limit step at position 1 — would reduce to 1 row if applied
      await(stepRepo.insert(pid, "limit", """{"count":1}"""))
      // Preview up to selectStep only — should return 2 rows (limit not applied)
      Get(s"/pipelines/$pid/steps/${selectStep.id}/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
    }

    // 2.1 non-dry run success inserts a pipeline_runs row with status succeeded and correct rowCount
    "POST /pipelines/:id/run (non-dry, success) inserts a pipeline_runs row with status succeeded" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      Post(s"/pipelines/$pid/run") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
      val runs = await(pipelineRunRepo.listByPipeline(pid))
      runs should have size 1
      runs.head.pipelineId shouldBe pid
      runs.head.status     shouldBe "succeeded"
      runs.head.rowCount   shouldBe Some(2)
      runs.head.errorLog   shouldBe None
    }

    // 2.2 non-dry run failure via bad join step inserts a pipeline_runs row with status failed and non-empty errorLog
    "POST /pipelines/:id/run (non-dry, failure via bad join step) inserts a pipeline_runs row with status failed" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      await(stepRepo.insert(pid, "join",
        """{"rightDataSourceId": "00000000-0000-0000-0000-000000000099", "joinKey": "name"}"""))
      Post(s"/pipelines/$pid/run") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
      val runs = await(pipelineRunRepo.listByPipeline(pid))
      runs should have size 1
      runs.head.pipelineId shouldBe pid
      runs.head.status     shouldBe "failed"
      runs.head.errorLog   shouldBe defined
      runs.head.errorLog.get should not be empty
    }

    // 6.5 non-dry run failure sets last_run_status to failed and returns 422
    "POST /pipelines/:id/run failure sets last_run_status to failed and returns 422" in {
      import PostgresProfile.api._
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      await(stepRepo.insert(pid, "join",
        """{"rightDataSourceId": "00000000-0000-0000-0000-000000000099", "joinKey": "name"}"""))
      Post(s"/pipelines/$pid/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val resp = responseAs[ErrorResponse]
        resp.message should include ("Pipeline execution failed")
      }
      val statusOpt = await(db.run(
        sql"SELECT last_run_status FROM pipelines WHERE id = $pid".as[Option[String]].head
      ))
      statusOpt shouldBe Some("failed")
    }
  }
}
