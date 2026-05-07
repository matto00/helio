package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.infrastructure.PipelineRepository
import com.helio.api.routes.PipelineStepRoutes
import com.helio.infrastructure.PipelineStepRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile
import scala.concurrent.Await
import scala.concurrent.Future
import scala.concurrent.duration.DurationInt

class PipelineStepRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var stepRepo: PipelineStepRepository   = _
  private var pipelineRepo: PipelineRepository   = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    stepRepo     = new PipelineStepRepository(db)(typedSystem.executionContext)
    pipelineRepo = new PipelineRepository(db)(typedSystem.executionContext)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanSteps(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM pipeline_steps"))
  }

  private def seedPipeline(): String = {
    import PostgresProfile.api._
    val pid  = java.util.UUID.randomUUID().toString
    val dsId = java.util.UUID.randomUUID().toString
    val dtId = java.util.UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at) VALUES ($dsId, 'ds', 'rest_api', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at) VALUES ($dtId, 'dt', '[]', 1, '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, created_at, updated_at) VALUES ($pid, 'p', $dsId, $dtId, now(), now())"""
    )))
    pid
  }

  private def routes: Route = new PipelineStepRoutes(stepRepo, pipelineRepo)(typedSystem.executionContext).routes

  "PipelineStepRoutes" should {

    "GET /pipelines/:id/steps returns empty list for new pipeline" in {
      cleanSteps(); val pid = seedPipeline()
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
      }
    }

    "POST /pipelines/:id/steps creates a step and returns 201" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", CreatePipelineStepRequest("rename", "{}")) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.pipelineId shouldBe pid
        resp.op shouldBe "rename"
        resp.position shouldBe 0
        resp.id should not be empty
      }
    }

    "POST auto-increments position" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", CreatePipelineStepRequest("rename", "{}")) ~> routes ~> check { status shouldBe StatusCodes.Created }
      Post(s"/pipelines/$pid/steps", CreatePipelineStepRequest("filter", "{}")) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineStepResponse].position shouldBe 1
      }
    }

    "GET returns steps ordered by position" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", CreatePipelineStepRequest("rename", "{}")) ~> routes ~> check { status shouldBe StatusCodes.Created }
      Post(s"/pipelines/$pid/steps", CreatePipelineStepRequest("filter", "{}")) ~> routes ~> check { status shouldBe StatusCodes.Created }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps should have size 2
        steps.map(_.position) shouldBe Vector(0, 1)
      }
    }

    "PATCH updates a step and returns 200" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", CreatePipelineStepRequest("rename", "{}")) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      Patch(s"/pipeline-steps/$stepId", UpdatePipelineStepRequest(Some("filter"), Some("{}"), None)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PipelineStepResponse].op shouldBe "filter"
      }
    }

    "PATCH returns 404 for unknown id" in {
      Patch("/pipeline-steps/nonexistent-id", UpdatePipelineStepRequest(None, None, None)) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "DELETE removes a step and returns 204" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", CreatePipelineStepRequest("cast", "{}")) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      Delete(s"/pipeline-steps/$stepId") ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
      }
    }

    "DELETE returns 404 for unknown id" in {
      Delete("/pipeline-steps/nonexistent-id") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "GET returns 404 for unknown pipeline id" in {
      Get("/pipelines/nonexistent-pipeline/steps") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "POST returns 404 for unknown pipeline id" in {
      Post("/pipelines/nonexistent-pipeline/steps", CreatePipelineStepRequest("rename", "{}")) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "POST returns 400 for invalid op value" in {
      val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", CreatePipelineStepRequest("invalid-op", "{}")) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }
}
