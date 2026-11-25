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
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineScheduleRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.alerts.AlertRuleRepository
import com.helio.services.alerts.AlertRuleService
import com.helio.services.pipelines.PipelineScheduleService
import com.helio.api.protocols.alerts.CreateAlertRuleRequest
import com.helio.api.protocols.pipelines.{CreatePipelineRootRequest, PutPipelineScheduleRequest}
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

/** HEL-1811: undoing a patch set that created a pipeline, step or Output is refused (409, nothing restored) when it
 *  would delete an alert rule, a schedule or a root the patch set did not create. Runs on the `helio_app_test` NOBYPASSRLS role. */
class PatchSetUndoLaterAlertRulesSpec extends AssistantStandingsFixture {

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
  private var appAlerts: AlertRuleService        = _
  private var appSchedules: PipelineScheduleService = _
  private var appCtx: DbContext                  = _

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
    appCtx             = ctx
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
    val fs      = new LocalFileSystem(newTempDir("hel1811"))
    appDashboards = new DashboardService(dashRepo, checker, outputRepo = outRepo)
    appPanels     = new PanelService(appPanelRepo, checker, dashRepo, outputRepo = outRepo)
    val dsService   = new DataSourceService(dsRepo, fs)
    val pipeService = new PipelineService(pipeRepo, stepRepo, dsRepo, outputRepo = outRepo, pipelineRootRepo = new PipelineRootRepository(ctx), dataSourceService = dsService)
    val outService  = new OutputService(outRepo, appPanelRepo, checker)
    appOutputs   = outService
    appAlerts    = new AlertRuleService(new AlertRuleRepository(ctx), outRepo)
    appSchedules = new PipelineScheduleService(new PipelineScheduleRepository(ctx), pipeRepo)
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

  private val limitCfg = JsObject("count" -> JsNumber(1))

  private def pipelineSet(s: Standings, name: String, steps: String = "[]", outputs: String = "[]", roots: Option[String] = None): PatchSet =
    set(s"""{"edits":[{"target":{"kind":"pipeline"},"op":"create","patch":{"name":"$name","roots":${roots.getOrElse(s"""[{"sourceId":"${s.rostersSourceId}"}]""")},"steps":$steps,"outputs":$outputs}}]}""")

  private val inlineSteps   = """[{"clientId":"s1","type":"limit","config":{"count":1}}]"""
  private def inlineOutputs(name: String) = s"""[{"nodeStepClientId":"s1","kind":"table","name":"$name"}]"""

  private def refusalOf(applicationId: String, user: AuthenticatedUser = owner): String =
    await(appUndo.undo(PatchSetApplicationId(applicationId), user)) match {
      case Left(ServiceError.Conflict(msg)) => msg
      case other                            => fail(s"expected a Conflict, got $other")
    }

  private def journaled(applicationId: String): Vector[JournaledEdit] =
    await(appApplicationRepo.findById(PatchSetApplicationId(applicationId), owner)).getOrElse(fail("application missing")).edits

  private def pipelineExists(id: String): Boolean = await(pipelineRepo.findByIdInternal(PipelineId(id))).isDefined
  private def stepExists(id: String): Boolean     = await(pipelineStepRepo.findByIdInternal(PipelineStepId(id))).isDefined

  private def alertRule(outputId: String, name: String, user: AuthenticatedUser = owner): AlertRule =
    await(appAlerts.create(CreateAlertRuleRequest(outputId, "count", JsObject("comparator" -> JsString("gt"), "threshold" -> JsNumber(5)), "warning", Some(true), name), user)) match {
      case Right(r) => r
      case Left(e)  => fail(s"alert rule create failed: $e")
    }

  private def ruleCount(outputId: String): Int =
    await(outputRepo.findAlertRuleDefinitionsInternal(Vector(outputId))).values.flatten.size

  private def scheduleCount(pipelineId: String): Int =
    await(pipelineRepo.findScheduleDefinitionInternal(PipelineId(pipelineId))).size

  private def rootCount(pipelineId: String): Int =
    await(pipelineRepo.listRootDataSourceIdsInternal(PipelineId(pipelineId))).size

