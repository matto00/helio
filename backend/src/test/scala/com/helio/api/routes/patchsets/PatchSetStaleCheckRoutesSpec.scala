package com.helio.api.routes.patchsets

import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport

import com.helio.api.routes.patchsets.PatchSetRoutes
import com.helio.api.protocols.dashboards.UpdateDashboardRequest
import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.testsupport.JsonSchemaValidation
import spray.json._
import java.time.Instant
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.patchsets.{PatchSetApplyService, PatchSetPreviewService}
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.http.{AccessCheckerImpl, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.api.JsonProtocols
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Stale-target coverage for `POST /patch-sets/preview` + `/apply` (HEL-1458). Bodies are raw JSON so the
 *  tests exercise the wire contract, not the Scala case classes. */
class PatchSetStaleCheckRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var dashboardRepo: DashboardRepository           = _
  private var panelRepo: PanelRepository                   = _
  private var dataSourceRepo: DataSourceRepository         = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineRepo: PipelineRepository             = _
  private var pipelineStepRepo: PipelineStepRepository     = _

  private var pipelineService: PipelineService       = _
  private var outputRepo: OutputRepository          = _
  private var dataSourceService: DataSourceService   = _
  private var dashboardService: DashboardService     = _
  private var panelService: PanelService             = _
  private var patchSetApplyService: PatchSetApplyService     = _
  private var patchSetPreviewService: PatchSetPreviewService = _

  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)
    outputRepo = new OutputRepository(ctx)

    dashboardRepo    = new DashboardRepository(ctx)(routeEc)
    panelRepo         = new PanelRepository(ctx)(routeEc)
    dataSourceRepo    = new DataSourceRepository(ctx)(routeEc)
    permissionRepo     = new ResourcePermissionRepository(ctx)(routeEc)
    pipelineRepo       = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineStepRepo   = new PipelineStepRepository(ctx)(routeEc)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(newTempDir("patch-set-routes-spec"))

    dashboardService = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    panelService      = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    dataSourceService = new DataSourceService(dataSourceRepo, fileSystem)
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)

    val applicationRepo = new PatchSetApplicationRepository(ctx)(routeEc)
    patchSetApplyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, applicationRepo, outputRepo
    )
    patchSetPreviewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, outputRepo
    )

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@helio.test"}, now())"""
    )))
  }

  private def routesFor(user: AuthenticatedUser): Route =
    new PatchSetRoutes(patchSetApplyService, patchSetPreviewService, user)(typedSystem).routes

  private val staleSchema = JsonSchemaValidation.compile("shared/patch-set-stale-response.schema.json")

  private def json(body: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, body)

  private def seedPanel(title: String): Panel = {
    val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Dash " + UUID.randomUUID())), userA))._1
    await(panelService.create(CreatePanelRequest(Some(dashboard.id.value), Some(title), Some("divider"), None), userA)) match {
      case Right((p, _)) => p
      case Left(e)       => fail(s"panel seed failed: $e")
    }
  }

  private def seedOutput(name: String): Output = {
    val ds = await(pipelineDataSource())
    val pipeline = await(pipelineService.create(CreatePipelineRequest("Pipe " + UUID.randomUUID(), Vector(CreatePipelineRootRequest(Some(ds.id.value)))), userA)) match {
      case Right(p) => p
      case Left(e)  => fail(s"pipeline seed failed: $e")
    }
    await(outputRepo.insertInternal(PipelineId(pipeline.id), None, userA.id, name, OutputKind.Table, explicitRootId = None))
  }

  private def seedPipelineWithStep(): (PipelineId, PipelineStepId) = {
    val ds = await(pipelineDataSource())
    val pipeline = await(pipelineService.create(CreatePipelineRequest("Pipe " + UUID.randomUUID(), Vector(CreatePipelineRootRequest(Some(ds.id.value)))), userA)) match {
      case Right(p) => p
      case Left(e)  => fail(s"pipeline seed failed: $e")
    }
    val step = await(pipelineService.addStep(PipelineId(pipeline.id), CreatePipelineStepRequest("limit", JsObject("count" -> JsNumber(10))), userA)) match {
      case Right(s) => s
      case Left(e)  => fail(s"step seed failed: $e")
    }
    (PipelineId(pipeline.id), PipelineStepId(step.id))
  }

  private def pipelineDataSource() = {
    dataSourceService.createStatic(
      StaticDataSourceRequest("Src " + UUID.randomUUID(), "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))),
      userA
    ).map {
      case Right(d) => d
      case Left(e)  => fail(s"source seed failed: $e")
    }
  }

  private def fingerprintsOf(previewBody: String): Vector[Option[String]] =
    Post("/patch-sets/preview", json(previewBody)) ~> routesFor(userA) ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject.fields("edits").convertTo[Vector[JsObject]]
        .map(_.fields.get("fingerprint").map(_.convertTo[String]))
    }

  private def withFingerprint(body: String, fingerprints: Vector[Option[String]]): String = {
    val edits = body.parseJson.asJsObject.fields("edits").convertTo[Vector[JsObject]]
    val stamped = edits.zip(fingerprints).map { case (edit, fp) =>
      val target = edit.fields("target").asJsObject
      JsObject(edit.fields + ("target" -> JsObject(target.fields ++ fp.map("fingerprint" -> JsString(_)))))
    }
    JsObject("edits" -> JsArray(stamped)).compactPrint
  }

  private def panelRename(panel: Panel, title: String): String =
    s"""{"edits":[{"target":{"kind":"panel","id":"${panel.id.value}"},"op":"update","patch":{"title":"$title"}}]}"""

  private def stepDelete(stepId: PipelineStepId): String =
    s"""{"edits":[{"target":{"kind":"pipelineStep","id":"${stepId.value}"},"op":"delete"}]}"""

  private def applicationCount(): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM patch_set_applications WHERE owner_id = ${userAId}::uuid".as[Int])).head
  }

  "patch-set preview" should {

    "return a fingerprint on update and delete entries and none on a create entry" in {
      val panel                = seedPanel("Original")
      val (pipelineId, stepId) = seedPipelineWithStep()
      val body =
        s"""{"edits":[
           |{"target":{"kind":"panel","id":"${panel.id.value}"},"op":"update","patch":{"title":"New"}},
           |{"target":{"kind":"pipelineStep","id":"${stepId.value}"},"op":"delete"},
           |{"target":{"kind":"pipelineStep","parentId":"${pipelineId.value}"},"op":"create","patch":{"type":"limit","config":{"count":5}}}
           |]}""".stripMargin
      val fingerprints = fingerprintsOf(body)
      fingerprints(0).getOrElse(fail("update entry has no fingerprint")) should startWith("v1:")
      fingerprints(1).getOrElse(fail("delete entry has no fingerprint")) should startWith("v1:")
      fingerprints(2) shouldBe None
    }

    "return the same fingerprint when a pipeline run completes between two previews" in {
      val (pipelineId, _) = seedPipelineWithStep()
      val output          = await(outputRepo.insertInternal(pipelineId, None, userA.id, "Run output", OutputKind.Table, explicitRootId = None))
      val body            = s"""{"edits":[{"target":{"kind":"pipeline","id":"${pipelineId.value}"},"op":"update","patch":{"name":"Renamed pipeline"}}]}"""
      val before          = fingerprintsOf(body)
      await(pipelineRepo.updateLastRun(pipelineId, "succeeded", Instant.now(), Some(7L), userA, Some(false)))
      // A run also rewrites each Output's stored schema (HEL-1522): server-maintained, so not fingerprinted.
      await(outputRepo.updateSchemaInternal(output.id, Vector(SchemaField("value", "integer"))))
      fingerprintsOf(body) shouldBe before
    }

    "return a different fingerprint when an editable field changed between two previews" in {
      val panel  = seedPanel("Original")
      val body   = panelRename(panel, "New")
      val before = fingerprintsOf(body)
      await(panelService.update(panel.id, UpdatePanelRequest(Some("Renamed elsewhere"), None, None, None), userA))
      fingerprintsOf(body) should not be before
    }

    "return a different step fingerprint when the step is disabled between two previews" in {
      val (_, stepId) = seedPipelineWithStep()
      val body        = stepDelete(stepId)
      val before      = fingerprintsOf(body)
      await(pipelineService.updateStep(stepId, UpdatePipelineStepRequest(None, None, None, Some(false)), userA))
      fingerprintsOf(body) should not be before
    }

    "return a different dashboard fingerprint when the dashboard is renamed between two previews" in {
      val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Dash " + UUID.randomUUID())), userA))._1
      val body      = s"""{"edits":[{"target":{"kind":"dashboard","id":"${dashboard.id.value}"},"op":"delete"}]}"""
      val before    = fingerprintsOf(body)
      await(dashboardService.update(dashboard.id, UpdateDashboardRequest(Some("Renamed"), None, None), userA))
      fingerprintsOf(body) should not be before
    }

    "reject a fingerprint on a create edit with 400" in {
      val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Dash " + UUID.randomUUID())), userA))._1
      val body =
        s"""{"edits":[{"target":{"kind":"panel","fingerprint":"v1:x"},"op":"create","patch":{"dashboardId":"${dashboard.id.value}","type":"divider"}}]}"""
      Post("/patch-sets/preview", json(body)) ~> routesFor(userA) ~> check { status shouldBe StatusCodes.BadRequest }
      Post("/patch-sets/apply", json(body)) ~> routesFor(userA) ~> check { status shouldBe StatusCodes.BadRequest }
    }
  }

  "patch-set apply" should {

    "refuse to overwrite a panel renamed after the preview and name it in a 409" in {
      val panel = seedPanel("Original")
      val body  = panelRename(panel, "From patch set")
      val sent  = withFingerprint(body, fingerprintsOf(body))
      await(panelService.update(panel.id, UpdatePanelRequest(Some("Renamed elsewhere"), None, None, None), userA))
      Post("/patch-sets/apply", json(sent)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Conflict
        val response = responseAs[String].parseJson.asJsObject
        JsonSchemaValidation.validationErrors(staleSchema, responseAs[String]) shouldBe empty
        response.fields("code") shouldBe JsString("PATCH_SET_STALE")
        response.fields("staleTargets") shouldBe
          JsArray(JsObject("index" -> JsNumber(0), "kind" -> JsString("panel"), "id" -> JsString(panel.id.value)))
        response.fields("message").convertTo[String] should include(s"edit 0 (panel ${panel.id.value})")
      }
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Renamed elsewhere")
    }

    "refuse to delete a pipeline step whose config changed after the preview" in {
      val (_, stepId) = seedPipelineWithStep()
      val body        = stepDelete(stepId)
      val sent        = withFingerprint(body, fingerprintsOf(body))
      await(pipelineService.updateStep(stepId, UpdatePipelineStepRequest(None, Some(JsObject("count" -> JsNumber(99))), None), userA))
      Post("/patch-sets/apply", json(sent)) ~> routesFor(userA) ~> check { status shouldBe StatusCodes.Conflict }
      await(pipelineStepRepo.findByIdInternal(stepId)) should not be empty
    }

    "apply nothing, journal nothing and name every stale target when one of several edits is stale" in {
      val stalePanel   = seedPanel("Stale panel")
      val freshPanel   = seedPanel("Fresh panel")
      val staleDashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Stale dashboard")), userA))._1
      val freshDashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Fresh dashboard")), userA))._1
      val body =
        s"""{"edits":[
           |{"target":{"kind":"panel","id":"${stalePanel.id.value}"},"op":"update","patch":{"title":"Patched stale"}},
           |{"target":{"kind":"panel","id":"${freshPanel.id.value}"},"op":"update","patch":{"title":"Patched fresh"}},
           |{"target":{"kind":"dashboard","id":"${staleDashboard.id.value}"},"op":"update","patch":{"name":"Patched stale dashboard"}},
           |{"target":{"kind":"dashboard","id":"${freshDashboard.id.value}"},"op":"update","patch":{"name":"Patched fresh dashboard"}}
           |]}""".stripMargin
      val sent = withFingerprint(body, fingerprintsOf(body))
      await(panelService.update(stalePanel.id, UpdatePanelRequest(Some("Changed panel"), None, None, None), userA))
      await(dashboardService.update(staleDashboard.id, UpdateDashboardRequest(Some("Changed dashboard"), None, None), userA))
      val applicationsBefore = applicationCount()

      Post("/patch-sets/apply", json(sent)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Conflict
        val stale = responseAs[String].parseJson.asJsObject.fields("staleTargets").convertTo[Vector[JsObject]]
        stale.map(_.fields("index").convertTo[Int]) shouldBe Vector(0, 2)
      }
      await(panelRepo.findByIdInternal(stalePanel.id)).map(_.title) shouldBe Some("Changed panel")
      await(panelRepo.findByIdInternal(freshPanel.id)).map(_.title) shouldBe Some("Fresh panel")
      await(dashboardRepo.findByIdInternal(staleDashboard.id)).map(_.name) shouldBe Some("Changed dashboard")
      await(dashboardRepo.findByIdInternal(freshDashboard.id)).map(_.name) shouldBe Some("Fresh dashboard")
      applicationCount() shouldBe applicationsBefore
    }

    "apply normally when no target changed since the preview" in {
      val panel = seedPanel("Original")
      val body  = panelRename(panel, "From patch set")
      val sent  = withFingerprint(body, fingerprintsOf(body))
      Post("/patch-sets/apply", json(sent)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[String].parseJson.asJsObject
        response.fields("edits").convertTo[Vector[JsObject]].map(_.fields("status")) shouldBe Vector(JsString("applied"))
        response.fields.get("applicationId") should not be empty
      }
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("From patch set")
    }

    "apply exactly as before when no fingerprint is sent, even after the target changed" in {
      val panel = seedPanel("Original")
      await(panelService.update(panel.id, UpdatePanelRequest(Some("Renamed elsewhere"), None, None, None), userA))
      Post("/patch-sets/apply", json(panelRename(panel, "From patch set"))) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("From patch set")
    }

    "treat a fingerprint with an unknown version prefix as stale" in {
      val panel = seedPanel("Original")
      val sent  = withFingerprint(panelRename(panel, "From patch set"), Vector(Some("v9:abc")))
      Post("/patch-sets/apply", json(sent)) ~> routesFor(userA) ~> check { status shouldBe StatusCodes.Conflict }
      await(panelRepo.findByIdInternal(panel.id)).map(_.title) shouldBe Some("Original")
    }

    "return the authorization error, not a conflict, when the caller cannot see the target" in {
      val panel = seedPanel("Original")
      val body  = panelRename(panel, "From patch set")
      val sent  = withFingerprint(body, fingerprintsOf(body))
      Post("/patch-sets/apply", json(sent)) ~> routesFor(userB) ~> check { status should (be(StatusCodes.NotFound) or be(StatusCodes.Forbidden)) }
    }

    "refuse to delete an output whose config changed after the preview" in {
      val output = seedOutput("To delete")
      val body   = s"""{"edits":[{"target":{"kind":"output","id":"${output.id.value}"},"op":"delete"}]}"""
      val sent   = withFingerprint(body, fingerprintsOf(body))
      await(outputRepo.updateOwned(output.id, userA, None, Some(JsObject("limit" -> JsNumber(3)))))
      Post("/patch-sets/apply", json(sent)) ~> routesFor(userA) ~> check { status shouldBe StatusCodes.Conflict }
      await(outputRepo.findById(output.id, userA)) should not be empty
    }
  }
}
