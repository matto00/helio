package com.helio.services.patchsets

import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.pipelines.{CreateOutputRequest, CreatePipelineStepRequest}
import com.helio.services.ServiceError
import com.helio.api.protocols.patchsets.PatchSet
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.{OutputService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.testsupport.AssistantStandingsFixture
import ch.qos.logback.classic.{Level, Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.slf4j.LoggerFactory
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.jdk.CollectionConverters._

/** HEL-1720: undoing a patch set that created an Output, pipeline step, pipeline or dashboard is refused (409, nothing
 *  restored) when it would delete a panel the patch set did not create, including another user's panel (AC: "undo never
 *  silently deletes a panel created after the patch was applied, or a panel another user owns"). Born red in 0167f9d0e.
 *
 *  Every service under test runs on the `helio_app_test` NOBYPASSRLS role (two-pool `DbContext`, as in
 *  `FormSubmitEditorRlsSpec`), so the cross-tenant delete is proven on the app role, not only a superuser. The
 *  Standings seed itself is written by the fixture's superuser services. */
class PatchSetUndoBoundOutputPanelsSpec extends AssistantStandingsFixture {

  import PostgresProfile.api._

  private var appDb: JdbcBackend.Database        = _
  private var privDb: JdbcBackend.Database       = _
  private var appPanels: PanelService            = _
  private var appDashboards: DashboardService    = _
  private var appApply: PatchSetApplyService     = _
  private var appUndo: PatchSetUndoService       = _
  private var appPanelRepo: PanelRepository      = _
  private var appOutputs: OutputService          = _
  private var appPipelines: PipelineService      = _

  override def beforeAll(): Unit = {
    super.beforeAll()
    val superDs = embeddedPostgres.getPostgresDatabase
    val conn = superDs.getConnection
    try {
      val stmt = conn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally conn.close()

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs); privCfg.setMaximumPoolSize(5); privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))
    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs); appCfg.setMaximumPoolSize(5); appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    val ctx            = new DbContext(appDb, privDb)
    val dashRepo       = new DashboardRepository(ctx)
    appPanelRepo       = new PanelRepository(ctx)
    val dsRepo         = new DataSourceRepository(ctx)
    val permRepo       = new ResourcePermissionRepository(ctx)
    val pipeRepo       = new PipelineRepository(ctx, dsRepo)
    val stepRepo       = new PipelineStepRepository(ctx)
    val outRepo        = new OutputRepository(ctx)
    val appAppRepo     = new PatchSetApplicationRepository(ctx)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => appPanelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dsRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipeRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val checker = new AccessCheckerImpl(permRepo, registry)
    val fs      = new LocalFileSystem(newTempDir("hel1720"))
    appDashboards = new DashboardService(dashRepo, checker, outputRepo = outRepo)
    appPanels     = new PanelService(appPanelRepo, checker, dashRepo, outputRepo = outRepo)
    val dsService   = new DataSourceService(dsRepo, fs)
    val pipeService = new PipelineService(pipeRepo, stepRepo, dsRepo, outputRepo = outRepo)
    val outService  = new OutputService(outRepo, appPanelRepo, checker)
    appOutputs   = outService
    appPipelines = pipeService
    appApply = new PatchSetApplyService(
      appPanels, appDashboards, dsService, pipeService, appPanelRepo, dashRepo, dsRepo, pipeRepo, stepRepo, checker, appAppRepo, outRepo, outService
    )
    appUndo = new PatchSetUndoService(
      appPanels, appDashboards, dsService, pipeService, appPanelRepo, dashRepo, dsRepo, pipeRepo, stepRepo, appAppRepo, outputRepo = outRepo
    )
  }

  override def afterAll(): Unit = {
    appDb.close(); privDb.close()
    super.afterAll()
  }

  private def outputCreateSet(s: Standings): PatchSet =
    s"""{"summary":"table","edits":[
      {"target":{"kind":"output","parentId":"${s.pipelineId}"},"op":"create",
       "patch":{"name":"Created by A","kind":"table","nodeStepId":"${s.computeStepId}"}}
    ]}""".parseJson.convertTo[PatchSet]

  private def set(json: String): PatchSet = json.parseJson.convertTo[PatchSet]

  private def applied(ps: PatchSet, user: AuthenticatedUser = owner) = {
    val response = await(appApply.apply(ps, user)).getOrElse(fail("apply refused"))
    response.failure shouldBe None
    response
  }

  /** A applies a set creating an Output; returns its id and the application id. */
  private def applyAsA(s: Standings): (String, String) = {
    val response = applied(outputCreateSet(s))
    (response.edits.head.newId.getOrElse(fail("no output id")), response.applicationId.getOrElse(fail("not journaled")))
  }

  private def bindPanel(dashboardId: String, outputId: String, user: AuthenticatedUser, title: String = "Bound later"): PanelId =
    await(appPanels.create(
      CreatePanelRequest(Some(dashboardId), Some(title), Some("output"), Some(JsObject("outputId" -> JsString(outputId)))),
      user
    )) match {
      case Right((p, _)) => p.id
      case Left(e)       => fail(s"binding a panel through PanelService.create failed: $e")
    }

  /** Runs `body` while capturing what `PatchSetUndoService` logs; returns the ERROR messages. */
  private def errorLogsDuring(body: => Unit): Vector[String] = {
    val logger   = LoggerFactory.getLogger(classOf[PatchSetUndoService]).asInstanceOf[LogbackLogger]
    val appender = new ListAppender[ILoggingEvent]
    appender.start()
    logger.addAppender(appender)
    try body
    finally { logger.detachAppender(appender); appender.stop() }
    appender.list.asScala.filter(_.getLevel == Level.ERROR).map(_.getFormattedMessage).toVector
  }

  private def panelExists(id: PanelId): Boolean = await(panelRepo.findByIdInternal(id)).isDefined
  private def outputExists(id: String): Boolean = await(outputRepo.findByIdInternal(OutputId(id))).isDefined

  private def refusal(applicationId: String): String =
    await(appUndo.undo(PatchSetApplicationId(applicationId), owner)) match {
      case Left(ServiceError.Conflict(msg)) => msg
      case other                            => fail(s"expected the undo to be refused with a Conflict, got $other")
    }

  "undoing a patch set that created an Output" should {

    "refuse, and delete nothing, when another user (an editor grantee) duplicated a panel bound to it" in {
      // B cannot bind an Output they do not own (`PanelBindingChecks.rejectMissingOutput`), so the real route to a
      // B-owned panel on A's Output is duplicating A's bound panel on a dashboard A shared with B as editor.
      val s = seedStandings(suffix = " hel1720 two-user")
      val (outputId, applicationId) = applyAsA(s)
      val aPanel = bindPanel(s.dashboardId, outputId, owner, "A later panel")
      grantRole("dashboard", s.dashboardId, otherIdStr, "editor")

      val copy = await(appPanels.duplicate(aPanel, otherUser)) match {
        case Right((p, _)) => p
        case Left(e)       => fail(s"B's PanelService.duplicate failed: $e")
      }
      // setup sanity, so a red run is red for the right reason
      copy.ownerId shouldBe otherUser.id
      copy.id should not be aPanel
      await(db.run(sql"SELECT output_id FROM panels WHERE id = ${copy.id.value}".as[String].head)) shouldBe outputId

      val msg = refusal(applicationId)
      msg should include("A later panel (copy)")
      withClue("B's panel (owned by another user, bound after A applied) must survive A's undo: ") { panelExists(copy.id) shouldBe true }
      panelExists(aPanel) shouldBe true
      outputExists(outputId) shouldBe true
    }

    "refuse when the same user bound a panel to it after the patch was applied" in {
      val s = seedStandings(suffix = " hel1720 same-user")
      val (outputId, applicationId) = applyAsA(s)
      val laterPanel = bindPanel(s.dashboardId, outputId, owner, "Later same-user panel")

      refusal(applicationId) should include("\"Later same-user panel\" on dashboard")
      withClue("a panel created after the patch was applied (not part of the set) must survive the undo: ") { panelExists(laterPanel) shouldBe true }
      outputExists(outputId) shouldBe true
    }

    "still undo cleanly (Output and its own panel removed) when nothing else is bound" in {
      val s = seedStandings(suffix = " hel1720 clean")
      val json =
        s"""{"edits":[
          {"target":{"kind":"output","parentId":"${s.pipelineId}","ref":"w"},"op":"create","patch":{"name":"W","kind":"table","nodeStepId":"${s.computeStepId}"}},
          {"target":{"kind":"panel"},"op":"create","patch":{"dashboardId":"${s.dashboardId}","title":"Own panel","type":"output","config":{"outputId":"$$ref:w"}}}
        ]}"""
      val response = applied(set(json))
      val outputId = response.edits.head.newId.get
      val panelId  = PanelId(response.edits(1).newId.get)
      await(appUndo.undo(PatchSetApplicationId(response.applicationId.get), owner)).isRight shouldBe true
      outputExists(outputId) shouldBe false
      panelExists(panelId) shouldBe false
    }

    "fail that edit (nothing deleted) when a panel bind commits after the Phase-1 check and before the delete" in {
      val s = seedStandings(suffix = " hel1720 window")
      val (outputId, applicationId) = applyAsA(s)
      val panelId = UUID.randomUUID().toString
      val conn = embeddedPostgres.getPostgresDatabase.getConnection
      try {
        conn.setAutoCommit(false)
        val st = conn.createStatement()
        // an UNCOMMITTED bind: invisible to the Phase-1 check, but it holds the FK key-share lock on the Output
        st.execute(
          s"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id, output_id)
             |VALUES ('$panelId', '${s.dashboardId}', 'Raced', '$ownerIdStr', now(), now(),
             |'{"background":"transparent","color":"inherit","transparency":0.0}', 'output', '$ownerIdStr'::uuid, '$outputId')""".stripMargin
        )
        val undoing = appUndo.undo(PatchSetApplicationId(applicationId), owner)
        Thread.sleep(1500)
        undoing.isCompleted shouldBe false // parked on the Output row lock inside the delete
        val logs = errorLogsDuring {
          conn.commit()
          val response = await(undoing).getOrElse(fail("expected an outcome list, not a refusal"))
          response.edits.map(_.status) shouldBe Vector("failed")
        }
        // the Phase-2 reason is a fixed phrase plus a count: no panel id, title or Output id
        val reason = logs.find(_.contains("undo restore failed")).getOrElse(fail(s"no ERROR log for the failed restore: $logs"))
        reason should include("1 panel(s) were bound during the undo; nothing further was undone")
        reason should not include panelId
        reason should not include "Raced"
        reason should not include outputId
      } finally conn.close()
      withClue("the raced panel must survive: ") { panelExists(PanelId(panelId)) shouldBe true }
      outputExists(outputId) shouldBe true
    }
  }

  "undoing the other create arms" should {

    "refuse a dashboard create when a panel the set did not create sits on it" in {
      val s = seedStandings(suffix = " hel1720 dash")
      val response = applied(set("""{"edits":[{"target":{"kind":"dashboard"},"op":"create","patch":{"name":"Set dashboard 1720"}}]}"""))
      val dashboardId = response.edits.head.newId.get
      val panel = bindPanel(dashboardId, s.tableOutputId, owner, "Added to the set dashboard")
      refusal(response.applicationId.get) should include("\"Added to the set dashboard\" on dashboard \"Set dashboard 1720\"")
      panelExists(panel) shouldBe true
    }

    "refuse a pipeline create when a panel the set did not create is bound to one of its Outputs, and count an unreadable one" in {
      val s = seedStandings(suffix = " hel1720 pipe")
      val response = applied(set(s"""{"edits":[{"target":{"kind":"pipeline"},"op":"create","patch":{"name":"Set pipeline 1720","roots":[{"sourceId":"${s.rostersSourceId}"}],"steps":[],"outputs":[]}}]}"""))
      val pipelineId = response.edits.head.newId.get
      grantRole("pipeline", pipelineId, otherIdStr, "editor")
      val bOutput = await(appOutputs.create(PipelineId(pipelineId), CreateOutputRequest(None, "table", "B's output", None), otherUser)) match {
        case Right((o, _)) => o
        case Left(e)       => fail(s"B could not create an Output on A's pipeline: $e")
      }
      val bDashboard = await(appDashboards.create(DashboardService.CreateDashboardInput(Some("B private board")), otherUser))._1
      val bPanel = bindPanel(bDashboard.id.value, bOutput.id.value, otherUser, "B private panel")
      grantRole("dashboard", s.dashboardId, otherIdStr, "editor")
      val aPanel = bindPanel(s.dashboardId, bOutput.id.value, otherUser, "A readable panel") // B's panel, on A's own board

      val msg = refusal(response.applicationId.get)
      msg should include("\"A readable panel\" on dashboard")
      msg should include("1 panel(s) on dashboards you cannot see")
      msg should not include "B private panel"
      msg should not include "B private board"
      msg should not include bPanel.value
      panelExists(bPanel) shouldBe true
      panelExists(aPanel) shouldBe true
    }

    "refuse a pipelineStep create when a panel is bound to an Output on a descendant step the delete would remove" in {
      val s = seedStandings(suffix = " hel1720 step")
      val response = applied(set(s"""{"edits":[{"target":{"kind":"pipelineStep","parentId":"${s.pipelineId}"},"op":"create","patch":{"type":"limit","config":{"count":1}}}]}"""))
      val stepId = response.edits.head.newId.get
      val cfg = JsObject("count" -> JsNumber(1))
      def child(tail: Boolean) = await(appPipelines.addStep(PipelineId(s.pipelineId), CreatePipelineStepRequest("limit", cfg, parentStepId = Some(stepId), attachAsTail = Some(tail).filter(identity)), owner)).getOrElse(fail("addStep failed")).id
      val (c1, c2) = (child(tail = false), child(tail = true))
      // the lowest-(position, id) child is promoted into the deleted step's slot; the other is removed with the step
      val removedSet = await(pipelineStepRepo.removedByDeleteInternal(PipelineStepId(stepId)))
      val (removed, promoted) = if (removedSet.contains(c1)) (c1, c2) else (c2, c1)
      removedSet should contain(removed)
      removedSet should not contain promoted
      val out = await(appOutputs.create(PipelineId(s.pipelineId), CreateOutputRequest(Some(removed), "table", "On removed child", None), owner)) match {
        case Right((o, _)) => o
        case Left(e)       => fail(s"output create failed: $e")
      }
      val panel = bindPanel(s.dashboardId, out.id.value, owner, "On a removed descendant")

      refusal(response.applicationId.get) should include("\"On a removed descendant\" on dashboard")
      panelExists(panel) shouldBe true
      outputExists(out.id.value) shouldBe true
      await(pipelineStepRepo.findByIdInternal(PipelineStepId(removed))).isDefined shouldBe true
      await(pipelineStepRepo.findByIdInternal(PipelineStepId(promoted))).isDefined shouldBe true
      await(pipelineStepRepo.findByIdInternal(PipelineStepId(stepId))).isDefined shouldBe true
    }

    "report the edit failed, deleting nothing, when a panel lands on the dashboard after the Phase-1 check (the pre-delete re-check)" in {
      val s = seedStandings(suffix = " hel1720 recheck")
      // edit 0 creates a dashboard, edit 1 an Output: the reverse walk undoes the Output first, then the dashboard
      val response = applied(set(s"""{"edits":[
        {"target":{"kind":"dashboard"},"op":"create","patch":{"name":"Rechecked board"}},
        {"target":{"kind":"output","parentId":"${s.pipelineId}"},"op":"create","patch":{"name":"Park","kind":"table","nodeStepId":"${s.computeStepId}"}}
      ]}"""))
      val dashboardId = response.edits.head.newId.get
      val outputId    = response.edits(1).newId.get
      val panelId     = UUID.randomUUID().toString
      val holder      = embeddedPostgres.getPostgresDatabase.getConnection
      try {
        holder.setAutoCommit(false)
        // parks the Output delete on its row lock, AFTER the Phase-1 check has passed, without binding anything to it
        holder.createStatement().execute(s"SELECT 1 FROM outputs WHERE id = '$outputId' FOR UPDATE")
        val undoing = appUndo.undo(PatchSetApplicationId(response.applicationId.get), owner)
        Thread.sleep(1500)
        undoing.isCompleted shouldBe false
        // a COMMITTED panel on the set's dashboard, bound to the pre-existing table Output
        await(db.run(sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id, output_id)
          VALUES ($panelId, $dashboardId, 'Landed late', $ownerIdStr, now(), now(),
          '{"background":"transparent","color":"inherit","transparency":0.0}', 'output', $ownerIdStr::uuid, ${s.tableOutputId})"""))
        val logs = errorLogsDuring {
          holder.rollback()
          val outcomes = await(undoing).getOrElse(fail("expected an outcome list, not a refusal")).edits
          outcomes.map(_.status) shouldBe Vector("failed", "restored")
        }
        val reason = logs.find(_.contains("undo restore failed")).getOrElse(fail(s"no ERROR log for the failed restore: $logs"))
        reason should include("1 panel(s) were bound during the undo; nothing further was undone")
        reason should not include panelId
        reason should not include "Landed late"
      } finally holder.close()
      withClue("the late panel and the dashboard must survive: ") { panelExists(PanelId(panelId)) shouldBe true }
      await(dashboardRepo.findByIdInternal(DashboardId(dashboardId))).isDefined shouldBe true
      outputExists(outputId) shouldBe false
    }
  }
}
