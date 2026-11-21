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

import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.{JournaledCreatedChildren, JournaledEdit, journaledEditFormat}

import java.time.Instant
import java.util.UUID
import scala.jdk.CollectionConverters._

/** HEL-1795: undoing a patch set that created a pipeline (or pipeline step) is refused (409, nothing restored) when it
 *  would delete an Output or step the patch set did not create. Runs on the `helio_app_test` NOBYPASSRLS role. */
class PatchSetUndoLaterOutputsSpec extends AssistantStandingsFixture {

  import PostgresProfile.api._

  private var appDb: JdbcBackend.Database        = _
  private var privDb: JdbcBackend.Database       = _
  private var appPanels: PanelService            = _
  private var appDashboards: DashboardService    = _
  private var appApply: PatchSetApplyService     = _
  private var appUndo: PatchSetUndoService       = _
  private var appPanelRepo: PanelRepository      = _
  private var appOutputs: OutputService          = _
  private var appApplicationRepo: PatchSetApplicationRepository = _
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
    appApplicationRepo = appAppRepo
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => appPanelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dsRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipeRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val checker = new AccessCheckerImpl(permRepo, registry)
    val fs      = new LocalFileSystem(newTempDir("hel1795"))
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


  private def set(json: String): PatchSet = json.parseJson.convertTo[PatchSet]

  private def applied(ps: PatchSet, user: AuthenticatedUser = owner) = {
    val response = await(appApply.apply(ps, user)).getOrElse(fail("apply refused"))
    response.failure shouldBe None
    response
  }

  private def outputExists(id: String): Boolean = await(outputRepo.findByIdInternal(OutputId(id))).isDefined