  "an alert rule added after a pipeline create" should {
    "refuse the undo, naming the owner's rule and no id, leaving everything" in {
      val s = seedStandings(suffix = " hel1811 rule")
      val r = applied(pipelineSet(s, "Rule pipeline 1811", inlineSteps, inlineOutputs("Rule out")))
      val pid = r.edits.head.newId.get
      val outId = journaled(r.applicationId.get).head.createdChildren.getOrElse(fail("createdChildren missing")).outputIds.head
      val rule = alertRule(outId, "Rule on created Output")
      val msg = refusalOf(r.applicationId.get)
      withClue(s"message: $msg; ") {
        msg should include("edit 0 (pipeline create): 1 alert rule(s) were added after the patch set was applied and would be deleted")
        msg should include("alert rule \"Rule on created Output\"")
        msg should not include rule.id.value
        msg should not include outId
        msg should not include pid
      }
      ruleCount(outId) shouldBe 1
      outputExists(outId) shouldBe true
      pipelineExists(pid) shouldBe true
    }

    "count, not name, a rule another user owns (direct insert: not reachable through the API)" in {
      val s = seedStandings(suffix = " hel1811 unowned")
      val r = applied(pipelineSet(s, "Unowned rule pipeline 1811", inlineSteps, inlineOutputs("Unowned out")))
      val outId = journaled(r.applicationId.get).head.createdChildren.get.outputIds.head
      val ruleId = UUID.randomUUID().toString
      await(privDb.run(sqlu"""INSERT INTO alert_rules (id, owner_id, target_output_id, metric, condition, name, enabled, severity, created_at, updated_at)
        VALUES ($ruleId, ${otherIdStr}::uuid, $outId, 'count', '{"comparator":"gt","threshold":5}', 'Secret other rule', true, 'warning', now(), now())"""))
      val msg = refusalOf(r.applicationId.get)
      msg should include("1 alert rule(s) you do not own")
      msg should not include "Secret other rule"
      msg should not include ruleId
      ruleCount(outId) shouldBe 1
    }

    "refuse an alert rule on the Output of an `output` create edit" in {
      val s = seedStandings(suffix = " hel1811 outcreate")
      val r = applied(set(s"""{"edits":[{"target":{"kind":"output","parentId":"${s.pipelineId}"},"op":"create","patch":{"name":"Set output 1811","kind":"table","nodeStepId":"${s.computeStepId}"}}]}"""))
      val outId = r.edits.head.newId.get
      alertRule(outId, "Rule on output create")
      val msg = refusalOf(r.applicationId.get)
      msg should include("edit 0 (output create): 1 alert rule(s) were added after the patch set was applied")
      msg should include("alert rule \"Rule on output create\"")
      msg should not include outId
      ruleCount(outId) shouldBe 1
      outputExists(outId) shouldBe true
    }

    "refuse an alert rule on an Output under a `pipelineStep` create" in {
      val s = seedStandings(suffix = " hel1811 stepcreate")
      val r = applied(set(s"""{"edits":[{"target":{"kind":"pipelineStep","parentId":"${s.pipelineId}"},"op":"create","patch":{"type":"limit","config":{"count":1}}}]}"""))
      val stepId = r.edits.head.newId.get
      val o = await(appOutputs.create(PipelineId(s.pipelineId), CreateOutputRequest(Some(stepId), "table", "Under created step", None), owner)) match {
        case Right((o, _)) => o
        case Left(e)       => fail(s"Output create failed: $e")
      }
      alertRule(o.id.value, "Rule under step")
      val msg = refusalOf(r.applicationId.get)
      msg should include("edit 0 (pipelineStep create)")
      msg should include("alert rule \"Rule under step\"")
      ruleCount(o.id.value) shouldBe 1
      stepExists(stepId) shouldBe true
    }
  }

  "a schedule added after a pipeline create" should {
    "refuse the undo, mentioning the schedule and no id" in {
      val s = seedStandings(suffix = " hel1811 schedule")
      val r = applied(pipelineSet(s, "Scheduled pipeline 1811"))
      val pid = r.edits.head.newId.get
      await(appSchedules.put(PipelineId(pid), PutPipelineScheduleRequest("interval", "1h", Some(true), "UTC"), owner)) shouldBe a[Right[_, _]]
      val msg = refusalOf(r.applicationId.get)
      msg should include("the pipeline has a schedule that was added after the patch set was applied and would be deleted; remove it before undoing")
      msg should not include pid
      scheduleCount(pid) shouldBe 1
      pipelineExists(pid) shouldBe true
    }
  }

