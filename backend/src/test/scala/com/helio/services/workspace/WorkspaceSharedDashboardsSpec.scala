package com.helio.services.workspace

import com.helio.api.http.{AccessCheckerImpl, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.api.protocols.workspace.WorkspaceContextResponse
import com.helio.services.assistant.{AssistantSystemPrompt, AssistantToolExecutor}
import com.helio.services.dashboards.DashboardService
import com.helio.services.patchsets.PatchSetPreviewService
import com.helio.services.pipelines.PipelineService
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.testkit.TempDirectorySupport
import com.helio.testsupport.{JsonSchemaValidation, OutputHistoryFixtures, TwoUserRlsApiFixture}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID

/** HEL-1785: the assistant's workspace context, search, resource detail and patch-set proposals include dashboards shared
 *  with the caller (a NAMED grant, never a public-only one) with the caller's role, over the NOBYPASSRLS app pool
 *  (`helio_app_test`). Every statement here runs on that pool; each fact is labelled `[HEL-1785 RLS]` and captured to
 *  `.concertino/scratch/HEL-1785/rls-helio-app.txt`.
 *
 *  User roles: A owns, B is the viewer grantee, C the editor grantee or the stranger, per case. The model is never called:
 *  the tool executor is driven directly (the fake-transport rule, C16). */
class WorkspaceSharedDashboardsSpec extends TwoUserRlsApiFixture with OutputHistoryFixtures with TempDirectorySupport {

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  private implicit val typedSys: ActorSystem[Nothing] = system.toTyped

  private var workspaceContext: WorkspaceContextService = _
  private var workspaceSearch: WorkspaceSearchService   = _
  private var previewService: PatchSetPreviewService    = _

  override def beforeAll(): Unit = {
    super.beforeAll()
    val dashboardRepo  = new DashboardRepository(ctx)
    val panelRepo      = new PanelRepository(ctx)
    val dataSourceRepo = new DataSourceRepository(ctx)
    val permissionRepo = new ResourcePermissionRepository(ctx)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
    val stepRepo       = new PipelineStepRepository(ctx)
    val outputRepo     = new OutputRepository(ctx)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel", id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline", id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker     = new AccessCheckerImpl(permissionRepo, registry)
    val dataSourceService = new DataSourceService(dataSourceRepo, new LocalFileSystem(newTempDir("hel1785")))
    val dashboardService  = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    val pipelineService = new PipelineService(
      pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo,
      sourceService = new SourceService(dataSourceRepo, connector = null), dataSourceService = dataSourceService
    )
    workspaceContext = new WorkspaceContextService(dashboardService, dataSourceService, outputRepo, pipelineService, None, None, Some(panelRepo))
    workspaceSearch  = new WorkspaceSearchService(dashboardService, dataSourceService, outputRepo, pipelineService, workspaceContext)
    previewService   = new PatchSetPreviewService(panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, stepRepo, accessChecker, outputRepo, null, SourceFetchBudget.default())
  }

  private val contextSchema = JsonSchemaValidation.compile("workspace/workspace-context.schema.json")

  private def log(line: String): Unit = println(s"[HEL-1785 RLS] $line")

  private def reset(): Unit =
    await(privilegedDb.run(sqlu"TRUNCATE dashboards, pipelines, data_sources, resource_permissions CASCADE"))

  private def grant(dashboardId: String, grantee: Option[String], role: String): Unit =
    await(privilegedDb.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', $dashboardId, ${grantee}::uuid, $role, now())"""
    ))

  private def seedTextPanel(dashboardId: String, owner: String, title: String = "Orig"): String = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id)
             VALUES ($id, $dashboardId, $title, $owner, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}', 'text', $owner::uuid)"""
    ))
    id
  }

  private def seedOutputPanel(dashboardId: String, owner: String, outputId: String): String = {
    val id = UUID.randomUUID().toString
    await(privilegedDb.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
             VALUES ($id, $dashboardId, 'Bound', $owner, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}', 'output', $outputId, $owner::uuid)"""
    ))
    id
  }

  private def user(id: String): AuthenticatedUser = AuthenticatedUser(UserId(id))

  /** `(name, accessRole, panelCount)` of the context's dashboards, read off the wire JSON. */
  private def contextDashboards(u: String): Vector[(String, Option[String], Int)] = {
    val json = workspaceContextJson(await(workspaceContext.assemble(user(u))))
    json.fields("dashboards").asInstanceOf[JsArray].elements.map(_.asJsObject).map { d =>
      (d.fields("name").convertTo[String], d.fields.get("accessRole").map(_.convertTo[String]), d.fields("panelCount").convertTo[Int])
    }
  }

  private def contextDashboardCount(u: String): Int =
    workspaceContextJson(await(workspaceContext.assemble(user(u)))).fields("counts").asJsObject.fields("dashboards").convertTo[Int]

  private def workspaceContextJson(r: WorkspaceContextResponse): JsObject = {
    r.toJson.asJsObject
  }

  private def findDashboards(u: String, query: String): Vector[(String, String)] =
    await(workspaceSearch.find(user(u), query, Some(Set(WorkspaceResourceType.Dashboard)))).map(s => s.name -> s.description)

  private def executorFor(u: String): AssistantToolExecutor =
    new AssistantToolExecutor(workspaceSearch, null, null, null, null, previewService, null, user(u))

  private def renameInput(panelId: String, title: String): JsValue =
    JsObject("edits" -> JsArray(JsObject(
      "target" -> JsObject("kind" -> JsString("panel"), "id" -> JsString(panelId)),
      "op"     -> JsString("update"),
      "patch"  -> JsObject("title" -> JsString(title))
    )))

  private def deleteDashboardInput(dashboardId: String): JsValue =
    JsObject("edits" -> JsArray(JsObject(
      "target" -> JsObject("kind" -> JsString("dashboard"), "id" -> JsString(dashboardId)),
      "op"     -> JsString("delete")
    )))

  "the workspace context" should {

    "list a shared dashboard with the caller's role and real panel count, and count the union" in {
      reset()
      seedDashboard(userB, "B owned")
      val viewerDash = seedDashboard(userA, "A to B viewer")
      val editorDash = seedDashboard(userA, "A to B editor")
      val publicOnly = seedDashboard(userA, "A public only")
      seedDashboard(userA, "A private")
      seedTextPanel(viewerDash, userA); seedTextPanel(viewerDash, userA)
      grant(viewerDash, Some(userB), "viewer")
      grant(editorDash, Some(userB), "editor")
      grant(publicOnly, None, "viewer")

      val seen = contextDashboards(userB)
      log(s"(1) role=helio_app_test assemble viewer/editor-grantee B: $seen counts.dashboards=${contextDashboardCount(userB)}")
      seen.map(d => d._1 -> d._2).toMap shouldBe Map(
        "B owned" -> Some("owner"), "A to B viewer" -> Some("viewer"), "A to B editor" -> Some("editor")
      )
      seen.find(_._1 == "A to B viewer").get._3 shouldBe 2
      contextDashboardCount(userB) shouldBe 3
    }

    "show a stranger none of another user's dashboards, and the owner only the owner role" in {
      reset()
      val d = seedDashboard(userA, "A board")
      grant(d, Some(userB), "viewer")
      log(s"(1) role=helio_app_test assemble stranger C=${contextDashboards(userC)} owner A=${contextDashboards(userA)}")
      contextDashboards(userC) shouldBe empty
      contextDashboardCount(userC) shouldBe 0
      contextDashboards(userA).map(x => x._1 -> x._2) shouldBe Vector("A board" -> Some("owner"))
    }

    "list a dashboard once, as owner, when its owner also holds a grant row on it" in {
      reset()
      val d = seedDashboard(userA, "A self-granted")
      grant(d, Some(userA), "viewer")
      contextDashboards(userA).map(x => x._1 -> x._2) shouldBe Vector("A self-granted" -> Some("owner"))
      contextDashboardCount(userA) shouldBe 1
    }

    "put accessRole on the wire of GET /api/workspace/context, validated against the schema (seam)" in {
      reset()
      val d = seedDashboard(userA, "A to B")
      grant(d, Some(userB), "viewer")
      req(HttpMethods.GET, "/api/workspace/context", userB) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val raw = responseAs[String]
        JsonSchemaValidation.validationErrors(contextSchema, raw) shouldBe Vector.empty
        val dashboards = raw.parseJson.asJsObject.fields("dashboards").asInstanceOf[JsArray].elements.map(_.asJsObject)
        dashboards.map(x => x.fields("name").convertTo[String] -> x.fields.get("accessRole").map(_.convertTo[String])) shouldBe
          Vector("A to B" -> Some("viewer"))
      }
    }
  }

  "the assistant's find" should {
    "return a shared dashboard stating the caller's role, and nothing for a stranger or a public-only dashboard" in {
      reset()
      val viewerDash = seedDashboard(userA, "Quarterly standings")
      val editorDash = seedDashboard(userA, "Quarterly roster")
      val publicOnly = seedDashboard(userA, "Quarterly public")
      grant(viewerDash, Some(userB), "viewer")
      grant(editorDash, Some(userB), "editor")
      grant(publicOnly, None, "viewer")

      val seen = findDashboards(userB, "Quarterly").toMap
      log(s"(2) role=helio_app_test find viewer/editor-grantee B: $seen stranger C=${findDashboards(userC, "Quarterly")}")
      seen.keySet shouldBe Set("Quarterly standings", "Quarterly roster")
      seen("Quarterly standings") should include("viewer")
      seen("Quarterly standings") should include("read-only")
      seen("Quarterly roster") should include("editor")
      seen("Quarterly roster") should not include "read-only"
      findDashboards(userC, "Quarterly") shouldBe empty
      findDashboards(userA, "Quarterly").size shouldBe 3
    }
  }

  "the assistant's get_resource" should {
    "give a viewer the shared dashboard's panels with its role and no Output pipeline id" in {
      reset()
      val (_, outputId) = seedPipelineWithOutput(userA)
      val dash          = seedDashboard(userA, "Shared board")
      val panel         = seedOutputPanel(dash, userA, outputId)
      grant(dash, Some(userB), "viewer")

      val detail = await(workspaceSearch.getResource(user(userB), dash, WorkspaceResourceType.Dashboard))
      detail shouldBe a[Right[_, _]]
      val body = detail.toOption.get.toJson.asJsObject
      val panels = body.fields("panels").asInstanceOf[JsArray].elements.map(_.asJsObject)
      log(s"(3) role=helio_app_test getResource(Dashboard) viewer: accessRole=${body.fields.get("accessRole")} " +
        s"panels=${panels.map(p => p.fields("id").convertTo[String] -> p.fields.get("outputPipelineId"))}")
      body.fields.get("accessRole") shouldBe Some(JsString("viewer"))
      panels.map(_.fields("id").convertTo[String]) shouldBe Vector(panel)
      panels.head.fields("outputId") shouldBe JsString(outputId)
      panels.head.fields.get("outputPipelineId") shouldBe None
    }

    "not find a dashboard for a stranger or one visible only through a public grant" in {
      reset()
      val priv       = seedDashboard(userA, "Private")
      val publicOnly = seedDashboard(userA, "Public only")
      grant(publicOnly, None, "viewer")
      val ra = await(workspaceSearch.getResource(user(userC), priv, WorkspaceResourceType.Dashboard))
      val rb = await(workspaceSearch.getResource(user(userC), publicOnly, WorkspaceResourceType.Dashboard))
      log(s"(3) role=helio_app_test getResource(Dashboard) stranger private=$ra public-only=$rb")
      ra shouldBe a[Left[_, _]]
      rb shouldBe a[Left[_, _]]
    }

    "not return the bound Output to a dashboard-only viewer or editor" in {
      reset()
      val (_, outputId) = seedPipelineWithOutput(userA)
      val dash          = seedDashboard(userA, "Shared board")
      seedOutputPanel(dash, userA, outputId)
      grant(dash, Some(userB), "viewer")
      grant(dash, Some(userC), "editor")
      val v = await(workspaceSearch.getResource(user(userB), outputId, WorkspaceResourceType.DataType))
      val e = await(workspaceSearch.getResource(user(userC), outputId, WorkspaceResourceType.DataType))
      val o = await(workspaceSearch.getResource(user(userA), outputId, WorkspaceResourceType.DataType))
      log(s"(4) role=helio_app_test getResource(DataType) viewer=${v.isRight} editor=${e.isRight} pipeline-owner=${o.isRight}")
      v shouldBe a[Left[_, _]]
      e shouldBe a[Left[_, _]]
      o shouldBe a[Right[_, _]]
    }
  }

  "propose_patch_set through the tool executor" should {
    "refuse a viewer's panel rename with the view-only message and capture no proposal" in {
      reset()
      val dash  = seedDashboard(userA, "Shared board")
      val panel = seedTextPanel(dash, userA)
      grant(dash, Some(userB), "viewer")
      val toolExec = executorFor(userB)
      val result   = await(toolExec.execute("propose_patch_set", renameInput(panel, "Renamed")))
      log(s"(5) role=helio_app_test viewer rename panel -> $result proposal=${toolExec.proposal}")
      result shouldBe a[Left[_, _]]
      result.left.toOption.get should include("view-only access")
      toolExec.proposal shouldBe None
    }

    "accept an editor's panel rename" in {
      reset()
      val dash  = seedDashboard(userA, "Shared board")
      val panel = seedTextPanel(dash, userA)
      grant(dash, Some(userC), "editor")
      val toolExec = executorFor(userC)
      val result   = await(toolExec.execute("propose_patch_set", renameInput(panel, "Renamed")))
      log(s"(5) role=helio_app_test editor rename panel -> ${result.map(_.take(80))} proposal=${toolExec.proposal.isDefined}")
      result shouldBe a[Right[_, _]]
      toolExec.proposal should not be empty
    }

    "refuse an editor's dashboard delete with the owner-only message and capture no proposal" in {
      reset()
      val dash = seedDashboard(userA, "Shared board")
      grant(dash, Some(userC), "editor")
      val toolExec = executorFor(userC)
      val result   = await(toolExec.execute("propose_patch_set", deleteDashboardInput(dash)))
      log(s"(5) role=helio_app_test editor delete dashboard -> $result proposal=${toolExec.proposal}")
      result shouldBe a[Left[_, _]]
      result.left.toOption.get should include("Only the dashboard's owner can delete it")
      toolExec.proposal shouldBe None
    }

    "refuse a viewer's dashboard delete with the owner-only message" in {
      reset()
      val dash = seedDashboard(userA, "Shared board")
      grant(dash, Some(userB), "viewer")
      val toolExec = executorFor(userB)
      val result   = await(toolExec.execute("propose_patch_set", deleteDashboardInput(dash)))
      result shouldBe a[Left[_, _]]
      result.left.toOption.get should include("Only the dashboard's owner can delete it")
      toolExec.proposal shouldBe None
    }

    "refuse a viewer's panel create and panel delete with the view-only message" in {
      reset()
      val dash  = seedDashboard(userA, "Shared board")
      val panel = seedTextPanel(dash, userA)
      grant(dash, Some(userB), "viewer")
      val del = JsObject("edits" -> JsArray(JsObject(
        "target" -> JsObject("kind" -> JsString("panel"), "id" -> JsString(panel)), "op" -> JsString("delete")
      )))
      val toolExec = executorFor(userB)
      val result   = await(toolExec.execute("propose_patch_set", del))
      result shouldBe a[Left[_, _]]
      result.left.toOption.get should include("view-only access")
      toolExec.proposal shouldBe None
    }
  }

  "the REST refusals a write tool reaches" should {
    def body(): String = responseAs[String].parseJson.asJsObject.fields("message").convertTo[String]

    "name the view-only reason for a viewer's dashboard and panel writes, with status 403" in {
      reset()
      val dash  = seedDashboard(userA, "Shared board")
      val panel = seedTextPanel(dash, userA)
      grant(dash, Some(userB), "viewer")
      req(HttpMethods.PATCH, s"/api/dashboards/$dash", userB, Some("""{"name":"X"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden; body() shouldBe "You have view-only access to this dashboard"
      }
      req(HttpMethods.PATCH, s"/api/panels/$panel", userB, Some("""{"title":"X"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden; body() shouldBe "You have view-only access to this dashboard"
      }
      req(HttpMethods.DELETE, s"/api/panels/$panel", userB) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden; body() shouldBe "You have view-only access to this dashboard"
      }
    }

    "name the owner-only reason for a non-owner's dashboard delete, with status 403" in {
      reset()
      val dash = seedDashboard(userA, "Shared board")
      grant(dash, Some(userC), "editor")
      grant(dash, Some(userB), "viewer")
      Seq(userB, userC).foreach { u =>
        req(HttpMethods.DELETE, s"/api/dashboards/$dash", u) ~> routes ~> check {
          status shouldBe StatusCodes.Forbidden; body() shouldBe "Only the dashboard's owner can delete it"
        }
      }
    }
  }

  "the assistant's system prompt" should {
    "carry the shared-dashboard role rule" in {
      val text = AssistantSystemPrompt.text
      text should include("accessRole")
      text should include("viewer: the dashboard is read-only")
      text should include("never propose deleting the dashboard")
    }
  }
}
