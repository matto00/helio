package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.concat
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{JsonProtocols, PipelineRunRecord, PipelineSummaryResponse}
import com.helio.api.protocols.PipelineStepResponse
import com.helio.domain._
import com.helio.infrastructure.{
  DataSourceRepository,
  DataTypeRepository,
  DataTypeRowRepository,
  DbContext,
  LocalFileSystem,
  PipelineRepository,
  PipelineRunRepository,
  PipelineStepRepository
}
import com.helio.services.{PipelineRunService, PipelineService}
import com.helio.spark.PipelineRunCache
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-265 CS2 — cross-user pipeline ACL coverage.
 *
 *  Seeds pipelines owned by user A, and asserts that every read / write
 *  endpoint returns 404 when user B (a different authenticated user) tries
 *  to reach them — `pipelines`, `pipeline_steps`, `pipeline_runs`,
 *  `/run`, `/run-history`, `/run-events`, `/steps/:id/preview`, the
 *  pipeline-create source-binding check.
 *
 *  Also asserts that user A's own operations succeed (regression guard
 *  for owner read paths). */
class PipelineAclSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres        = _
  private var db: JdbcBackend.Database                  = _
  private var pipelineRepo: PipelineRepository          = _
  private var stepRepo: PipelineStepRepository          = _
  private var dataSourceRepo: DataSourceRepository      = _
  private var dataTypeRepo: DataTypeRepository          = _
  private var pipelineRunRepo: PipelineRunRepository    = _
  private var dataTypeRowRepo: DataTypeRowRepository    = _

  // Two distinct authenticated users — `userA` owns the pipelines under test;
  // `userB` is the cross-user probe. Both must already exist in the `users`
  // table so the `owner_id` FK is satisfied.
  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx         = new DbContext(db)(routeEc)
    dataTypeRepo    = new DataTypeRepository(ctx)(routeEc)
    dataSourceRepo  = new DataSourceRepository(ctx)(routeEc)
    stepRepo        = new PipelineStepRepository(ctx)(routeEc)
    pipelineRepo    = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(routeEc)
    pipelineRunRepo = new PipelineRunRepository(ctx)(routeEc)
    dataTypeRowRepo = new DataTypeRowRepository(ctx)(routeEc)
    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val fileSystem = new LocalFileSystem(Paths.get("/"))

  // ── DB helpers ─────────────────────────────────────────────────────────────

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
               VALUES ($userAId::uuid, ${s"user-a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at)
               VALUES ($userBId::uuid, ${s"user-b-$userBId@helio.test"}, now())"""
    )))
  }

  /** Seed a data source + data type + pipeline owned by `ownerId`. Returns
    * the pipeline id. */
  private def seedOwnedPipeline(ownerId: String): PipelineId = {
    import PostgresProfile.api._
    val dsId  = UUID.randomUUID().toString
    val dtId  = UUID.randomUUID().toString
    val pid   = UUID.randomUUID().toString
    val cfg   = """{"columns":[],"rows":[]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'static', $cfg, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId, 'dt', '[]', 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
               VALUES ($pid, 'pipe', $dsId, $dtId, $ownerId::uuid, now(), now())"""
    )))
    PipelineId(pid)
  }

  /** Seed a DataSource owned by `ownerId` and return its id — used to
    * exercise the create-time source binding check. */
  private def seedOwnedDataSource(ownerId: String): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val cfg  = """{"columns":[],"rows":[]}"""
    await(db.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'static', $cfg, $ownerId::uuid, now(), now())"""
    ))
    dsId
  }

  // ── Route fixtures ────────────────────────────────────────────────────────

  /** Compose the full pipeline route surface for a single authenticated
    * user. Each test calls this twice — once as A, once as B — and asserts
    * the appropriate 200/204/Created vs 404. */
  private def routesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val cache         = new PipelineRunCache()
    val pipelineSvc   = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, dataTypeRepo)
    val runSvc        = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, pipelineRunRepo, dataTypeRepo,
      dataTypeRowRepo, cache, null, fileSystem
    )
    concat(
      new PipelineRoutes(pipelineSvc, user).routes,
      new PipelineStepRoutes(pipelineSvc, user).routes,
      new PipelineRunSubmitRoutes(runSvc, user).routes,
      new PipelineRunStatusRoutes(runSvc, user).routes,
      new PipelineRunHistoryRoutes(runSvc, user).routes,
      new PipelineRunStreamRoutes(runSvc, user).routes
    )
  }

  // ── Listing endpoint ──────────────────────────────────────────────────────

  "GET /pipelines" should {
    "return only the caller's pipelines (owner filter; cross-user not leaked)" in {
      val pidA = seedOwnedPipeline(userAId)
      val pidB = seedOwnedPipeline(userBId)

      Get("/pipelines") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val ids = responseAs[Vector[PipelineSummaryResponse]].map(_.id)
        ids should contain(pidA.value)
        ids should not contain (pidB.value)
      }
    }
  }

  // ── /pipelines/:id GET / PATCH / DELETE ───────────────────────────────────

  "GET /pipelines/:id" should {
    "return 200 for the owner" in {
      val pid = seedOwnedPipeline(userAId)
      Get(s"/pipelines/${pid.value}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
    "return 404 for a cross-user caller" in {
      val pid = seedOwnedPipeline(userAId)
      Get(s"/pipelines/${pid.value}") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "PATCH /pipelines/:id" should {
    "update the name for the owner" in {
      val pid = seedOwnedPipeline(userAId)
      val body = JsObject("name" -> JsString("renamed"))
      Patch(s"/pipelines/${pid.value}", body) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PipelineSummaryResponse].name shouldBe "renamed"
      }
    }
    "return 404 for a cross-user caller" in {
      val pid = seedOwnedPipeline(userAId)
      val body = JsObject("name" -> JsString("hijack"))
      Patch(s"/pipelines/${pid.value}", body) ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      // And the row is unchanged.
      Get(s"/pipelines/${pid.value}") ~> routesFor(userA) ~> check {
        responseAs[PipelineSummaryResponse].name shouldBe "pipe"
      }
    }
  }

  "DELETE /pipelines/:id" should {
    "return 204 and remove the row for the owner" in {
      val pid = seedOwnedPipeline(userAId)
      Delete(s"/pipelines/${pid.value}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
      Get(s"/pipelines/${pid.value}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
    "return 404 for a cross-user caller and leave the row in place" in {
      val pid = seedOwnedPipeline(userAId)
      Delete(s"/pipelines/${pid.value}") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      Get(s"/pipelines/${pid.value}") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  // ── /pipelines/:id/analyze ────────────────────────────────────────────────

  "GET /pipelines/:id/analyze" should {
    "return 404 for a cross-user caller" in {
      val pid = seedOwnedPipeline(userAId)
      Get(s"/pipelines/${pid.value}/analyze") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  // ── /pipelines/:id/steps + /pipeline-steps/:id ────────────────────────────

  "Pipeline step CRUD" should {

    val renameReq: JsObject = JsObject(
      "type"   -> JsString("rename"),
      "config" -> JsObject("renames" -> JsObject())
    )

    "GET /pipelines/:id/steps returns 404 for a cross-user caller" in {
      val pid = seedOwnedPipeline(userAId)
      Get(s"/pipelines/${pid.value}/steps") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "POST /pipelines/:id/steps returns 404 for a cross-user caller" in {
      val pid = seedOwnedPipeline(userAId)
      Post(s"/pipelines/${pid.value}/steps", renameReq) ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      // Confirm no step was created — owner-side count is zero.
      Get(s"/pipelines/${pid.value}/steps") ~> routesFor(userA) ~> check {
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
      }
    }

    "PATCH /pipeline-steps/:id returns 404 for a cross-user caller" in {
      val pid = seedOwnedPipeline(userAId)
      var stepId = ""
      Post(s"/pipelines/${pid.value}/steps", renameReq) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        stepId = responseAs[PipelineStepResponse].id
      }
      val patchBody = JsObject(
        "config" -> JsObject("renames" -> JsObject("hijacked" -> JsString("yes")))
      )
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "DELETE /pipeline-steps/:id returns 404 for a cross-user caller and leaves the row" in {
      val pid = seedOwnedPipeline(userAId)
      var stepId = ""
      Post(s"/pipelines/${pid.value}/steps", renameReq) ~> routesFor(userA) ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      Delete(s"/pipeline-steps/$stepId") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      // Owner can still see + delete the step.
      Delete(s"/pipeline-steps/$stepId") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
    }
  }

  // ── /pipelines/:id/run and friends ────────────────────────────────────────

  "POST /pipelines/:id/run" should {
    "return 404 for a cross-user caller" in {
      val pid = seedOwnedPipeline(userAId)
      Post(s"/pipelines/${pid.value}/run") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "GET /pipelines/:id/steps/:stepId/preview" should {
    "return 404 for a cross-user caller" in {
      val pid = seedOwnedPipeline(userAId)
      Get(s"/pipelines/${pid.value}/steps/anything/preview") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "GET /pipelines/:id/run-history" should {
    "return only the owner's run records" in {
      val pid = seedOwnedPipeline(userAId)
      // Owner sees the (empty) history.
      Get(s"/pipelines/${pid.value}/run-history") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[PipelineRunRecord]] shouldBe empty
      }
    }
    "return 404 for a cross-user caller" in {
      val pid = seedOwnedPipeline(userAId)
      Get(s"/pipelines/${pid.value}/run-history") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "GET /pipelines/:id/run-events (SSE)" should {
    "return 404 for a cross-user caller" in {
      val pid = seedOwnedPipeline(userAId)
      Get(s"/pipelines/${pid.value}/run-events") ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  // ── Create-time source binding check ──────────────────────────────────────

  "POST /pipelines" should {
    "reject a sourceDataSourceId the caller does not own with 404 (not 400)" in {
      // userA owns the data source; userB attempts to bind their new pipeline
      // to it. Should be indistinguishable from the source not existing.
      val dsIdOwnedByA = seedOwnedDataSource(userAId)
      val body = JsObject(
        "name"               -> JsString("hijacked-pipeline"),
        "sourceDataSourceId" -> JsString(dsIdOwnedByA),
        "outputDataTypeName" -> JsString("hijacked-dt")
      )
      Post("/pipelines", body) ~> routesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "accept a sourceDataSourceId the caller owns and create the pipeline" in {
      val dsIdOwnedByA = seedOwnedDataSource(userAId)
      val body = JsObject(
        "name"               -> JsString("owned-pipeline"),
        "sourceDataSourceId" -> JsString(dsIdOwnedByA),
        "outputDataTypeName" -> JsString("owned-dt")
      )
      Post("/pipelines", body) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineSummaryResponse].name shouldBe "owned-pipeline"
      }
    }
  }
}