  "a root added after a pipeline create" should {
    "refuse the undo, counting an editor's root on the editor's own source without naming it" in {
      val s = seedStandings(suffix = " hel1811 root")
      val r = applied(pipelineSet(s, "Root pipeline 1811"))
      val pid = r.edits.head.newId.get
      grantRole("pipeline", pid, otherIdStr, "editor")
      val bSource = seedStatic("B private source 1811", sleeperRosterColumns, sleeperRosterRows, otherUser)
      val added = await(appPipelines.addRoot(PipelineId(pid), CreatePipelineRootRequest(sourceId = Some(bSource.value)), otherUser))
      added shouldBe a[Right[_, _]]
      rootCount(pid) shouldBe 2
      val msg = refusalOf(r.applicationId.get)
      withClue(s"message: $msg; ") {
        msg should include("edit 0 (pipeline create): 1 root(s) were added after the patch set was applied and would be deleted")
        msg should include("1 root(s) on data sources you cannot see")
        msg should not include "B private source 1811"
        msg should not include bSource.value
        msg should not include pid
      }
      rootCount(pid) shouldBe 2
      pipelineExists(pid) shouldBe true
    }

    "excuse the roots the create itself made (several), and undo cleanly" in {
      val s = seedStandings(suffix = " hel1811 multiroot")
      val r = applied(pipelineSet(s, "Multi-root pipeline 1811", roots = Some(s"""[{"sourceId":"${s.rostersSourceId}"},{"sourceId":"${s.usersSourceId}"}]""")))
      val pid = r.edits.head.newId.get
      rootCount(pid) shouldBe 2
      await(appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).isRight shouldBe true
      pipelineExists(pid) shouldBe false
    }
  }

  private def errorLogsDuring(body: => Unit): Vector[String] = {
    val logger   = LoggerFactory.getLogger(classOf[PatchSetUndoService]).asInstanceOf[LogbackLogger]
    val appender = new ListAppender[ILoggingEvent]
    appender.start()
    logger.addAppender(appender)
    try body
    finally { logger.detachAppender(appender); appender.stop() }
    appender.list.asScala.filter(_.getLevel == Level.ERROR).map(_.getFormattedMessage).toVector
  }

  "the root excusal rules" should {
    "journal the ids of the roots the create made, and read an old-shape row as None" in {
      val s = seedStandings(suffix = " hel1811 journal")
      val r = applied(pipelineSet(s, "Journal pipeline 1811", roots = Some(s"""[{"sourceId":"${s.rostersSourceId}"},{"sourceId":"${s.usersSourceId}"}]""")))
      val children = journaled(r.applicationId.get).head.createdChildren.getOrElse(fail("createdChildren missing"))
      children.rootIds.getOrElse(fail("rootIds missing")) should have size 2
      """{"stepIds":[],"outputIds":[]}""".parseJson.convertTo[JournaledCreatedChildren].rootIds shouldBe None
      val json = children.toJson
      json.convertTo[JournaledCreatedChildren] shouldBe children
    }

    "excuse the journaled rootIds regardless of timestamps (appliedAt before every root), and not a root outside them" in {
      val s = seedStandings(suffix = " hel1811 rootids")
      val r = applied(pipelineSet(s, "Root ids pipeline 1811", roots = Some(s"""[{"sourceId":"${s.rostersSourceId}"},{"sourceId":"${s.usersSourceId}"}]""")))
      val edit = journaled(r.applicationId.get).head
      val atEpoch = Instant.EPOCH
      await(PatchSetUndoLaterChildren.blocking(edit, Vector(edit), atEpoch, owner, appUndo.context)).roots shouldBe empty
      val oneId = edit.createdChildren.map(c => c.copy(rootIds = c.rootIds.map(_.take(1))))
      await(PatchSetUndoLaterChildren.blocking(edit.copy(createdChildren = oneId), Vector(edit), atEpoch, owner, appUndo.context)).roots should have size 1
    }

    "fall back, for a row without rootIds, to created_at <= appliedAt: the create's roots excused, a later root blocks" in {
      val s = seedStandings(suffix = " hel1811 legacyroot")
      val r = applied(pipelineSet(s, "Legacy root pipeline 1811"))
      val pid = r.edits.head.newId.get
      val record = await(appApplicationRepo.findById(PatchSetApplicationId(r.applicationId.get), owner)).get
      def blocked(edit: JournaledEdit) = await(PatchSetUndoLaterChildren.blocking(edit, Vector(edit), record.appliedAt, owner, appUndo.context))
      val noRootIds = record.edits.head.copy(createdChildren = record.edits.head.createdChildren.map(_.copy(rootIds = None)))
      val noChildren = record.edits.head.copy(createdChildren = None)
      blocked(noRootIds).roots shouldBe empty
      blocked(noChildren).roots shouldBe empty
      grantRole("pipeline", pid, otherIdStr, "editor")
      val bSource = seedStatic("B legacy source 1811", sleeperRosterColumns, sleeperRosterRows, otherUser)
      await(appPipelines.addRoot(PipelineId(pid), CreatePipelineRootRequest(sourceId = Some(bSource.value)), otherUser)) shouldBe a[Right[_, _]]
      blocked(noRootIds).roots should have size 1
      blocked(noChildren).roots should have size 1
      // with rootIds the later root is not in the excused list either
      blocked(record.edits.head).roots should have size 1
    }
  }

