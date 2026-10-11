package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives.concat
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{CreatePipelineRequest, JsonProtocols}
import com.helio.api.protocols.pipelines.CreatePipelineRootRequest
import com.helio.api.http.{AccessCheckerImpl, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.domain.model.{AuthenticatedUser, DashboardId, DataSourceId, OutputKind, PanelId, PipelineId, PipelineStepId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRootRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.{OutputService, PipelineRunService, PipelineService}
import com.helio.spark.PipelineRunCache
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.{Files, Paths}
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1316 seam test, backend half. `shared-test-fixtures/window-rolling-seam.json` holds the exact
 *  config the window editor persists (frontend `WindowConfig.seam.test.tsx` drives the real editor and
 *  asserts its PATCH body equals it). Here the SAME config goes through the real step-create route,
 *  the real analyze route and a real end-to-end preview over the fixture's gappy dated input, and the
 *  outputs must equal the fixture's `expected`. */
class WindowRollingSeamSpec
    extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private val fixture  = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/window-rolling-seam.json"))).asJsObject
  private val config   = fixture.fields("config").asJsObject
  private val expected = fixture.fields("expected").convertTo[Vector[JsValue]]

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var pipelineService: PipelineService   = _
  private var runService: PipelineRunService     = _
  private var outputRepo: OutputRepository       = _
  private var outputService: OutputService       = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)(routeEc)
    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    val stepRepo       = new PipelineStepRepository(ctx)(routeEc)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    outputRepo         = new OutputRepository(ctx)(routeEc)
    val snapshotRepo   = new NodeSnapshotRepository(ctx)(routeEc)
    val panelRepo      = new PanelRepository(ctx)(routeEc)
    val dashboardRepo  = new DashboardRepository(ctx)(routeEc)
    pipelineService = new PipelineService(
      pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo, pipelineRootRepo = new PipelineRootRepository(ctx)(routeEc)
    )(routeEc)
    runService = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, new PipelineRunRepository(ctx)(routeEc), new PipelineRunCache(), null,
      new LocalFileSystem(Paths.get("/")), null, null,
      outputRepo = outputRepo, nodeSnapshotRepo = snapshotRepo
    )(routeEc)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel", id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline", id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker = new AccessCheckerImpl(new ResourcePermissionRepository(ctx)(routeEc), registry)
    outputService = new OutputService(outputRepo, panelRepo, accessChecker, nodeSnapshotRepo = snapshotRepo)(routeEc)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def newUser(): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def routesFor(owner: AuthenticatedUser): Route =
    concat(
      new PipelineRoutes(pipelineService, owner).routes,
      new PipelineStepRoutes(pipelineService, owner).routes,
      new PipelineRunSubmitRoutes(runService, owner).routes,
      new PipelineRunStatusRoutes(runService, owner).routes,
      new OutputRoutes(outputService, owner)(routeEc).routes
    )

  private def newPipeline(owner: AuthenticatedUser): PipelineId = {
    import PostgresProfile.api._
    val dsId     = UUID.randomUUID().toString
    val dsConfig = JsObject("columns" -> fixture.fields("columns"), "rows" -> fixture.fields("input")).compactPrint
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, ${s"ds-$dsId"}, 'dataset', '{}', ${owner.id.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, dsConfig)
    )))
    val req = CreatePipelineRequest(name = s"p-${UUID.randomUUID()}", roots = Vector(CreatePipelineRootRequest(sourceId = Some(dsId))))
    PipelineId(await(pipelineService.create(req, owner)).getOrElse(fail("pipeline create failed")).id)
  }

  "the shared window-rolling-seam fixture" should {
    "be accepted by the step route, analyzed as float, and run for real to the expected materialized Output rows" in {
      val owner = newUser(); val pid = newPipeline(owner)

      var stepId = ""
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("window"), "config" -> config)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
        val created = responseAs[JsObject]
        created.fields("config") shouldBe config
        stepId = created.fields("id").convertTo[String]
      }

      Get(s"/pipelines/${pid.value}/analyze") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val step = responseAs[JsObject].fields("steps").asInstanceOf[JsArray].elements.head.asJsObject
        step.fields.get("validationError").filter(_ != JsNull) shouldBe None
        val out = step.fields("outputSchema").asInstanceOf[JsArray].elements.map(_.asJsObject)
          .find(_.fields("name") == JsString("rolling_v")).getOrElse(fail("rolling_v missing from the analyzed schema"))
        out.fields("type") shouldBe JsString(fixture.fields("expectedType").convertTo[String])
      }

      // A real run: an Output on the window step, a submitted (non-dry) run, then the materialized rows.
      val output = await(outputRepo.insertInternal(pid, Some(PipelineStepId(stepId)), owner.id, "rolling", OutputKind.Table, explicitRootId = None))
      Post(s"/pipelines/${pid.value}/run") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
      }
      Get(s"/outputs/${output.id.value}/rows?limit=100") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[JsObject]
        body.fields("materialized") shouldBe JsTrue
        val rows = body.fields("items").asInstanceOf[JsArray].elements.map(_.asJsObject)
        rows should have size expected.size.toLong
        rows.map(_.fields.getOrElse("rolling_v", JsNull)) shouldBe expected
      }
    }

    "reject an invalid frame at the step-create route (422) and store nothing, while a draft stays saveable" in {
      val owner = newUser(); val pid = newPipeline(owner)
      def withKeys(extra: (String, JsValue)*): JsObject = JsObject(config.fields ++ extra)
      val twoKeys = JsArray(
        JsObject("field" -> JsString("date"), "direction" -> JsString("asc")),
        JsObject("field" -> JsString("team"), "direction" -> JsString("asc"))
      )
      val bad = Seq(
        withKeys("frameSize" -> JsNumber(0)),
        withKeys("frameSize" -> JsNumber(-1)),
        withKeys("frameSize" -> JsNumber(1001)),
        JsObject(config.fields - "frameSize" + ("frameSize" -> JsNumber(BigDecimal("7.5")))),
        withKeys("frameSize" -> JsNumber(BigDecimal("5000000000"))),
        withKeys("frameUnit" -> JsString("weeks")),
        withKeys("orderBy" -> twoKeys),
        withKeys("orderBy" -> JsArray(JsObject("field" -> JsString("date"), "direction" -> JsString("desc"))))
      )
      bad.foreach { cfg =>
        Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("window"), "config" -> cfg)) ~> routesFor(owner) ~> check {
          withClue(cfg.compactPrint) { status shouldBe StatusCodes.UnprocessableEntity }
        }
      }
      Get(s"/pipelines/${pid.value}/steps") ~> routesFor(owner) ~> check {
        responseAs[JsArray].elements shouldBe empty
      }
      val draft = JsObject(config.fields - "frameSize" - "field")
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("window"), "config" -> draft)) ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
      }
    }
  }
}
