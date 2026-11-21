package com.helio.testsupport

import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.pipelines.DraftSaveRequest
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ServiceError
import com.helio.api.protocols.alerts.CreateAlertRuleRequest
import com.helio.infrastructure.persistence.alerts.AlertRuleRepository
import com.helio.services.alerts.AlertRuleService
import com.helio.services.auth.PermissionService
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.patchsets.PatchSetUndoService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.services.pipelines.draft.DraftRestore
import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import org.slf4j.{Logger => Slf4jLogger, LoggerFactory}
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.Future
import scala.jdk.CollectionConverters._

/** HEL-1792: fixture for [[DraftUndoPanelNamingSpec]]. Undoing a pipeline draft save refuses (409, nothing changed) when it would delete panels the save did not
 *  create, and the refusal follows HEL-1720's naming rule: a blocking panel the undoing user can read is named by title and
 *  dashboard name, every other one is only counted, and no panel id, alert rule id, or unreadable panel title / dashboard name
 *  appears in the message or in any log line.
 *
 *  Every service runs on the `helio_app_test` NOBYPASSRLS role (two-pool `DbContext`); the fixture's superuser connection
 *  only seeds users and raw rows named below. Cases (a)-(c), (e), (f) are red-first; (d) is a GUARD that is green on main
 *  (the fingerprint backstop), and is labelled as such in the red-run record. */
trait DraftUndoRlsFixture extends AssistantStandingsFixture {

  import PostgresProfile.api._

  protected var appDb: JdbcBackend.Database   = _
  protected var privDb: JdbcBackend.Database  = _
  protected var appCtx: DbContext             = _
  protected var appPanels: PanelService       = _
  protected var appDashboards: DashboardService = _
  protected var h: DraftSaveHarness           = _
  protected var undoer: PatchSetUndoService   = _
  protected var appPanelRepo: PanelRepository = _
  protected var appOutRepo: OutputRepository  = _
  protected var alertRules: AlertRuleService  = _
  protected var permissions: PermissionService = _

  override def beforeAll(): Unit = {
    super.beforeAll()
    val superDs = embeddedPostgres.getPostgresDatabase
    val conn    = superDs.getConnection
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
    appCtx = new DbContext(appDb, privDb)

    val dashRepo = new DashboardRepository(appCtx)
    appPanelRepo = new PanelRepository(appCtx)
    val dsRepo   = new DataSourceRepository(appCtx)
    val permRepo = new ResourcePermissionRepository(appCtx)
    val pipeRepo = new PipelineRepository(appCtx, dsRepo)
    appOutRepo   = new OutputRepository(appCtx)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => appPanelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dsRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipeRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val checker   = new AccessCheckerImpl(permRepo, registry)
    appDashboards = new DashboardService(dashRepo, checker, outputRepo = appOutRepo)
    appPanels     = new PanelService(appPanelRepo, checker, dashRepo, outputRepo = appOutRepo)
    h             = new DraftSaveHarness(appCtx)
    undoer        = undoServiceOver(h)
    alertRules    = new AlertRuleService(new AlertRuleRepository(appCtx), appOutRepo)
    permissions   = new PermissionService(permRepo, checker)
  }

  override def afterAll(): Unit = {
    appDb.close(); privDb.close()
    super.afterAll()
  }