  "the pre-delete re-check" should {
    "report the pipeline edit failed, deleting nothing, when an alert rule lands after the Phase-1 check" in {
      val s = seedStandings(suffix = " hel1811 recheck")
      val r = applied(set(s"""{"edits":[
        {"target":{"kind":"pipeline"},"op":"create","patch":{"name":"Rechecked pipeline 1811","roots":[{"sourceId":"${s.rostersSourceId}"}],"steps":$inlineSteps,"outputs":${inlineOutputs("Rechecked out")}}},
        {"target":{"kind":"dashboard"},"op":"create","patch":{"name":"Rechecked board 1811"}}
      ]}"""))
      val pid = r.edits.head.newId.get
      val outId = journaled(r.applicationId.get).head.createdChildren.get.outputIds.head
      val dashboardId = r.edits(1).newId.get
      val holder = embeddedPostgres.getPostgresDatabase.getConnection
      try {
        holder.setAutoCommit(false)
        holder.createStatement().execute(s"SELECT 1 FROM dashboards WHERE id = '$dashboardId' FOR UPDATE")
        val undoing = appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)
        Thread.sleep(1500)
        undoing.isCompleted shouldBe false
        val rule = alertRule(outId, "Landed late rule")
        val logs = errorLogsDuring {
          holder.rollback()
          await(undoing).getOrElse(fail("expected an outcome list, not a refusal")).edits.map(_.status) shouldBe Vector("failed", "restored")
        }
        val reason = logs.find(_.contains("undo restore failed")).getOrElse(fail(s"no ERROR log: $logs"))
        reason should include("1 Output(s), pipeline step(s), alert rule(s), schedule(s) or root(s) were added during the undo; nothing further was undone")
        reason should not include "Landed late rule"
        reason should not include rule.id.value
      } finally holder.close()
      ruleCount(outId) shouldBe 1
      pipelineExists(pid) shouldBe true
    }

    "make the output arm's delete transaction refuse (and delete nothing) when an alert rule targets the Output" in {
      val s = seedStandings(suffix = " hel1811 outtx")
      val r = applied(set(s"""{"edits":[{"target":{"kind":"output","parentId":"${s.pipelineId}"},"op":"create","patch":{"name":"Tx output 1811","kind":"table","nodeStepId":"${s.computeStepId}"}}]}"""))
      val outId = r.edits.head.newId.get
      alertRule(outId, "Tx rule")
      await(outputRepo.deleteIfUnboundInternal(OutputId(outId), owner)) shouldBe Left((0, 1))
      outputExists(outId) shouldBe true
      ruleCount(outId) shouldBe 1
      PatchSetUndoLaterChildren.outputBoundDuringUndo(0, 1) shouldBe "1 alert rule(s) were added during the undo; nothing further was undone"
      PatchSetUndoLaterChildren.outputBoundDuringUndo(2, 1) should (include("2 panel(s)") and include("1 alert rule(s)"))
    }
  }
}
