package com.helio.api.routes.patchsets

import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport

import com.helio.api.routes.patchsets.PatchSetRoutes
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest, PutPipelineScheduleRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.sources.{DatasetFieldDeclarationPayload, UpdateDatasetSchemaRequest}
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
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineScheduleRepository, PipelineStepRepository}
import com.helio.services.pipelines.PipelineScheduleService
import com.helio.services.alerts.AlertRuleService
import com.helio.infrastructure.persistence.alerts.AlertRuleRepository
import com.helio.api.protocols.alerts.CreateAlertRuleRequest
import com.helio.api.protocols.panels.CreatePanelRequest
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
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Stale-target coverage for `POST /patch-sets/preview` + `/apply` widened to everything apply reads or overwrites on a dataSource and a pipeline (HEL-1458 owner revise). Bodies are raw JSON so the
 *  tests exercise the wire contract, not the Scala case classes. */
class PatchSetStaleWidenedFingerprintRoutesSpec
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
  private var scheduleService: PipelineScheduleService = _
  private var alertRuleService: AlertRuleService       = _
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
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo, pipelineRootRepo = new PipelineRootRepository(ctx))
    alertRuleService  = new AlertRuleService(new AlertRuleRepository(ctx), outputRepo)(routeEc)
    scheduleService   = new PipelineScheduleService(new PipelineScheduleRepository(ctx)(routeEc), pipelineRepo)(routeEc)

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

  private def json(body: String): HttpEntity.Strict = HttpEntity(ContentTypes.`application/json`, body)

  private def newDataset(columns: String*): DataSource = {
    val request = StaticDataSourceRequest("Src " + UUID.randomUUID(), "static", columns.toVector.map(StaticColumnPayload(_, "integer")), Vector(columns.toVector.map(_ => JsNumber(1))))
    await(dataSourceService.createStatic(request, userA)) match {
      case Right(d) => d
      case Left(e)  => fail(s"source seed failed: $e")
    }
  }

  private def newEmptyDataset(): DataSource = {
    val request = StaticDataSourceRequest("Src " + UUID.randomUUID(), "static", Vector(StaticColumnPayload("value", "integer")), Vector.empty)
    await(dataSourceService.createStatic(request, userA)) match {
      case Right(d) => d
      case Left(e)  => fail(s"source seed failed: $e")
    }
  }

  private def changeDeclaredSchema(source: DataSource, field: DatasetFieldDeclarationPayload): Unit =
    await(dataSourceService.updateDatasetSchema(source.id, UpdateDatasetSchemaRequest(Vector(field)), userA)) shouldBe a[Right[_, _]]

  private def newPipeline(source: DataSource): PipelineId =
    await(pipelineService.create(CreatePipelineRequest("Pipe " + UUID.randomUUID(), Vector(CreatePipelineRootRequest(Some(source.id.value)))), userA)) match {
      case Right(p) => PipelineId(p.id)
      case Left(e)  => fail(s"pipeline seed failed: $e")
    }

  private def newStep(pipelineId: PipelineId): PipelineStepId =
    await(pipelineService.addStep(pipelineId, CreatePipelineStepRequest("limit", JsObject("count" -> JsNumber(10))), userA)) match {
      case Right(s) => PipelineStepId(s.id)
      case Left(e)  => fail(s"step seed failed: $e")
    }

  private def newOutput(pipelineId: PipelineId): Output =
    await(outputRepo.insertInternal(pipelineId, None, userA.id, "Out " + UUID.randomUUID(), OutputKind.Table, explicitRootId = None))

  private def edit(kind: String, id: String, op: String): String = {
    val patch = if (op == "update") ""","patch":{"name":"Renamed by patch set"}""" else ""
    s"""{"edits":[{"target":{"kind":"$kind","id":"$id"},"op":"$op"$patch}]}"""
  }

  private def previewFingerprint(body: String): String =
    Post("/patch-sets/preview", json(body)) ~> routesFor(userA) ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject.fields("edits").convertTo[Vector[JsObject]].head.fields("fingerprint").convertTo[String]
    }

  private def withFingerprint(body: String, fingerprint: String): String = {
    val edit   = body.parseJson.asJsObject.fields("edits").convertTo[Vector[JsObject]].head
    val target = edit.fields("target").asJsObject
    JsObject("edits" -> JsArray(JsObject(edit.fields + ("target" -> JsObject(target.fields + ("fingerprint" -> JsString(fingerprint))))))).compactPrint
  }

  /** Previews `body`, runs `mutate`, then applies with the preview's fingerprint: must be a 409 naming edit 0. */
  private def assertRefusedAfter(body: String)(mutate: => Unit): Unit = {
    val sent = withFingerprint(body, previewFingerprint(body))
    mutate
    Post("/patch-sets/apply", json(sent)) ~> routesFor(userA) ~> check {
      status shouldBe StatusCodes.Conflict
      responseAs[String].parseJson.asJsObject.fields("code") shouldBe JsString("PATCH_SET_STALE")
    }
  }

  private def renamed(pipelineId: PipelineId): Boolean = await(pipelineRepo.findByIdInternal(pipelineId)).exists(_.name == "Renamed by patch set")
  private def renamedSource(id: DataSourceId): Boolean = await(dataSourceRepo.findByIdInternal(id)).exists(_.name == "Renamed by patch set")

  "dataSource fingerprint" should {
    Vector("update", "delete").foreach { op =>
      s"refuse a $op after the declared schema changed" in {
        val source = newDataset("value")
        assertRefusedAfter(edit("dataSource", source.id.value, op)) {
          val fields = Vector(DatasetFieldDeclarationPayload(name = "value", `type` = "integer"), DatasetFieldDeclarationPayload(name = "extra", `type` = "string"))
          await(dataSourceService.updateDatasetSchema(source.id, UpdateDatasetSchemaRequest(fields), userA)) shouldBe a[Right[_, _]]
        }
        await(dataSourceRepo.findByIdInternal(source.id)) should not be empty
        renamedSource(source.id) shouldBe false
      }

      Vector(
        "required"            -> DatasetFieldDeclarationPayload(name = "value", `type` = "integer", required = Some(true)),
        "default"             -> DatasetFieldDeclarationPayload(name = "value", `type` = "integer", default = Some(Some(JsNumber(7)))),
        "type on a populated column" -> DatasetFieldDeclarationPayload(name = "value", `type` = "float")
      ).foreach { case (label, field) =>
        s"refuse a $op after the declared $label changed" in {
          val source = newDataset("value")
          assertRefusedAfter(edit("dataSource", source.id.value, op))(changeDeclaredSchema(source, field))
          await(dataSourceRepo.findByIdInternal(source.id)) should not be empty
          renamedSource(source.id) shouldBe false
        }
      }

      // No service rewrites a stored config after create except refresh; the repository update is the real write path.
      s"refuse a $op after the stored config changed" in {
        val now    = Instant.now()
        val source = await(dataSourceRepo.insert(CsvSource(DataSourceId(UUID.randomUUID().toString), "Csv " + UUID.randomUUID(), userA.id, now, now, CsvSourceConfig("a/one.csv")), userA))
        assertRefusedAfter(edit("dataSource", source.id.value, op)) {
          await(dataSourceRepo.update(source.asInstanceOf[CsvSource].copy(config = CsvSourceConfig("a/two.csv")), userA)) should not be empty
        }
        await(dataSourceRepo.findByIdInternal(source.id)) should not be empty
        renamedSource(source.id) shouldBe false
      }
    }
  }

  "dataSource fingerprint on row writes" should {
    "not change when rows are appended to an empty dataset" in {
      val source = newEmptyDataset()
      val body   = edit("dataSource", source.id.value, "update")
      val before = previewFingerprint(body)
      await(dataSourceService.appendRows(source.id, Vector(Vector(JsNumber(1))), userA)) shouldBe a[Right[_, _]]
      previewFingerprint(body) shouldBe before
    }

    "not change when the rows are replaced" in {
      val source = newDataset("value")
      val body   = edit("dataSource", source.id.value, "delete")
      val before = previewFingerprint(body)
      await(dataSourceService.replaceRows(source.id, Vector(Vector(JsNumber(2)), Vector(JsNumber(3))), userA)) shouldBe a[Right[_, _]]
      previewFingerprint(body) shouldBe before
    }
  }

  "pipeline fingerprint" should {
    Vector("update", "delete").foreach { op =>
      s"refuse a $op after a root was added" in {
        val pipelineId = newPipeline(newDataset("value"))
        assertRefusedAfter(edit("pipeline", pipelineId.value, op)) {
          await(pipelineService.addRoot(pipelineId, CreatePipelineRootRequest(Some(newDataset("other").id.value)), userA)) shouldBe a[Right[_, _]]
        }
        renamed(pipelineId) shouldBe false
        await(pipelineRepo.findByIdInternal(pipelineId)) should not be empty
      }

      s"refuse a $op after a step was added" in {
        val pipelineId = newPipeline(newDataset("value"))
        assertRefusedAfter(edit("pipeline", pipelineId.value, op))(newStep(pipelineId))
        renamed(pipelineId) shouldBe false
        await(pipelineRepo.findByIdInternal(pipelineId)) should not be empty
      }

      s"refuse a $op after a step's config changed" in {
        val pipelineId = newPipeline(newDataset("value"))
        val stepId     = newStep(pipelineId)
        assertRefusedAfter(edit("pipeline", pipelineId.value, op)) {
          await(pipelineService.updateStep(stepId, UpdatePipelineStepRequest(None, Some(JsObject("count" -> JsNumber(99))), None), userA)) shouldBe a[Right[_, _]]
        }
        renamed(pipelineId) shouldBe false
        await(pipelineRepo.findByIdInternal(pipelineId)) should not be empty
      }

      s"refuse a $op after a step was disabled" in {
        val pipelineId = newPipeline(newDataset("value"))
        val stepId     = newStep(pipelineId)
        assertRefusedAfter(edit("pipeline", pipelineId.value, op)) {
          await(pipelineService.updateStep(stepId, UpdatePipelineStepRequest(None, None, None, Some(false)), userA)) shouldBe a[Right[_, _]]
        }
        renamed(pipelineId) shouldBe false
        await(pipelineRepo.findByIdInternal(pipelineId)) should not be empty
      }

      s"refuse a $op after an output was added" in {
        val pipelineId = newPipeline(newDataset("value"))
        assertRefusedAfter(edit("pipeline", pipelineId.value, op))(newOutput(pipelineId))
        renamed(pipelineId) shouldBe false
        await(pipelineRepo.findByIdInternal(pipelineId)) should not be empty
      }

      s"refuse a $op after an output's config changed" in {
        val pipelineId = newPipeline(newDataset("value"))
        val output     = newOutput(pipelineId)
        assertRefusedAfter(edit("pipeline", pipelineId.value, op)) {
          await(outputRepo.updateOwned(output.id, userA, None, Some(JsObject("limit" -> JsNumber(3))))) should not be empty
        }
        renamed(pipelineId) shouldBe false
        await(pipelineRepo.findByIdInternal(pipelineId)) should not be empty
      }

      s"refuse a $op after an output was renamed" in {
        val pipelineId = newPipeline(newDataset("value"))
        val output     = newOutput(pipelineId)
        assertRefusedAfter(edit("pipeline", pipelineId.value, op)) {
          await(outputRepo.updateOwned(output.id, userA, Some("Another name"), None)) should not be empty
        }
        renamed(pipelineId) shouldBe false
        await(pipelineRepo.findByIdInternal(pipelineId)) should not be empty
      }

      s"refuse a $op after a schedule was set" in {
        val pipelineId = newPipeline(newDataset("value"))
        assertRefusedAfter(edit("pipeline", pipelineId.value, op)) {
          await(scheduleService.put(pipelineId, PutPipelineScheduleRequest("interval", "1h", Some(true), "UTC"), userA)) shouldBe a[Right[_, _]]
        }
        renamed(pipelineId) shouldBe false
        await(pipelineRepo.findByIdInternal(pipelineId)) should not be empty
      }

      s"refuse a $op after a schedule's cadence changed" in {
        val pipelineId = newPipeline(newDataset("value"))
        await(scheduleService.put(pipelineId, PutPipelineScheduleRequest("interval", "1h", Some(true), "UTC"), userA)) shouldBe a[Right[_, _]]
        assertRefusedAfter(edit("pipeline", pipelineId.value, op)) {
          await(scheduleService.put(pipelineId, PutPipelineScheduleRequest("interval", "2h", Some(true), "UTC"), userA)) shouldBe a[Right[_, _]]
        }
        renamed(pipelineId) shouldBe false
        await(pipelineRepo.findByIdInternal(pipelineId)) should not be empty
      }
    }

    Vector("update", "delete").foreach { op =>
      s"refuse a $op after a panel was bound to an Output of the pipeline" in {
        val pipelineId = newPipeline(newDataset("value"))
        val output     = newOutput(pipelineId)
        val dashboard  = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Dash " + UUID.randomUUID())), userA))._1
        assertRefusedAfter(edit("pipeline", pipelineId.value, op)) {
          val request = CreatePanelRequest(Some(dashboard.id.value), Some("Bound"), Some("output"), Some(JsObject("outputId" -> JsString(output.id.value))))
          await(panelService.create(request, userA)) shouldBe a[Right[_, _]]
        }
        renamed(pipelineId) shouldBe false
        await(pipelineRepo.findByIdInternal(pipelineId)) should not be empty
      }

      s"refuse a $op after an alert rule was created on an Output of the pipeline" in {
        val pipelineId = newPipeline(newDataset("value"))
        val output     = newOutput(pipelineId)
        assertRefusedAfter(edit("pipeline", pipelineId.value, op)) {
          val request = CreateAlertRuleRequest(output.id.value, "count", JsObject("comparator" -> JsString("gt"), "threshold" -> JsNumber(5)), "warning", Some(true), "Rule")
          await(alertRuleService.create(request, userA)) shouldBe a[Right[_, _]]
        }
        renamed(pipelineId) shouldBe false
        await(pipelineRepo.findByIdInternal(pipelineId)) should not be empty
      }
    }

    "return the same fingerprint when a pipeline run completes between two previews" in {
      val pipelineId = newPipeline(newDataset("value"))
      newStep(pipelineId)
      val output = newOutput(pipelineId)
      val body   = edit("pipeline", pipelineId.value, "update")
      val before = previewFingerprint(body)
      await(pipelineRepo.updateLastRun(pipelineId, "succeeded", Instant.now(), Some(7L), userA, Some(false)))
      // A run also rewrites each Output's stored schema (HEL-1522): server-maintained, so not fingerprinted.
      await(outputRepo.updateSchemaInternal(output.id, Vector(SchemaField("value", "integer"))))
      previewFingerprint(body) shouldBe before
    }
  }
}
