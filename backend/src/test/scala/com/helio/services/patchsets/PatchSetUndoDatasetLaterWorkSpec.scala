package com.helio.services.patchsets

import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest}
import com.helio.api.protocols.sources.{DatasetFieldDeclarationPayload, UpdateDatasetSchemaRequest}
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


import java.sql.Timestamp
import java.time.Instant
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.{JournaledEdit, journaledEditFormat}
import java.util.UUID
import scala.concurrent.Future
import scala.jdk.CollectionConverters._

/** HEL-1796: undoing a patch set that created a dataset data source is refused (409, nothing restored) when it
 *  would delete later rows, edits or break later references. Runs on the `helio_app_test` NOBYPASSRLS role. */
class PatchSetUndoDatasetLaterWorkSpec extends AssistantStandingsFixture {

  import PostgresProfile.api._

  private var appDb: JdbcBackend.Database        = _
  private var privDb: JdbcBackend.Database       = _
  private var appPanels: PanelService            = _
  private var appDashboards: DashboardService    = _
  private var appApply: PatchSetApplyService     = _
  private var appUndo: PatchSetUndoService       = _
  private var appPanelRepo: PanelRepository      = _
  private var appApplicationRepo: PatchSetApplicationRepository = _
  private var appPipelines: PipelineService      = _
  private var appDs: DataSourceService           = _
  private var appCtx: DbContext                  = _
  private var appFs: LocalFileSystem             = _

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
    val fs      = new LocalFileSystem(newTempDir("hel1796"))
    appDashboards = new DashboardService(dashRepo, checker, outputRepo = outRepo)
    appPanels     = new PanelService(appPanelRepo, checker, dashRepo, outputRepo = outRepo)
    val dsService   = new DataSourceService(dsRepo, fs)
    appDs           = dsService
    appCtx          = ctx
    appFs           = fs
    val pipeService = new PipelineService(pipeRepo, stepRepo, dsRepo, outputRepo = outRepo)
    val outService  = new OutputService(outRepo, appPanelRepo, checker)
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

  private val sourceEdit = (name: String) =>
    s"""{"target":{"kind":"dataSource"},"op":"create","patch":{"name":"$name","type":"dataset","columns":[{"name":"value","type":"integer"}],"rows":[[1],[2],[3]]}}"""
  private val dashboardEdit = (name: String) => s"""{"target":{"kind":"dashboard"},"op":"create","patch":{"name":"$name"}}"""

  /** A set that creates the source (edit 0) and, optionally, a dashboard (edit 1). */
  private def sourceSet(name: String, dashboard: Option[String] = None): PatchSet =
    set(s"""{"edits":[${(Vector(sourceEdit(name)) ++ dashboard.map(dashboardEdit)).mkString(",")}]}""")

  private def refusalOf(applicationId: String, user: AuthenticatedUser = owner): String =
    await(appUndo.undo(PatchSetApplicationId(applicationId), user)) match {
      case Left(ServiceError.Conflict(msg)) => msg
      case other                            => fail(s"expected a Conflict, got $other")
    }