  /** The undo service whose draft restore sits over `harness`'s draft save service. */
  protected def undoServiceOver(harness: DraftSaveHarness): PatchSetUndoService = {
    val ctx      = harness.ctx
    val dashRepo = harness.dashboardRepo
    val dsRepo   = harness.dataSourceRepo
    val checker  = new AccessCheckerImpl(
      new ResourcePermissionRepository(ctx),
      new ResourceTypeRegistry(
        AclResourceType("dashboard",   id => dashRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
        AclResourceType("panel",       id => harness.panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
        AclResourceType("data-source", id => dsRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
        AclResourceType("pipeline",    id => harness.pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
      )
    )
    val panels    = new PanelService(harness.panelRepo, checker, dashRepo, outputRepo = harness.outputRepo)
    val dashboards = new DashboardService(dashRepo, checker, outputRepo = harness.outputRepo)
    val dsService = new DataSourceService(dsRepo, new LocalFileSystem(newTempDir("hel1792-undo")))
    val pipes     = new PipelineService(harness.pipelineRepo, harness.stepRepo, dsRepo, outputRepo = harness.outputRepo)
    new PatchSetUndoService(
      panels, dashboards, dsService, pipes, harness.panelRepo, dashRepo, dsRepo, harness.pipelineRepo, harness.stepRepo,
      harness.applicationRepo, outputRepo = harness.outputRepo,
      draftRestore = new DraftRestore(harness.service, harness.outputRepo, harness.panelRepo, harness.dashboardRepo)
    )
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────────────

  protected def fingerprintAndDraft(pipelineId: String, user: AuthenticatedUser, harness: DraftSaveHarness = h): (String, JsObject) = {
    val summary = await(harness.service.read(PipelineId(pipelineId), user, includeDefinition = true)).getOrElse(fail("read refused"))
    val definition = summary.definition.getOrElse(fail("no definition")).asJsObject
    def optional(o: JsObject, k: String): Option[JsValue] = o.fields.get(k).filter(_ != JsNull)
    val steps = definition.fields("steps").convertTo[Vector[JsObject]].map { s =>
      JsObject(
        Map("id" -> s.fields("id"), "type" -> s.fields("type"), "config" -> s.fields("config"), "enabled" -> s.fields("enabled"), "position" -> s.fields("position")) ++
          optional(s, "parentStepId").map("parentStepId" -> _) ++ optional(s, "rootId").map("rootId" -> _)
      )
    }
    val outputs = definition.fields("outputs").convertTo[Vector[JsObject]].map { o =>
      JsObject(
        Map("id" -> o.fields("id"), "name" -> o.fields("name"), "kind" -> o.fields("kind"), "config" -> o.fields("config")) ++
          optional(o, "nodeStepId").map("nodeStepId" -> _) ++ optional(o, "rootId").map("rootId" -> _)
      )
    }
    val fp = summary.fingerprint.getOrElse(fail("no fingerprint"))
    (fp, JsObject("baseFingerprint" -> JsString(fp), "steps" -> JsArray(steps), "outputs" -> JsArray(outputs)))
  }

  protected def newOutput(s: Standings, name: String): JsObject =
    JsObject("clientId" -> JsString(s"c-$name"), "name" -> JsString(name), "kind" -> JsString("table"), "nodeStepId" -> JsString(s.computeStepId), "config" -> JsObject.empty)

  protected def confirm(outputs: Seq[String], panels: Seq[String], rules: Seq[String]): JsObject =
    JsObject("confirmCascade" -> JsObject(
      "stepIds" -> JsArray(), "outputIds" -> JsArray(outputs.map(JsString(_)).toVector),
      "panelIds" -> JsArray(panels.map(JsString(_)).toVector), "alertRuleIds" -> JsArray(rules.map(JsString(_)).toVector)
    ))

  /** Saves `draftJson` as `user`; returns the journal application id. */
  protected def saveAs(pipelineId: String, draftJson: JsObject, user: AuthenticatedUser, harness: DraftSaveHarness = h): String =
    await(harness.service.save(PipelineId(pipelineId), draftJson.convertTo[DraftSaveRequest], user)) match {
      case Right(resp) => resp.saved.applicationId
      case Left(e)     => fail(s"the draft save was refused: $e")
    }

  /** A draft save by `user` that creates the Output `name` (at the compute step); returns (application id, the created id). */
  protected def saveCreatingOutput(s: Standings, name: String, user: AuthenticatedUser = owner): (String, String) = {
    val (_, draft) = fingerprintAndDraft(s.pipelineId, user)
    val appId = saveAs(s.pipelineId, JsObject(draft.fields + ("outputs" -> JsArray(draft.fields("outputs").convertTo[Vector[JsValue]] :+ newOutput(s, name)))), user)
    (appId, outputIdByName(s.pipelineId, name))
  }

  /** A draft save by `user` removing the pipeline's seeded Output (and, by cascade, its panels and rules), confirmed. */
  protected def saveRemovingStandingsOutput(s: Standings, extraOutput: Option[String], panelIds: Seq[String], ruleIds: Seq[String], user: AuthenticatedUser = owner): String = {
    val (_, draft) = fingerprintAndDraft(s.pipelineId, user)
    val kept    = draft.fields("outputs").convertTo[Vector[JsObject]].filterNot(_.fields("id") == JsString(s.tableOutputId))
    val outputs = kept ++ extraOutput.map(newOutput(s, _))
    saveAs(s.pipelineId, JsObject(draft.fields + ("outputs" -> JsArray(outputs)) ++ confirm(Seq(s.tableOutputId), panelIds, ruleIds).fields), user)
  }

  protected def outputIdByName(pipelineId: String, name: String): String =
    await(outputRepo.listByPipelineInternal(PipelineId(pipelineId))).find(_.name == name).getOrElse(fail(s"no Output $name")).id.value

  protected def bindPanel(dashboardId: String, outputId: String, user: AuthenticatedUser, title: String): PanelId =
    await(appPanels.create(
      CreatePanelRequest(Some(dashboardId), Some(title), Some("output"), Some(JsObject("outputId" -> JsString(outputId)))),
      user
    )) match {
      case Right((p, _)) => p.id
      case Left(e)       => fail(s"binding a panel through PanelService.create failed: $e")
    }

  /** A rule through the real `AlertRuleService.create` as the Output's owner (proves `user` owns `outputId`). */
  protected def createRule(outputId: String, user: AuthenticatedUser, name: String): String =
    await(alertRules.create(CreateAlertRuleRequest(outputId, "m", JsObject("comparator" -> JsString("gt"), "threshold" -> JsNumber(1)), "warning", None, name), user)) match {
      case Right(rule) => rule.id.value
      case Left(e)     => fail(s"AlertRuleService.create failed: $e")
    }

  /** A raw alert-rule row owned by `ownerId`, for the one case no service path reaches: a rule owned by someone OTHER than
   *  the Output's owner (`AlertRuleService.create` requires the Output owner), as the save's cascade-removal case needs. */
  protected def insertRule(outputId: String, ownerId: String, name: String): String = {
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO alert_rules (id, owner_id, metric, condition, name, enabled, severity, created_at, updated_at, target_output_id)
      VALUES ($id, $ownerId::uuid, 'm', '{}', $name, true, 'warning', now(), now(), $outputId)"""))
    id
  }

  protected def panelExists(id: String): Boolean  = await(panelRepo.findByIdInternal(PanelId(id))).isDefined
  protected def outputExists(id: String): Boolean = await(outputRepo.findByIdInternal(OutputId(id))).isDefined
  protected def ruleExists(id: String): Boolean   = await(db.run(sql"SELECT count(*) FROM alert_rules WHERE id = $id".as[Int].head)) == 1

  protected def undoRefusal(applicationId: String, user: AuthenticatedUser, service: PatchSetUndoService = undoer): ServiceError =
    await(service.undo(PatchSetApplicationId(applicationId), user)) match {
      case Left(e)  => e
      case Right(r) => fail(s"expected the undo to be refused, got $r")
    }

  protected def conflictMessage(applicationId: String, user: AuthenticatedUser): String =
    undoRefusal(applicationId, user) match {
      case ServiceError.Conflict(msg) => msg
      case other                      => fail(s"expected a Conflict, got $other")
    }

  /** Every log line any logger emits while `body` runs (the refusal must not leak ids into logs either). */
  protected def logsDuring(body: => Unit): Vector[String] = {
    val root     = LoggerFactory.getLogger(Slf4jLogger.ROOT_LOGGER_NAME).asInstanceOf[LogbackLogger]
    val appender = new ListAppender[ILoggingEvent]
    appender.start()
    root.addAppender(appender)
    try body
    finally { root.detachAppender(appender); appender.stop() }
    appender.list.asScala.map(_.getFormattedMessage).toVector
  }

  protected def occurrences(text: String, needle: String): Int = text.sliding(needle.length).count(_ == needle)

}
