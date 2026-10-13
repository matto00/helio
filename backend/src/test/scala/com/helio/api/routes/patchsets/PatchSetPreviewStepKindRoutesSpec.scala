package com.helio.api.routes.patchsets

import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport

import com.helio.api.routes.patchsets.PatchSetRoutes
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import spray.json._
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
import com.helio.domain.model._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1535: a `pipelineStep` update previews for EVERY registered step kind. `ConvertFormatStep`,
 *  `AnalyzeWithAiStep` and `GenerateTextStep` had no arm in `PipelineStepProjectionSupport`, so their preview
 *  500d (position-only) or 400d (config). Each kind is previewed, then the same set is applied, and the two
 *  agree. Position cases use sibling steps and an in-range index (apply clamps/renumbers, preview copies). */
class PatchSetPreviewStepKindRoutesSpec
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
  private val userA   = AuthenticatedUser(UserId(userAId))

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
    )))
  }

  private def routesFor(user: AuthenticatedUser): Route =
    new PatchSetRoutes(patchSetApplyService, patchSetPreviewService, user)(typedSystem).routes

  private def json(body: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, body)

  private def pipelineDataSource() = {
    dataSourceService.createStatic(
      StaticDataSourceRequest("Src " + UUID.randomUUID(), "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))),
      userA
    ).map {
      case Right(d) => d
      case Left(e)  => fail(s"source seed failed: $e")
    }
  }

  /** kind -> (create config, replacement config); every config passes the strict write-path validation. */
  private val Cases: Vector[(String, JsObject, JsObject)] = Vector(
    ("convertformat",
      JsObject("field" -> JsString("value"), "from" -> JsString("csv"), "to" -> JsString("json"), "outputField" -> JsString("converted")),
      JsObject("field" -> JsString("value"), "from" -> JsString("text"), "to" -> JsString("markdown"), "outputField" -> JsString("md"))),
    ("analyzewithai",
      JsObject("inputField" -> JsString("value"), "instruction" -> JsString("Rate it"),
        "outputSchema" -> JsArray(JsObject("name" -> JsString("score"), "type" -> JsString("integer")))),
      JsObject("inputField" -> JsString("value"), "instruction" -> JsString("Rate it again"),
        "outputSchema" -> JsArray(JsObject("name" -> JsString("label"), "type" -> JsString("string"))))),
    ("generatetext",
      JsObject("inputField" -> JsString("value"), "instruction" -> JsString("Summarise"), "outputField" -> JsString("summary")),
      JsObject("inputField" -> JsString("value"), "instruction" -> JsString("Summarise briefly"), "outputField" -> JsString("brief")))
  )

  /** A trunk `limit` with two SIBLING children, [<kind> at position 1 and another limit, observed and asserted in the test] (attachAsTail adds a sibling) (positions are
   *  sibling-scoped, so a position update needs siblings -- a trunk chain has one step per group); returns the kind
   *  step's id. */
  private def seedPipeline(kind: String, config: JsObject): PipelineStepId = {
    val ds = await(pipelineDataSource())
    val pipeline = await(pipelineService.create(CreatePipelineRequest("Pipe " + UUID.randomUUID(), Vector(CreatePipelineRootRequest(Some(ds.id.value)))), userA)) match {
      case Right(p) => p
      case Left(e)  => fail(s"pipeline seed failed: $e")
    }
    def add(k: String, c: JsObject, parent: Option[String] = None) =
      await(pipelineService.addStep(PipelineId(pipeline.id), CreatePipelineStepRequest(k, c, parentStepId = parent, attachAsTail = parent.map(_ => true)), userA)) match {
      case Right(s) => s
      case Left(e)  => fail(s"$k step seed failed: $e")
    }
    val trunk = add("limit", JsObject("count" -> JsNumber(10)))
    val step  = add(kind, config, Some(trunk.id))
    add("limit", JsObject("count" -> JsNumber(5)), Some(trunk.id))
    PipelineStepId(step.id)
  }

  private def stepUpdate(id: PipelineStepId, patch: String): String =
    s"""{"edits":[{"target":{"kind":"pipelineStep","id":"${id.value}"},"op":"update","patch":$patch}]}"""

  private def previewAfter(body: String): JsObject =
    Post("/patch-sets/preview", json(body)) ~> routesFor(userA) ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject.fields("edits").convertTo[Vector[JsObject]].head.fields("after").asJsObject
    }

  private def applyResult(body: String): JsObject =
    Post("/patch-sets/apply", json(body)) ~> routesFor(userA) ~> check {
      status shouldBe StatusCodes.OK
      val edit = responseAs[String].parseJson.asJsObject.fields("edits").convertTo[Vector[JsObject]].head
      edit.fields("status") shouldBe JsString("applied")
      edit.fields("resultingState").asJsObject
    }

  private def field(o: JsObject, k: String): JsValue = o.fields(k)

  "patch-set preview of a pipelineStep update" should {
    Cases.foreach { case (kind, createConfig, newConfig) =>
      s"preview a position-only update for a $kind step and agree with apply" in {
        val stepId = seedPipeline(kind, createConfig)
        await(pipelineStepRepo.findByIdInternal(stepId)).map(_.position) shouldBe Some(1)
        val body   = stepUpdate(stepId, """{"position":0}""")
        val after  = previewAfter(body)
        field(after, "type") shouldBe JsString(kind)
        field(after, "position") shouldBe JsNumber(0)
        field(after, "config") shouldBe createConfig
        val result = applyResult(body)
        field(result, "type") shouldBe JsString(kind)
        await(pipelineStepRepo.findByIdInternal(stepId)).map(_.position) shouldBe Some(0)
        field(result, "position") shouldBe field(after, "position")
        field(result, "config") shouldBe field(after, "config")
      }

      s"preview a config update for a $kind step and agree with apply" in {
        val stepId = seedPipeline(kind, createConfig)
        val body   = stepUpdate(stepId, s"""{"config":${newConfig.compactPrint}}""")
        val after  = previewAfter(body)
        field(after, "type") shouldBe JsString(kind)
        field(after, "config") shouldBe newConfig
        field(after, "position") shouldBe JsNumber(1)
        val result = applyResult(body)
        field(result, "config") shouldBe field(after, "config")
        await(pipelineStepRepo.findByIdInternal(stepId)).map(_.configValue) shouldBe Some(PipelineStep.Registry(kind).decodeConfig(newConfig.compactPrint))
      }
    }
  }
}