  private def sourceExists(id: String): Boolean = await(dataSourceRepo.findByIdInternal(DataSourceId(id))).isDefined
  private def rowCount(id: String): Int = await(privDb.run(sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = $id".as[Int].head))
  private def dashboardExists(id: String): Boolean = await(dashboardRepo.findByIdInternal(DashboardId(id))).isDefined
  private def rows(id: String) = await(appDs.listRows(DataSourceId(id), None, None, owner)).getOrElse(fail("listRows failed")).rows

  private def append(id: String, user: AuthenticatedUser = owner): Unit =
    await(appDs.appendRows(DataSourceId(id), Vector(Vector(JsNumber(7))), user)).getOrElse(fail("append failed"))

  "the app role" should {
    "not bypass RLS" in {
      await(appDb.run(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe false
    }
  }

  "a dataSource create (probe, passes today)" should {
    "store one created_at on the source and on every row it created (the journaled threshold T)" in {
      val r = applied(sourceSet("Probe source 1796"))
      val id = r.edits.head.newId.get
      val stamps = await(privDb.run(sql"""SELECT (SELECT created_at::text FROM data_sources WHERE id = $id),
        (SELECT string_agg(DISTINCT created_at::text, ',') FROM dataset_rows WHERE data_source_id = $id),
        (SELECT string_agg(DISTINCT updated_at::text, ',') FROM dataset_rows WHERE data_source_id = $id)""".as[(String, String, String)].head))
      stamps._2 shouldBe stamps._1
      stamps._3 shouldBe stamps._1
    }
  }

  "undoing a patch set that created a dataset source" should {
    "succeed, removing the source and every row, when nothing changed after the apply" in {
      val r = applied(sourceSet("Clean source 1796"))
      val id = r.edits.head.newId.get
      rowCount(id) shouldBe 3
      await(appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).isRight shouldBe true
      sourceExists(id) shouldBe false
      rowCount(id) shouldBe 0
    }

    "refuse with a count, changing nothing, when an editor submitted a form row after the apply" in {
      val r = applied(sourceSet("Form-submit source 1796", Some("Form-submit board 1796")))
      val id = r.edits.head.newId.get
      val dash = r.edits(1).newId.get
      await(appDs.appendFormRow(DataSourceId(id), (_, _) => Right(Vector(JsNumber(9))), PanelId("p"), otherUser, owner.id)).isRight shouldBe true
      val msg = refusalOf(r.applicationId.get)
      msg should include("edit 0 (dataSource create): 1 row(s) were added or replaced after the patch set was applied and would be deleted")
      msg should not include id
      sourceExists(id) shouldBe true
      rowCount(id) shouldBe 4
      dashboardExists(dash) shouldBe true
    }

    "refuse when the owner appended a row" in {
      val r = applied(sourceSet("Owner-append source 1796"))
      val id = r.edits.head.newId.get
      append(id); append(id)
      refusalOf(r.applicationId.get) should include("2 row(s) were added or replaced")
      sourceExists(id) shouldBe true
      rowCount(id) shouldBe 5
    }

    "refuse when a row the apply created was edited" in {
      val r = applied(sourceSet("Edited-row source 1796"))
      val id = r.edits.head.newId.get
      val first = rows(id).head
      await(appDs.patchRow(DataSourceId(id), first.id, first.updatedAt.toString, Vector(JsNumber(50)), owner)).getOrElse(fail("patchRow failed"))
      refusalOf(r.applicationId.get) should include("1 row(s) created by the patch set were edited after it was applied and the edits would be lost")
      sourceExists(id) shouldBe true
      rowCount(id) shouldBe 3
    }

    "refuse when only the declared schema was edited, claiming no added rows" in {
      val r = applied(sourceSet("Schema-edit source 1796"))
      val id = r.edits.head.newId.get
      await(appDs.updateDatasetSchema(DataSourceId(id), UpdateDatasetSchemaRequest(Vector(DatasetFieldDeclarationPayload("value", None, "integer", Some(true)))), owner)).isRight shouldBe true
      val msg = refusalOf(r.applicationId.get)
      msg should include("the dataset schema was edited after the patch set was applied, which rewrote its rows; undoing would delete them")
      msg should not include "were added or replaced"
      sourceExists(id) shouldBe true
    }

    "refuse when the rows were replaced" in {
      val r = applied(sourceSet("Replaced source 1796"))
      val id = r.edits.head.newId.get
      await(appDs.replaceRows(DataSourceId(id), Vector(Vector(JsNumber(1)), Vector(JsNumber(2))), owner)).getOrElse(fail("replace failed"))
      refusalOf(r.applicationId.get) should include("row(s) were added or replaced")
      sourceExists(id) shouldBe true
    }

    "refuse when the last apply-era row was deleted and a new row appended" in {
      val r = applied(sourceSet("Delete-then-append source 1796"))
      val id = r.edits.head.newId.get
      val last = rows(id).last
      await(appDs.deleteRow(DataSourceId(id), last.id, last.updatedAt.toString, owner)).getOrElse(fail("deleteRow failed"))
      append(id)
      refusalOf(r.applicationId.get) should include("1 row(s) were added or replaced")
      sourceExists(id) shouldBe true
    }

    "succeed when only a row was deleted after the apply (journaled created-dataset record)" in {
      val r = applied(sourceSet("Lone-delete source 1796"))
      val id = r.edits.head.newId.get
      val last = rows(id).last
      await(appDs.deleteRow(DataSourceId(id), last.id, last.updatedAt.toString, owner)).getOrElse(fail("deleteRow failed"))
      await(appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).isRight shouldBe true
      sourceExists(id) shouldBe false
    }
  }

  "undoing a dataset source create that something later references" should {
    "refuse the whole undo before anything is restored, naming the pipeline and no id, for a later pipeline root" in {
      val r = applied(sourceSet("Piped source 1796", Some("Piped board 1796")))
      val id = r.edits.head.newId.get
      val dash = r.edits(1).newId.get
      val pipe = await(appPipelines.create(CreatePipelineRequest("Later pipeline 1796", Vector(CreatePipelineRootRequest(sourceId = Some(id)))), owner)).getOrElse(fail("pipeline create failed"))
      val msg = refusalOf(r.applicationId.get)
      msg should include("""pipeline "Later pipeline 1796"""")
      msg should not include pipe.id
      msg should not include id
      msg should not include dash
      sourceExists(id) shouldBe true
      dashboardExists(dash) shouldBe true
    }

    "refuse for a later form panel bound to the source, naming it and no id" in {
      val s = seedStandings(suffix = " hel1796 form")
      val r = applied(sourceSet("Formed source 1796"))
      val id = r.edits.head.newId.get
      val config = JsObject(
        "dataSourceId" -> JsString(id),
        "fields" -> JsArray(JsObject("sourceField" -> JsString("value"), "control" -> JsString("number"), "step" -> JsNumber(1), "required" -> JsBoolean(true))),
        "submit" -> JsObject("writeMode" -> JsString("append"))
      )
      val panel = await(appPanels.create(CreatePanelRequest(Some(s.dashboardId), Some("Later form 1796"), Some("form"), Some(config)), owner)) match {
        case Right((p, _)) => p
        case Left(e)       => fail(s"form panel create failed: $e")
      }
      val msg = refusalOf(r.applicationId.get)
      msg should include(""""Later form 1796" on dashboard "Standings hel1796 form"""")
      msg should not include panel.id.value
      msg should not include id
      msg should not include s.dashboardId
      sourceExists(id) shouldBe true
      await(dashboardRepo.findByIdInternal(DashboardId(s.dashboardId))).isDefined shouldBe true
    }
  }

  /** Rewrites the stored journal as a row written before this change: no `createdDataset` on any edit. */
  private def asLegacyJournal(applicationId: String): Unit =
    await(privDb.run(sqlu"""UPDATE patch_set_applications SET edits = (
      SELECT jsonb_agg(elem - 'createdDataset' ORDER BY ord) FROM jsonb_array_elements(edits) WITH ORDINALITY AS t(elem, ord)) WHERE id = $applicationId""")) shouldBe 1

  "a journal row with no createdDataset (written before HEL-1796)" should {
    "fall back to the apply time: refuse an appended row and an edited row" in {
      val r = applied(sourceSet("Legacy appended 1796"))
      val id = r.edits.head.newId.get
      asLegacyJournal(r.applicationId.get)
      await(appApplicationRepo.findById(PatchSetApplicationId(r.applicationId.get), owner)).get.edits.head.createdDataset shouldBe None
      append(id)
      refusalOf(r.applicationId.get) should include("1 row(s) were added or replaced")
      sourceExists(id) shouldBe true

      val r2 = applied(sourceSet("Legacy edited 1796"))
      val id2 = r2.edits.head.newId.get
      asLegacyJournal(r2.applicationId.get)
      val first = rows(id2).head
      await(appDs.patchRow(DataSourceId(id2), first.id, first.updatedAt.toString, Vector(JsNumber(50)), owner)).getOrElse(fail("patchRow failed"))
      refusalOf(r2.applicationId.get) should include("1 row(s) created by the patch set were edited")
      sourceExists(id2) shouldBe true
    }

    "refuse a lone row delete as a change (the accepted over-refusal), and undo cleanly when untouched" in {
      val r = applied(sourceSet("Legacy deleted 1796"))
      val id = r.edits.head.newId.get
      asLegacyJournal(r.applicationId.get)
      val last = rows(id).last
      await(appDs.deleteRow(DataSourceId(id), last.id, last.updatedAt.toString, owner)).getOrElse(fail("deleteRow failed"))
      refusalOf(r.applicationId.get) should include("the data source was changed after the patch set was applied")
      sourceExists(id) shouldBe true

      val clean = applied(sourceSet("Legacy clean 1796"))
      val cleanId = clean.edits.head.newId.get
      asLegacyJournal(clean.applicationId.get)
      await(appUndo.undo(PatchSetApplicationId(clean.applicationId.get), owner)).isRight shouldBe true
      sourceExists(cleanId) shouldBe false
    }
  }

  "the journaled created-dataset record" should {
    "hold the stored created_at and declared schema, and round-trip; an old-shape row parses to None" in {
      val r = applied(sourceSet("Journaled 1796"))
      val id = r.edits.head.newId.get
      val journal = await(appApplicationRepo.findById(PatchSetApplicationId(r.applicationId.get), owner)).get.edits.head.createdDataset.getOrElse(fail("createdDataset not journaled"))
      val stored = await(privDb.run(sql"SELECT created_at FROM data_sources WHERE id = $id".as[Timestamp].head)).toInstant
      journal.rowsStampedAt shouldBe Some(stored)
      journal.declaredSchema.map(_.toString) .getOrElse(fail("no schema")) should include("value")
      val edit = JournaledEdit(0, "dataSource", "create", None, None, Some(id), None, createdDataset = Some(journal))
      edit.toJson.convertTo[JournaledEdit] shouldBe edit
      """{"index":0,"targetKind":"dataSource","op":"create","newId":"d1"}""".parseJson.convertTo[JournaledEdit].createdDataset shouldBe None
    }

    "refuse a row appended to a source the apply created with no rows" in {
      val r = applied(set(s"""{"edits":[{"target":{"kind":"dataSource"},"op":"create","patch":{"name":"Empty source 1796","type":"dataset","columns":[{"name":"value","type":"integer"}],"rows":[]}}]}"""))
      val id = r.edits.head.newId.get
      append(id)
      refusalOf(r.applicationId.get) should include("1 row(s) were added or replaced")
      sourceExists(id) shouldBe true
    }
  }

  "a reference refusal" should {
    "count a pipeline the undoing user cannot see, saying `you cannot see`, and name the visible one" in {
      val r = applied(sourceSet("Hidden-ref source 1796"))
      val id = r.edits.head.newId.get
      // another user's pipeline on the source (a user cannot create one on a source they do not own, so insert it directly)
      val theirs = UUID.randomUUID().toString
      await(privDb.run(DBIO.seq(
        sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($theirs, 'Their pipeline 1796', $otherIdStr::uuid, now(), now())""",
        sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($theirs, $theirs, $id, 0)"""
      )))
      await(appPipelines.create(CreatePipelineRequest("My pipeline 1796", Vector(CreatePipelineRootRequest(sourceId = Some(id)))), owner)).getOrElse(fail("pipeline create failed"))
      val msg = refusalOf(r.applicationId.get)
      msg should include("""pipeline "My pipeline 1796"""")
      msg should include("1 pipeline(s) you cannot see")
      msg should not include "Their pipeline"
      sourceExists(id) shouldBe true
    }
  }

  "the Phase-2 re-check" should {
    "report the source delete failed, with a count only, when a row lands after the Phase-1 check" in {
      val s = seedStandings(suffix = " hel1796 recheck")
      // edit 0 creates the source, edit 1 renames another source: the reverse walk undoes the rename first, and this
      // repository appends a row to the created source right after that rename's write, before the re-check.
      val r = applied(set(s"""{"edits":[${sourceEdit("Rechecked source 1796")},
        {"target":{"kind":"dataSource","id":"${s.usersSourceId}"},"op":"update","patch":{"name":"Renamed users 1796"}}]}"""))
      val id = r.edits.head.newId.get
      var fired = false
      val hooked = new DataSourceRepository(appCtx) {
        override def update(source: DataSource, user: AuthenticatedUser): Future[Option[DataSource]] =
          super.update(source, user).map { result =>
            if (!fired) { fired = true; append(id) }
            result
          }
      }
      val hookedUndo = new PatchSetUndoService(
        appPanels, appDashboards, new DataSourceService(hooked, appFs), appPipelines, appPanelRepo, dashboardRepo, hooked, pipelineRepo, pipelineStepRepo, appApplicationRepo, outputRepo = outputRepo
      )
      val logs = errorLogsDuring {
        await(hookedUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).getOrElse(fail("expected an outcome list, not a refusal")).edits.map(_.status) shouldBe Vector("failed", "restored")
      }
      fired shouldBe true
      val reason = logs.find(_.contains("undo restore failed")).getOrElse(fail(s"no ERROR log: $logs"))
      reason should include("1 row(s) were added during the undo; nothing further was undone")
      sourceExists(id) shouldBe true
      rowCount(id) shouldBe 4
    }
  }

  "the Phase-2 reference backstop" should {
    "report the edit failed with the fixed phrase, never a name or id, when a use lands after the re-check" in {
      val r = applied(sourceSet("Backstop source 1796"))
      val id = r.edits.head.newId.get
      var reads = 0
      var pipelineId = ""
      // read 1 is Phase 1, read 2 the Phase-2 re-check: a pipeline root lands right after it, before the delete's own guard
      val hooked = new DataSourceRepository(appCtx) {
        override def datasetLaterWork(sourceId: DataSourceId, threshold: Instant): Future[Option[DataSourceRepository.DatasetLaterWork]] =
          super.datasetLaterWork(sourceId, threshold).map { result =>
            reads += 1
            if (reads == 2) {
              pipelineId = await(appPipelines.create(CreatePipelineRequest("Backstop pipeline 1796", Vector(CreatePipelineRootRequest(sourceId = Some(id)))), owner)).getOrElse(fail("pipeline create failed")).id
            }
            result
          }
      }
      val hookedUndo = new PatchSetUndoService(
        appPanels, appDashboards, new DataSourceService(hooked, appFs), appPipelines, appPanelRepo, dashboardRepo, hooked, pipelineRepo, pipelineStepRepo, appApplicationRepo, outputRepo = outputRepo
      )
      val logs = errorLogsDuring {
        await(hookedUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).getOrElse(fail("expected an outcome list, not a refusal")).edits.map(_.status) shouldBe Vector("failed")
      }
      reads shouldBe 2
      val reason = logs.find(_.contains("undo restore failed")).getOrElse(fail(s"no ERROR log: $logs"))
      reason should include("the data source gained a use during the undo; nothing further was undone")
      reason should not include "Backstop pipeline"
      reason should not include pipelineId
      reason should not include id
      sourceExists(id) shouldBe true
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
}
