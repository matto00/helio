package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{ErrorResponse, JsonProtocols, RunStatusResponse, RunSubmitResponse}
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, PipelineRepository, PipelineStepRepository}
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

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var pipelineRepo: PipelineRepository     = _
  private var stepRepo: PipelineStepRepository     = _
  private var dataSourceRepo: DataSourceRepository = _

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
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)
  // ---------------------------------------------------------------------------
  // DB helpers
  // ---------------------------------------------------------------------------

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
      extends SparkJobSubmitter("local", null) {
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

  private def makeRoutes(cache: PipelineRunCache): Route = {
    implicit val ec: ExecutionContext = routeEc
    val submitter = new StubSparkJobSubmitter()
    new PipelineRunRoutes(pipelineRepo, stepRepo, dataSourceRepo, submitter, cache, dummyUser).routes
  }

  "PipelineRunRoutes" should {

    "POST /pipelines/:id/run returns 201 with runId for a static pipeline" in {
      val cache  = new PipelineRunCache()
      val dsId   = seedDs("static")
      val pid    = seedPipeline(dsId)
      Post(s"/pipelines/$pid/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[RunSubmitResponse]
        resp.runId should not be empty
        // Cache should have the entry
        cache.get(resp.runId) shouldBe defined
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
  }
}
