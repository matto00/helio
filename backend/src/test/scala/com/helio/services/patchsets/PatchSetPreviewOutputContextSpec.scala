package com.helio.services.patchsets

import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport
import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.UpdateDashboardRequest
import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest, OutputResponse, UpdateOutputRequest, UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest, UpdateDataSourceRequest}
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.{OutputService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.api.JsonProtocols
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.domain.model._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1239: the preview context must carry everything the apply context does (structural
 *  parity), every `ResolvedAction` variant must be previewable (no MatchError), and a preview of
 *  every supported (kind, op) must write nothing anywhere in the public schema. */
class PatchSetPreviewOutputContextSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dashboardRepo: DashboardRepository = _
  private var panelRepo: PanelRepository         = _
  private var dataSourceRepo: DataSourceRepository = _
  private var pipelineRepo: PipelineRepository   = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var outputRepo: OutputRepository       = _
  private var accessChecker: AccessChecker       = _
  private var applicationRepo: PatchSetApplicationRepository = _

  private var dashboardService: DashboardService   = _
  private var panelService: PanelService           = _
  private var dataSourceService: DataSourceService = _
  private var pipelineService: PipelineService     = _
  private var outputService: OutputService         = _
  private var previewService: PatchSetPreviewService = _
  private var applyService: PatchSetApplyService   = _

  private val userAId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)

    dashboardRepo    = new DashboardRepository(ctx)(routeEc)
    panelRepo        = new PanelRepository(ctx)(routeEc)
    dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    val permissionRepo = new ResourcePermissionRepository(ctx)(routeEc)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineStepRepo = new PipelineStepRepository(ctx)(routeEc)
    outputRepo       = new OutputRepository(ctx)
    applicationRepo  = new PatchSetApplicationRepository(ctx)(routeEc)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    accessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(newTempDir("patch-set-preview-output-context-spec"))

    dashboardService  = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    panelService      = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    dataSourceService = new DataSourceService(dataSourceRepo, fileSystem)
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)
    outputService     = new OutputService(outputRepo, panelRepo, accessChecker)

    previewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker, outputRepo
    )
    applyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo,
      accessChecker, applicationRepo, outputRepo, outputService
    )

    import PostgresProfile.api._
    await(db.run(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@helio.test"}, now())"""
    ))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  // ── seeds ──────────────────────────────────────────────────────────────

  private def seedSource(name: String): DataSourceId =
    await(dataSourceService.createStatic(
      StaticDataSourceRequest(name, "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))),
      userA
    )) match {
      case Right(d) => d.id
      case Left(e)  => fail(s"source seed failed: $e")
    }

  private final case class Seeded(
      dashboardId: String, panelId: String, sourceId: String, pipelineId: String,
      stepId: String, outputId: String, boundOutputId: String
  )

  private def seedAll(): Seeded = {
    val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("D " + UUID.randomUUID())), userA))._1
    val panel = await(panelService.create(CreatePanelRequest(Some(dashboard.id.value), Some("P"), Some("divider"), None), userA)) match {
      case Right((p, _)) => p
      case Left(e)       => fail(s"panel seed failed: $e")
    }
    val sourceId = seedSource("S " + UUID.randomUUID())
    val pipeline = await(pipelineService.create(
      CreatePipelineRequest("Pipe " + UUID.randomUUID(), Vector(CreatePipelineRootRequest(Some(sourceId.value)))), userA
    )) match {
      case Right(p) => p
      case Left(e)  => fail(s"pipeline seed failed: $e")
    }
    val step = await(pipelineService.addStep(PipelineId(pipeline.id), CreatePipelineStepRequest("limit", JsObject("count" -> JsNumber(5))), userA)) match {
      case Right(s) => s
      case Left(e)  => fail(s"step seed failed: $e")
    }
    val output = await(outputRepo.insertInternal(PipelineId(pipeline.id), None, userA.id, "Out", OutputKind.Table, explicitRootId = None))
    val bound  = await(outputRepo.insertInternal(PipelineId(pipeline.id), Some(PipelineStepId(step.id)), userA.id, "Bound", OutputKind.Table, explicitRootId = None))
    Seeded(dashboard.id.value, panel.id.value, sourceId.value, pipeline.id, step.id, output.id.value, bound.id.value)
  }

  private def edit(kind: String, op: String, id: Option[String] = None, parentId: Option[String] = None)(
      panel: Option[UpdatePanelRequest] = None,
      dashboard: Option[UpdateDashboardRequest] = None,
      source: Option[UpdateDataSourceRequest] = None,
      pipeline: Option[UpdatePipelineRequest] = None,
      step: Option[UpdatePipelineStepRequest] = None,
      create: Option[JsValue] = None,
      output: Option[UpdateOutputRequest] = None
  ): Edit = Edit(EditTarget(kind, id, parentId), op, panel, dashboard, source, pipeline, step, create, output)

  /** Every supported (kind, op) -- the audit matrix. `output:create` is rejected (400) and so is
   *  not here; it has its own test. */
  private def matrix(s: Seeded): Vector[Edit] = Vector(
    edit("panel", "update", Some(s.panelId))(panel = Some(UpdatePanelRequest(Some("Renamed"), None, None, None))),
    edit("panel", "delete", Some(s.panelId))(),
    edit("panel", "create")(create = Some(JsObject("dashboardId" -> JsString(s.dashboardId), "title" -> JsString("New"), "type" -> JsString("divider")))),
    edit("dashboard", "update", Some(s.dashboardId))(dashboard = Some(UpdateDashboardRequest(Some("Renamed D"), None, None))),
    edit("dashboard", "delete", Some(s.dashboardId))(),
    edit("dashboard", "create")(create = Some(JsObject("name" -> JsString("New D")))),
    edit("dataSource", "update", Some(s.sourceId))(source = Some(UpdateDataSourceRequest(Some("Renamed S")))),
    edit("dataSource", "delete", Some(s.sourceId))(),
    edit("dataSource", "create")(create = Some(JsObject(
      "name" -> JsString("New S"), "type" -> JsString("dataset"),
      "columns" -> JsArray(JsObject("name" -> JsString("value"), "type" -> JsString("integer"))),
      "rows" -> JsArray(JsArray(JsNumber(1)))
    ))),
    edit("pipeline", "update", Some(s.pipelineId))(pipeline = Some(UpdatePipelineRequest("Renamed P"))),
    edit("pipeline", "delete", Some(s.pipelineId))(),
    edit("pipeline", "create")(create = Some(JsObject("name" -> JsString("New Pipe"), "roots" -> JsArray(JsObject("sourceId" -> JsString(s.sourceId)))))),
    edit("pipelineStep", "update", Some(s.stepId))(step = Some(UpdatePipelineStepRequest(None, Some(JsObject("count" -> JsNumber(9))), None))),
    edit("pipelineStep", "delete", Some(s.stepId))(),
    edit("pipelineStep", "create", None, Some(s.pipelineId))(create = Some(JsObject("type" -> JsString("limit"), "config" -> JsObject("count" -> JsNumber(1))))),
    edit("output", "update", Some(s.outputId))(output = Some(UpdateOutputRequest(Some("Renamed O"), None))),
    edit("output", "delete", Some(s.outputId))()
  )

  // ── full-schema snapshot ───────────────────────────────────────────────

  /** Row count + content checksum for EVERY public-schema table. */
  private def snapshot(): Map[String, (Long, String)] = {
    import PostgresProfile.api._
    val tables = await(db.run(
      sql"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name".as[String]
    ))
    tables.map { t =>
      val (n, h) = await(db.run(
        sql"""SELECT count(*), COALESCE(md5(string_agg(x::text, '|' ORDER BY x::text)), '') FROM #${"\"" + t + "\""} x""".as[(Long, String)].head
      ))
      t -> ((n, h))
    }.toMap
  }

  // ── tests ──────────────────────────────────────────────────────────────

  "PatchSetApplyContext parity (HEL-1239)" should {

    "carry every apply-context field, non-null and identical to the supplied collaborator, when built via the preview path" in {
      // Distinct repo INSTANCES for each service so identity proves the right one was wired.
      val ctx2 = new DbContext(db, db)(routeEc)
      val supplied = Map[String, AnyRef](
        "panelRepo"        -> new PanelRepository(ctx2)(routeEc),
        "dashboardRepo"    -> new DashboardRepository(ctx2)(routeEc),
        "dataSourceRepo"   -> new DataSourceRepository(ctx2)(routeEc),
        "pipelineRepo"     -> new PipelineRepository(ctx2, dataSourceRepo)(routeEc),
        "pipelineStepRepo" -> new PipelineStepRepository(ctx2)(routeEc),
        "accessChecker"    -> accessChecker,
        "outputRepo"       -> new OutputRepository(ctx2)
      )
      val preview = new PatchSetPreviewService(
        supplied("panelRepo").asInstanceOf[PanelRepository], supplied("dashboardRepo").asInstanceOf[DashboardRepository],
        supplied("dataSourceRepo").asInstanceOf[DataSourceRepository], supplied("pipelineRepo").asInstanceOf[PipelineRepository],
        supplied("pipelineStepRepo").asInstanceOf[PipelineStepRepository], accessChecker,
        supplied("outputRepo").asInstanceOf[OutputRepository]
      )
      def assertParity(label: String, built: PatchSetApplyContext): Unit = {
        val fields = built.productElementNames.zip(built.productIterator).toVector
        fields.map(_._1).toSet shouldBe supplied.keySet // a NEW context field must be wired + added here deliberately
        fields.foreach { case (name, value) =>
          withClue(s"$label: context field '$name' ") {
            (value == null) shouldBe false
            value.asInstanceOf[AnyRef] should be theSameInstanceAs supplied(name)
          }
        }
      }
      assertParity("preview", preview.context)
      val apply = new PatchSetApplyService(
        panelService, dashboardService, dataSourceService, pipelineService,
        supplied("panelRepo").asInstanceOf[PanelRepository], supplied("dashboardRepo").asInstanceOf[DashboardRepository],
        supplied("dataSourceRepo").asInstanceOf[DataSourceRepository], supplied("pipelineRepo").asInstanceOf[PipelineRepository],
        supplied("pipelineStepRepo").asInstanceOf[PipelineStepRepository], accessChecker, applicationRepo,
        supplied("outputRepo").asInstanceOf[OutputRepository], outputService
      )
      assertParity("apply", apply.context)
    }

    "return a typed ServiceError (never an NPE) for output edits and pipelineStep delete when outputRepo is null" in {
      val noOutput = new PatchSetPreviewService(
        panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker, null
      )
      val s = seedAll()
      val edits = Vector(
        edit("output", "update", Some(s.outputId))(output = Some(UpdateOutputRequest(Some("x"), None))),
        edit("output", "delete", Some(s.outputId))(),
        edit("pipelineStep", "delete", Some(s.stepId))()
      )
      edits.foreach { e =>
        await(noOutput.preview(PatchSet(None, Vector(e)), userA)) shouldBe
          Left(ServiceError.InternalError(PatchSetApplyContext.OutputRepoUnavailableMessage))
      }
    }
  }

  "PatchSetPreviewService over the whole (kind, op) matrix (HEL-1239)" should {

    "preview every ResolvedAction variant without a MatchError, and the matrix covers every sealed case" in {
      import scala.reflect.runtime.{universe => ru}
      val sealedCases = ru.typeOf[ResolvedAction].typeSymbol.asClass.knownDirectSubclasses.map(_.name.toString)
      sealedCases should not be empty

      val s = seedAll()
      val resolved = await(PatchSetApplyResolvers.resolveAll(matrix(s), userA, previewService.context)) match {
        case Right(r)  => r
        case Left(err) => fail(s"matrix failed to resolve: $err")
      }
      // Fails when a new ResolvedAction case is added without a matrix row (and so without a projection).
      resolved.map(_.action.getClass.getSimpleName).toSet shouldBe sealedCases

      resolved.foreach { r =>
        await(PatchSetPreviewProjection.project(r, userA, previewService.context)) match {
          case Right(p)  => withClue(s"${r.kind}:${r.op} ") { p.kind shouldBe r.kind; p.op shouldBe r.op }
          case Left(err) => fail(s"${r.kind}:${r.op} preview failed: $err")
        }
      }
    }

    "write nothing to ANY public-schema table across the whole matrix (full-schema checksum)" in {
      val s = seedAll()
      val before = snapshot()
      before.keySet.size should be > 30 // sanity: really is the whole schema
      matrix(s).foreach { e =>
        withClue(s"${e.target.kind}:${e.op} ") {
          await(previewService.preview(PatchSet(None, Vector(e)), userA)) match {
            case Right(r)  => r.edits should have size 1
            case Left(err) => fail(s"preview failed: $err")
          }
        }
      }
      await(previewService.preview(PatchSet(None, matrix(s)), userA)) shouldBe a[Right[_, _]]
      val after = snapshot()
      after shouldBe before
    }

    "reject an output create edit with a 400 and write nothing" in {
      val before = snapshot()
      val e = edit("output", "create")(create = Some(JsObject("name" -> JsString("N"), "kind" -> JsString("table"))))
      await(previewService.preview(PatchSet(None, Vector(e)), userA)) match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                            => fail(s"expected BadRequest, got $other")
      }
      snapshot() shouldBe before
    }

    "report the same pipelineStep-delete prior state (incl. boundOutputs) as apply" in {
      val s = seedAll()
      val e = edit("pipelineStep", "delete", Some(s.stepId))()
      val previewBefore = await(previewService.preview(PatchSet(None, Vector(e)), userA)) match {
        case Right(r)  => r.edits.head.before.getOrElse(fail("expected before"))
        case Left(err) => fail(s"preview failed: $err")
      }
      val applyPrior = await(applyService.apply(PatchSet(None, Vector(e)), userA)) match {
        case Right(r)  => r.edits.head.priorState.getOrElse(fail("expected priorState"))
        case Left(err) => fail(s"apply failed: $err")
      }
      val bound = previewBefore.asJsObject.fields("boundOutputs").asInstanceOf[JsArray].elements
      bound should have size 1
      bound.head.asJsObject.fields("output").convertTo[OutputResponse].id shouldBe s.boundOutputId
      previewBefore shouldBe applyPrior
    }
  }
}