  "the app role" should {
    "not bypass RLS" in {
      await(appDb.run(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe false
    }
  }

  "undoing a patch set that created a pipeline" should {
    "refuse, changing nothing, when an editor added an Output to it" in {
      val s = seedStandings(suffix = " hel1795 red")
      val response = applied(set(s"""{"edits":[{"target":{"kind":"pipeline"},"op":"create","patch":{"name":"Set pipeline 1795","roots":[{"sourceId":"${s.rostersSourceId}"}],"steps":[],"outputs":[]}}]}"""))
      val pipelineId = response.edits.head.newId.get
      grantRole("pipeline", pipelineId, otherIdStr, "editor")
      val bOutput = await(appOutputs.create(PipelineId(pipelineId), CreateOutputRequest(None, "table", "B's output", None), otherUser)) match {
        case Right((o, _)) => o
        case Left(e)       => fail(s"B could not create an Output on A's pipeline: $e")
      }
      val result = await(appUndo.undo(PatchSetApplicationId(response.applicationId.get), owner))
      withClue(s"undo result: $result; ") {
        result match {
          case Left(ServiceError.Conflict(msg)) => msg should include("B's output")
          case other                            => fail(s"expected a Conflict, got $other")
        }
      }
      withClue("B's Output must survive A's undo: ") { outputExists(bOutput.id.value) shouldBe true }
      await(pipelineRepo.findByIdInternal(PipelineId(pipelineId))).isDefined shouldBe true
    }
  }

  // ---- D5 coverage -------------------------------------------------------------------------------------------------

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

  private val limitCfg = JsObject("count" -> JsNumber(1))

  private def pipelineSet(s: Standings, name: String, steps: String = "[]", outputs: String = "[]"): PatchSet =
    set(s"""{"edits":[{"target":{"kind":"pipeline"},"op":"create","patch":{"name":"$name","roots":[{"sourceId":"${s.rostersSourceId}"}],"steps":$steps,"outputs":$outputs}}]}""")

  private def refusalOf(applicationId: String, user: AuthenticatedUser = owner): String =
    await(appUndo.undo(PatchSetApplicationId(applicationId), user)) match {
      case Left(ServiceError.Conflict(msg)) => msg
      case other                            => fail(s"expected a Conflict, got $other")
    }

  private def addOutput(pipelineId: String, name: String, user: AuthenticatedUser, step: Option[String] = None): Output =
    await(appOutputs.create(PipelineId(pipelineId), CreateOutputRequest(step, "table", name, None), user)) match {
      case Right((o, _)) => o
      case Left(e)       => fail(s"Output create failed: $e")
    }

  private def stepExists(id: String): Boolean = await(pipelineStepRepo.findByIdInternal(PipelineStepId(id))).isDefined
  private def pipelineExists(id: String): Boolean = await(pipelineRepo.findByIdInternal(PipelineId(id))).isDefined

  private def journaled(applicationId: String): Vector[JournaledEdit] =
    await(appApplicationRepo.findById(PatchSetApplicationId(applicationId), owner)).getOrElse(fail("application missing")).edits

  "a pipeline create undo (later additions)" should {
    "refuse a later Output the applying user added, naming it and no id" in {
      val s = seedStandings(suffix = " hel1795 same-user")
      val r = applied(pipelineSet(s, "Same-user pipeline 1795"))
      val pid = r.edits.head.newId.get
      val o = addOutput(pid, "Same-user later output", owner)
      val msg = refusalOf(r.applicationId.get)
      msg should include("edit 0 (pipeline create): 1 Output(s) were added after the patch set was applied")
      msg should include("Output \"Same-user later output\"")
      msg should not include o.id.value
      msg should not include pid
      outputExists(o.id.value) shouldBe true
      pipelineExists(pid) shouldBe true
    }

    "refuse a later step added by the applying user, and one added by an editor, describing it without an id" in {
      val s = seedStandings(suffix = " hel1795 step")
      val r = applied(pipelineSet(s, "Step pipeline 1795"))
      val pid = r.edits.head.newId.get
      grantRole("pipeline", pid, otherIdStr, "editor")
      val mine = await(appPipelines.addStep(PipelineId(pid), CreatePipelineStepRequest("limit", limitCfg), owner)).getOrElse(fail("A addStep failed"))
      val msg = refusalOf(r.applicationId.get)
      msg should include("1 pipeline step(s) were added after the patch set was applied")
      msg should include("limit step at position")
      msg should not include mine.id
      // an editor can add a step too (task 1.1 probe)
      val theirs = await(appPipelines.addStep(PipelineId(pid), CreatePipelineStepRequest("limit", limitCfg, attachAsTail = Some(true)), otherUser)).getOrElse(fail("editor addStep failed"))
      refusalOf(r.applicationId.get) should include("2 pipeline step(s)")
      stepExists(mine.id) shouldBe true
      stepExists(theirs.id) shouldBe true
      pipelineExists(pid) shouldBe true
    }

    "undo cleanly when the pipeline holds only the steps and Outputs the create itself made (createdChildren excusal)" in {
      val s = seedStandings(suffix = " hel1795 inline")
      val r = applied(pipelineSet(
        s, "Inline pipeline 1795",
        steps = """[{"clientId":"s1","type":"limit","config":{"count":1}}]""",
        outputs = """[{"nodeStepClientId":"s1","kind":"table","name":"Inline out"}]"""
      ))
      val pid = r.edits.head.newId.get
      val children = journaled(r.applicationId.get).head.createdChildren.getOrElse(fail("createdChildren not journaled"))
      children.stepIds should have size 1
      children.outputIds should have size 1
      await(appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).isRight shouldBe true
      pipelineExists(pid) shouldBe false
      outputExists(children.outputIds.head) shouldBe false
    }

    "refuse with the step, the Output and a panel in one message, joined with `; `" in {
      val s = seedStandings(suffix = " hel1795 combined")
      val r = applied(pipelineSet(s, "Combined pipeline 1795"))
      val pid = r.edits.head.newId.get
      await(appPipelines.addStep(PipelineId(pid), CreatePipelineStepRequest("limit", limitCfg), owner)).getOrElse(fail("addStep failed"))
      val o = addOutput(pid, "Combined later output", owner)
      val panel = await(appPanels.create(
        CreatePanelRequest(Some(s.dashboardId), Some("Combined panel"), Some("output"), Some(JsObject("outputId" -> JsString(o.id.value)))), owner
      )) match { case Right((p, _)) => p; case Left(e) => fail(s"panel create failed: $e") }
      val msg = refusalOf(r.applicationId.get)
      msg.split("; ").count(_.startsWith("edit 0 (pipeline create)")) shouldBe 3
      msg should include("\"Combined panel\" on dashboard")
      msg should include("Output \"Combined later output\"")
      msg should include("pipeline step(s)")
      outputExists(o.id.value) shouldBe true
      await(panelRepo.findByIdInternal(panel.id)).isDefined shouldBe true
    }

    "report the edit failed, deleting nothing, when an Output lands after the Phase-1 check (the pre-delete re-check)" in {
      val s = seedStandings(suffix = " hel1795 recheck")
      // edit 0 creates the pipeline, edit 1 a dashboard: the reverse walk undoes the dashboard first, then the pipeline
      val r = applied(set(s"""{"edits":[
        {"target":{"kind":"pipeline"},"op":"create","patch":{"name":"Rechecked pipeline 1795","roots":[{"sourceId":"${s.rostersSourceId}"}],"steps":[],"outputs":[]}},
        {"target":{"kind":"dashboard"},"op":"create","patch":{"name":"Rechecked board 1795"}}
      ]}"""))
      val pid = r.edits.head.newId.get
      val dashboardId = r.edits(1).newId.get
      val holder = embeddedPostgres.getPostgresDatabase.getConnection
      var laterOutputId = ""
      try {
        holder.setAutoCommit(false)
        holder.createStatement().execute(s"SELECT 1 FROM dashboards WHERE id = '$dashboardId' FOR UPDATE")
        val undoing = appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)
        Thread.sleep(1500)
        undoing.isCompleted shouldBe false
        laterOutputId = await(outputRepo.insertInternal(PipelineId(pid), None, owner.id, "Landed late", OutputKind.Table, explicitRootId = None)).id.value
        val logs = errorLogsDuring {
          holder.rollback()
          await(undoing).getOrElse(fail("expected an outcome list, not a refusal")).edits.map(_.status) shouldBe Vector("failed", "restored")
        }
        val reason = logs.find(_.contains("undo restore failed")).getOrElse(fail(s"no ERROR log: $logs"))
        reason should include("1 Output(s), pipeline step(s), alert rule(s), schedule(s) or root(s) were added during the undo; nothing further was undone")
        reason should not include "Landed late"
        reason should not include laterOutputId
      } finally holder.close()
      outputExists(laterOutputId) shouldBe true
      pipelineExists(pid) shouldBe true
    }
  }

  "a pipelineStep create undo (later additions)" should {
    "refuse a later Output on the created step, and a later descendant step, leaving everything" in {
      val s = seedStandings(suffix = " hel1795 stepcreate")
      val r = applied(set(s"""{"edits":[{"target":{"kind":"pipelineStep","parentId":"${s.pipelineId}"},"op":"create","patch":{"type":"limit","config":{"count":1}}}]}"""))
      val stepId = r.edits.head.newId.get
      val o = addOutput(s.pipelineId, "On created step", owner, Some(stepId))
      val msg = refusalOf(r.applicationId.get)
      msg should include("edit 0 (pipelineStep create): 1 Output(s) were added after the patch set was applied")
      msg should include("Output \"On created step\"")
      outputExists(o.id.value) shouldBe true
      stepExists(stepId) shouldBe true

      // a descendant step (the non-promoted tail) is refused too
      // (the head child is promoted into the deleted step's slot and survives; the tail child is removed with the step)
      def child(tail: Boolean) = await(appPipelines.addStep(PipelineId(s.pipelineId), CreatePipelineStepRequest("limit", limitCfg, parentStepId = Some(stepId), attachAsTail = Some(tail).filter(identity)), owner)).getOrElse(fail("child addStep failed")).id
      val (c1, c2) = (child(tail = false), child(tail = true))
      val removed = await(pipelineStepRepo.removedByDeleteInternal(PipelineStepId(stepId))) - stepId
      removed should have size 1
      refusalOf(r.applicationId.get) should include("1 pipeline step(s) were added after the patch set was applied")
      stepExists(c1) shouldBe true
      stepExists(c2) shouldBe true
    }
  }

  "the Output/step excusal rules" should {
    "excuse the ids of same-set output and pipelineStep create edits (defensive; not reachable through apply)" in {
      val s = seedStandings(suffix = " hel1795 defensive")
      val r = applied(pipelineSet(s, "Defensive pipeline 1795"))
      val pid = r.edits.head.newId.get
      val o = addOutput(pid, "Pretend set output", owner)
      val st = await(appPipelines.addStep(PipelineId(pid), CreatePipelineStepRequest("limit", limitCfg), owner)).getOrElse(fail("addStep failed"))
      val pipelineEdit = journaled(r.applicationId.get).head
      val fake = Vector(
        pipelineEdit,
        JournaledEdit(1, "output", "create", None, None, Some(o.id.value), None),
        JournaledEdit(2, "pipelineStep", "create", None, None, Some(st.id), None)
      )
      val later = await(PatchSetUndoLaterChildren.blocking(pipelineEdit, fake, Instant.now(), owner, appUndo.context))
      later.isEmpty shouldBe true
      await(PatchSetUndoLaterChildren.blocking(pipelineEdit, Vector(pipelineEdit), Instant.now(), owner, appUndo.context)).size shouldBe 2
    }

    "fall back, for a row with no createdChildren, to: applier-owned and created at or before appliedAt" in {
      val s = seedStandings(suffix = " hel1795 legacy")
      val r = applied(pipelineSet(
        s, "Legacy pipeline 1795",
        steps = """[{"clientId":"s1","type":"limit","config":{"count":1}}]""",
        outputs = """[{"nodeStepClientId":"s1","kind":"table","name":"Legacy inline out"}]"""
      ))
      val pid = r.edits.head.newId.get
      val record = await(appApplicationRepo.findById(PatchSetApplicationId(r.applicationId.get), owner)).get
      val legacy = record.edits.head.copy(createdChildren = None)
      def blocked() = await(PatchSetUndoLaterChildren.blocking(legacy, Vector(legacy), record.appliedAt, owner, appUndo.context))
      blocked().isEmpty shouldBe true // the inline rows predate appliedAt and belong to the applier
      grantRole("pipeline", pid, otherIdStr, "editor")
      val theirs = addOutput(pid, "Legacy editor output", otherUser)
      blocked().outputs.map(_.id.value) shouldBe Vector(theirs.id.value) // another user's Output is never excused
      val mine = addOutput(pid, "Legacy later same-user", owner)
      blocked().outputs.map(_.id.value).toSet shouldBe Set(theirs.id.value, mine.id.value) // created after appliedAt
      val st = await(appPipelines.addStep(PipelineId(pid), CreatePipelineStepRequest("limit", limitCfg, attachAsTail = Some(true)), owner)).getOrElse(fail("addStep failed"))
      blocked().steps.map(_.id.value) shouldBe Vector(st.id)
    }

    "journal createdChildren as an optional field: an old-shape row parses, a row with the field round-trips" in {
      val old = """{"index":0,"targetKind":"pipeline","op":"create","newId":"p1"}""".parseJson.convertTo[JournaledEdit]
      old.createdChildren shouldBe None
      val withField = old.copy(createdChildren = Some(JournaledCreatedChildren(Vector("s1"), Vector("o1"))))
      val json = withField.toJson
      json.asJsObject.fields("createdChildren").asJsObject.fields("stepIds") shouldBe JsArray(JsString("s1"))
      json.convertTo[JournaledEdit] shouldBe withField
    }
  }
}
