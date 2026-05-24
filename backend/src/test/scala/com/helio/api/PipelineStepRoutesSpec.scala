package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.{AuthenticatedUser, UserId}
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, PipelineRepository, PipelineStepRepository}
import com.helio.api.protocols.{
  CastStepResponse,
  FilterStepResponse,
  PipelineStepResponse,
  RenameStepResponse,
  SelectStepResponse
}
import com.helio.api.routes.PipelineStepRoutes
import com.helio.services.PipelineService
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile
import spray.json._
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
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
  private var dataTypeRepo: DataTypeRepository   = _
  private var dataSourceRepo: DataSourceRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    dataTypeRepo   = new DataTypeRepository(db)(typedSystem.executionContext)
    dataSourceRepo = new DataSourceRepository(db)(typedSystem.executionContext)
    stepRepo     = new PipelineStepRepository(db)(typedSystem.executionContext)
    pipelineRepo = new PipelineRepository(db, dataTypeRepo, dataSourceRepo)(typedSystem.executionContext)
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
    val pid  = UUID.randomUUID().toString
    val dsId = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at) VALUES ($dsId, 'ds', 'rest_api', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at) VALUES ($dtId, 'dt', '[]', 1, '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, created_at, updated_at) VALUES ($pid, 'p', $dsId, $dtId, now(), now())"""
    )))
    pid
  }

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  private def routes: Route = {
    implicit val ec: ExecutionContext = typedSystem.executionContext
    val service = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, dataTypeRepo)
    new PipelineStepRoutes(service, dummyUser).routes
  }

  // ── Request body helpers (CS2c-3a discriminated-union shape) ─────────────
  private def renameReq(): JsObject = JsObject("type" -> JsString("rename"), "config" -> JsObject("renames" -> JsObject()))
  private def filterReq(): JsObject = JsObject(
    "type" -> JsString("filter"),
    "config" -> JsObject("combinator" -> JsString("AND"), "conditions" -> JsArray())
  )
  private def castReq(): JsObject = JsObject("type" -> JsString("cast"), "config" -> JsObject("casts" -> JsObject()))
  private def selectReq(fields: Vector[String] = Vector.empty): JsObject =
    JsObject("type" -> JsString("select"), "config" -> JsObject("fields" -> JsArray(fields.map(JsString(_)))))
  private def joinReq(rightDsId: String): JsObject = JsObject(
    "type" -> JsString("join"),
    "config" -> JsObject(
      "rightDataSourceId" -> JsString(rightDsId),
      "joinKey"           -> JsString("id"),
      "joinType"          -> JsString("inner")
    )
  )

  // -- HEL-278 fixtures: seed a data source owned by ownerId, return its id --
  private def seedDataSource(ownerId: String): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES (${dsId}, 'join-right', 'rest_api', '{}', ${ownerId}::uuid, now(), now())"""
    ))
    dsId
  }

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
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.pipelineId shouldBe pid
        resp.`type` shouldBe "rename"
        resp.position shouldBe 0
        resp.id should not be empty
        resp shouldBe a [RenameStepResponse]
      }
    }

    "POST auto-increments position" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { status shouldBe StatusCodes.Created }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineStepResponse].position shouldBe 1
      }
    }

    "GET returns steps ordered by position" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { status shouldBe StatusCodes.Created }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { status shouldBe StatusCodes.Created }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps should have size 2
        steps.map(_.position) shouldBe Vector(0, 1)
      }
    }

    "PATCH updates a rename step's config and returns 200" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      val patchBody = JsObject(
        "config" -> JsObject("renames" -> JsObject("foo" -> JsString("bar")))
      )
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineStepResponse]
        resp.`type` shouldBe "rename"
        resp shouldBe a [RenameStepResponse]
      }
    }

    "PATCH with cross-type discriminator returns 400 (cross-type lock)" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      val crossBody = JsObject(
        "type" -> JsString("filter"),
        "config" -> JsObject("combinator" -> JsString("AND"), "conditions" -> JsArray())
      )
      Patch(s"/pipeline-steps/$stepId", crossBody) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "PATCH returns 404 for unknown id" in {
      val body = JsObject("config" -> JsObject("renames" -> JsObject()))
      Patch("/pipeline-steps/nonexistent-id", body) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "DELETE removes a step and returns 204" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", castReq()) ~> routes ~> check {
        val r = responseAs[PipelineStepResponse]
        stepId = r.id
        r shouldBe a [CastStepResponse]
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
      Post("/pipelines/nonexistent-pipeline/steps", renameReq()) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "POST returns 400 for invalid type discriminator" in {
      val pid = seedPipeline()
      val bad = JsObject("type" -> JsString("invalid-op"), "config" -> JsObject())
      Post(s"/pipelines/$pid/steps", bad) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    // 3.2 — select op accepted by the API with the discriminated-union shape
    "POST with type 'select' returns 201 with typed SelectStepResponse" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", selectReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.`type` shouldBe "select"
        resp.pipelineId shouldBe pid
        resp shouldBe a [SelectStepResponse]
      }
    }

    // HEL-278: cross-user JoinStep right-source must return 404
    "POST with join type and cross-user right-source returns 404" in {
      cleanSteps(); val pid = seedPipeline()
      // Seed a data source owned by a different user (user 2)
      val otherUserDsId = seedDataSource("00000000-0000-0000-0000-000000000002")
      Post(s"/pipelines/${pid}/steps", joinReq(otherUserDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // HEL-278: owner JoinStep with own source must return 201
    "POST with join type and own right-source returns 201" in {
      cleanSteps(); val pid = seedPipeline()
      // Seed a data source owned by the request user (user 1)
      val ownDsId = seedDataSource("00000000-0000-0000-0000-000000000001")
      Post(s"/pipelines/${pid}/steps", joinReq(ownDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.pipelineId shouldBe pid
        resp.`type` shouldBe "join"
      }
    }

    // CS2c-3a -- aggregate was previously absent from PipelineService.AllowedOps
    "POST with type 'aggregate' is accepted (regression: AllowedOps drift)" in {
      cleanSteps(); val pid = seedPipeline()
      val body = JsObject(
        "type" -> JsString("aggregate"),
        "config" -> JsObject(
          "groupBy"      -> JsArray(),
          "aggregations" -> JsArray()
        )
      )
      Post(s"/pipelines/$pid/steps", body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineStepResponse].`type` shouldBe "aggregate"
      }
    }
  }
}
