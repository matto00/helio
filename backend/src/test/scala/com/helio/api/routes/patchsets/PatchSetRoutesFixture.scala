package com.helio.api.routes.patchsets

import com.helio.api.JsonProtocols
import com.helio.api.http.{AccessCheckerImpl, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.api.protocols.alerts.CreateAlertRuleRequest
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.alerts.AlertRuleRepository
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineScheduleRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.alerts.AlertRuleService
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.patchsets.{PatchSetApplyService, PatchSetPreviewService}
import com.helio.services.pipelines.{PipelineScheduleService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.dbio.{DBIO => SlickDBIO}
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Shared embedded-Postgres harness for the HEL-1522 patch-set route specs: real services over real repositories, two
 *  seeded users, and raw-JSON preview/apply helpers so tests exercise the wire contract. */
abstract class PatchSetRoutesFixture
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with TempDirectorySupport {

  protected implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  protected def routeEc: ExecutionContext                  = typedSystem.executionContext

  protected var embeddedPostgres: EmbeddedPostgres = _
  protected var db: JdbcBackend.Database           = _
  protected var dashboardRepo: DashboardRepository = _
  protected var panelRepo: PanelRepository         = _
  protected var dataSourceRepo: DataSourceRepository = _
  protected var pipelineRepo: PipelineRepository   = _
  protected var pipelineStepRepo: PipelineStepRepository = _
  protected var outputRepo: OutputRepository       = _
  protected var pipelineService: PipelineService   = _
  protected var scheduleService: PipelineScheduleService = _
  protected var alertRuleService: AlertRuleService = _
  protected var dataSourceService: DataSourceService = _
  protected var dashboardService: DashboardService = _
  protected var panelService: PanelService         = _
  protected var patchSetApplyService: PatchSetApplyService     = _
  protected var patchSetPreviewService: PatchSetPreviewService = _

  protected val userAId = UUID.randomUUID().toString
  protected val userBId = UUID.randomUUID().toString
  protected val userA   = AuthenticatedUser(UserId(userAId))
  protected val userB   = AuthenticatedUser(UserId(userBId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)
    outputRepo       = new OutputRepository(ctx)
    dashboardRepo    = new DashboardRepository(ctx)(routeEc)
    panelRepo        = new PanelRepository(ctx)(routeEc)
    dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineStepRepo = new PipelineStepRepository(ctx)(routeEc)
    val permissionRepo = new ResourcePermissionRepository(ctx)(routeEc)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(newTempDir("patch-set-routes-fixture"))
    dashboardService  = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    panelService      = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    dataSourceService = new DataSourceService(dataSourceRepo, fileSystem)
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo, pipelineRootRepo = new PipelineRootRepository(ctx))
    alertRuleService  = new AlertRuleService(new AlertRuleRepository(ctx), outputRepo)(routeEc)
    scheduleService   = new PipelineScheduleService(new PipelineScheduleRepository(ctx)(routeEc), pipelineRepo)(routeEc)
    patchSetApplyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, new PatchSetApplicationRepository(ctx)(routeEc), outputRepo
    )
    patchSetPreviewService = new PatchSetPreviewService(panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker, outputRepo)
    seedUsers()
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  protected def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  protected def exec(action: SlickDBIO[_]): Unit = { await(db.run(action)); () }

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@example.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@example.test"}, now())"""
    )))
  }

  protected def routesFor(user: AuthenticatedUser): Route =
    new PatchSetRoutes(patchSetApplyService, patchSetPreviewService, user)(typedSystem).routes

  protected def json(body: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, body)

  protected def newDataset(): DataSource = {
    val request = StaticDataSourceRequest("Src " + UUID.randomUUID(), "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1))))
    await(dataSourceService.createStatic(request, userA)).fold(e => fail(s"source seed failed: $e"), identity)
  }

  protected def newPipeline(): PipelineId =
    await(pipelineService.create(CreatePipelineRequest("Pipe " + UUID.randomUUID(), Vector(CreatePipelineRootRequest(Some(newDataset().id.value)))), userA))
      .fold(e => fail(s"pipeline seed failed: $e"), p => PipelineId(p.id))

  /** Appends a `limit` step: onto the trunk, or as a child of `parent` (attachAsTail = a further lane). */
  protected def newStep(pipelineId: PipelineId, parent: Option[PipelineStepId] = None, asTail: Boolean = false): PipelineStepId =
    await(pipelineService.addStep(pipelineId, CreatePipelineStepRequest("limit", JsObject("count" -> JsNumber(10)), parentStepId = parent.map(_.value), attachAsTail = if (asTail) Some(true) else None), userA))
      .fold(e => fail(s"step seed failed: $e"), s => PipelineStepId(s.id))

  protected def newOutput(pipelineId: PipelineId, node: Option[PipelineStepId] = None): Output =
    await(outputRepo.insertInternal(pipelineId, node, userA.id, "Out " + UUID.randomUUID(), OutputKind.Table, explicitRootId = None))

  protected def bindPanel(output: Output, title: String = "Bound " + UUID.randomUUID().toString.take(4)): Panel = {
    val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Dash " + UUID.randomUUID())), userA))._1
    val request   = CreatePanelRequest(Some(dashboard.id.value), Some(title), Some("output"), Some(JsObject("outputId" -> JsString(output.id.value))))
    await(panelService.create(request, userA)).fold(e => fail(s"panel seed failed: $e"), _._1)
  }

  protected def newAlertRule(output: Output, name: String = "Rule"): AlertRule =
    await(alertRuleService.create(CreateAlertRuleRequest(output.id.value, "count", JsObject("comparator" -> JsString("gt"), "threshold" -> JsNumber(5)), "warning", Some(true), name), userA))
      .fold(e => fail(s"alert rule seed failed: $e"), identity)

  protected def edit(kind: String, id: String, op: String, patch: String = """{"name":"Renamed by patch set"}"""): String = {
    val patchJson = if (op == "update") s""","patch":$patch""" else ""
    s"""{"edits":[{"target":{"kind":"$kind","id":"$id"},"op":"$op"$patchJson}]}"""
  }

  protected def previewJson(body: String, user: AuthenticatedUser = userA): JsObject =
    Post("/patch-sets/preview", json(body)) ~> routesFor(user) ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject
    }

  protected def previewFingerprint(body: String): String =
    previewJson(body).fields("edits").convertTo[Vector[JsObject]].head.fields("fingerprint").convertTo[String]

  protected def withFingerprint(body: String, fingerprint: String): String = {
    val edit   = body.parseJson.asJsObject.fields("edits").convertTo[Vector[JsObject]].head
    val target = edit.fields("target").asJsObject
    JsObject("edits" -> JsArray(JsObject(edit.fields + ("target" -> JsObject(target.fields + ("fingerprint" -> JsString(fingerprint))))))).compactPrint
  }

  /** Previews `body`, runs `mutate`, then applies with the preview's fingerprint: must be a 409 PATCH_SET_STALE. */
  protected def assertRefusedAfter(body: String)(mutate: => Unit): Unit = {
    val sent = withFingerprint(body, previewFingerprint(body))
    mutate
    Post("/patch-sets/apply", json(sent)) ~> routesFor(userA) ~> check {
      status shouldBe StatusCodes.Conflict
      responseAs[String].parseJson.asJsObject.fields("code") shouldBe JsString("PATCH_SET_STALE")
    }
  }

  protected def stepExists(id: PipelineStepId): Boolean   = await(pipelineStepRepo.findByIdInternal(id)).nonEmpty
  protected def outputExists(id: OutputId): Boolean        = await(outputRepo.findByIdInternal(id)).nonEmpty
}
