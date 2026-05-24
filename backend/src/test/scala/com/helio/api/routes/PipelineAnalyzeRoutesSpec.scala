package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{AnalyzeStepResponse, ErrorResponse, JsonProtocols, PipelineAnalyzeResponse}
import com.helio.domain.{AuthenticatedUser, PipelineId, SelectConfig, UserId}
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, PipelineRepository, PipelineStepRepository}
import com.helio.services.PipelineService
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

class PipelineAnalyzeRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc                                    = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres    = _
  private var db: JdbcBackend.Database              = _
  private var pipelineRepo: PipelineRepository      = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var dataTypeRepo: DataTypeRepository      = _
  private var dataSourceRepo: DataSourceRepository  = _

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db               = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    dataTypeRepo     = new DataTypeRepository(db)(routeEc)
    dataSourceRepo   = new DataSourceRepository(db)(routeEc)
    pipelineRepo     = new PipelineRepository(db, dataTypeRepo, dataSourceRepo)(routeEc)
    pipelineStepRepo = new PipelineStepRepository(db)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  // ---------------------------------------------------------------------------
  // DB helpers
  // ---------------------------------------------------------------------------

  private def cleanPipelines(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM pipeline_steps"))
    await(db.run(sqlu"DELETE FROM pipelines"))
  }

  /** Seeds a DataSource + its companion DataType (sourceId = dsId) + a Pipeline.
   *  Returns (pipelineId, dataSourceId). */
  private def seedPipelineWithSchema(fields: String): (String, String) = {
    import PostgresProfile.api._
    val dsId  = UUID.randomUUID().toString
    val dtId  = UUID.randomUUID().toString   // source DataType
    val outId = UUID.randomUUID().toString   // output DataType
    val pid   = UUID.randomUUID().toString
    val ownerId = dummyUser.id.value

    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'test-ds', 'rest_api', '{}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($dtId, $dsId, 'source-dt', $fields, 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($outId, 'output-dt', '[]', 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, created_at, updated_at)
             VALUES ($pid, 'test-pipeline', $dsId, $outId, now(), now())"""
    )))
    (pid, dsId)
  }

  private def routes: Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)
    new PipelineRoutes(service, dummyUser).routes
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  "GET /pipelines/:id/analyze" should {

    "return 404 for a non-existent pipeline id" in {
      cleanPipelines()
      Get("/pipelines/nonexistent-pipeline-id/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse].message should include("not found")
      }
    }

    "return 200 with empty steps and sourceSchema for a pipeline with no steps" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},{"name":"amount","displayName":"Amount","dataType":"number","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeResponse]
        resp.id   shouldBe pid
        resp.name shouldBe "test-pipeline"
        resp.steps shouldBe empty
        resp.sourceSchema.map(_.name) should contain allOf ("order_id", "amount")
      }
    }

    "return 200 with correct schemas for a pipeline with a select step" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},{"name":"amount","displayName":"Amount","dataType":"number","nullable":false},{"name":"created_at","displayName":"Created","dataType":"string","nullable":true}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)

      // Insert a select step via the repo (CS2c-3a typed config)
      await(pipelineStepRepo.insert(PipelineId(pid), "select", SelectConfig(Vector("order_id", "amount"))))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp: PipelineAnalyzeResponse = responseAs[PipelineAnalyzeResponse]

        resp.steps should have size 1
        val step: AnalyzeStepResponse = resp.steps(0)
        step.`type` shouldBe "select"
        step.inputSchema.map(_.name)  should contain allOf ("order_id", "amount", "created_at")
        step.outputSchema.map(_.name) shouldBe Vector("order_id", "amount")
        step.validationError shouldBe None
      }
    }

    "return 200 with empty sourceSchema when no DataType is linked to the DataSource" in {
      cleanPipelines()
      // Seed pipeline without a companion source DataType (empty fields)
      val (pid, _) = seedPipelineWithSchema("[]")

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeResponse]
        resp.sourceSchema shouldBe empty
        resp.steps shouldBe empty
      }
    }
  }
}
