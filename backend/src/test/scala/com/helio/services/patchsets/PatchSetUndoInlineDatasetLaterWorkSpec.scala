package com.helio.services.patchsets

import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest}
import com.helio.api.protocols.sources.{DatasetFieldDeclarationPayload, UpdateDatasetSchemaRequest}
import com.helio.services.ServiceError
import com.helio.api.protocols.patchsets.PatchSet
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.infrastructure.persistence.auth.{ConnectorCredentialRepository, ResourcePermissionRepository}
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.dashboards.DashboardService
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.{OutputService, PipelineService}
import com.helio.services.sources.{DataSourceService, SourceService}
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

/** HEL-1796 fold-in: undoing a patch set whose `pipeline` create made an inline dataset root is refused (409, nothing
 *  restored) when the source would be deleted with later rows or edits; a still-referenced source is kept (HEL-1493). Runs on the `helio_app_test` NOBYPASSRLS role. */
class PatchSetUndoInlineDatasetLaterWorkSpec extends AssistantStandingsFixture {

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
    val connectorRepo = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
    val rest        = new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(Right(JsArray(JsObject("amount" -> JsNumber(1)))))))
    val pipeService = new PipelineService(
      pipeRepo, stepRepo, dsRepo, outputRepo = outRepo,
      sourceService = new SourceService(dsRepo, rest, connectorRepo = connectorRepo), dataSourceService = dsService
    )
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

  private def inlineRoot(name: String, rows: String = "[[1],[2],[3]]") =
    s"""{"type":"dataset","name":"$name","staticConfig":{"columns":[{"name":"value","type":"integer"}],"rows":$rows}}"""

  private def pipelineSet(name: String, roots: Vector[String]): PatchSet =
    set(s"""{"edits":[{"target":{"kind":"pipeline"},"op":"create","patch":{"name":"$name","roots":[${roots.mkString(",")}],"steps":[],"outputs":[]}}]}""")

  private def journal(applicationId: String): Vector[JournaledEdit] =
    await(appApplicationRepo.findById(PatchSetApplicationId(applicationId), owner)).getOrElse(fail("application missing")).edits

  private def inlineIds(applicationId: String): Vector[String] = journal(applicationId).head.inlineSources.getOrElse(fail("no inline sources journaled")).map(_.id)

  private def refusalOf(applicationId: String): String =
    await(appUndo.undo(PatchSetApplicationId(applicationId), owner)) match {
      case Left(ServiceError.Conflict(msg)) => msg
      case other                            => fail(s"expected a Conflict, got $other")
    }

  private def sourceExists(id: String): Boolean = await(dataSourceRepo.findByIdInternal(DataSourceId(id))).isDefined
  private def pipelineExists(id: String): Boolean = await(pipelineRepo.findByIdInternal(PipelineId(id))).isDefined
  private def rowCount(id: String): Int = await(privDb.run(sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = $id".as[Int].head))
  private def rows(id: String) = await(appDs.listRows(DataSourceId(id), None, None, owner)).getOrElse(fail("listRows failed")).rows
  private def append(id: String): Unit = await(appDs.appendRows(DataSourceId(id), Vector(Vector(JsNumber(7))), owner)).getOrElse(fail("append failed"))

  private def errorLogsDuring(body: => Unit): Vector[String] = {
    val logger   = LoggerFactory.getLogger(classOf[PatchSetUndoService]).asInstanceOf[LogbackLogger]
    val appender = new ListAppender[ILoggingEvent]
    appender.start()
    logger.addAppender(appender)
    try body
    finally { logger.detachAppender(appender); appender.stop() }
    appender.list.asScala.filter(_.getLevel == Level.ERROR).map(_.getFormattedMessage).toVector
  }

  /** Another pipeline rooted on `sourceId`, owned by `ownerId` (inserted directly so it can belong to a user who cannot see the source). */
  private def insertPipelineOn(sourceId: String, ownerId: String): String = {
    val pid = UUID.randomUUID().toString
    await(privDb.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'Other pipeline 1796', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $sourceId, 0)"""
    )))
    pid
  }

  /** Rewrites the stored journal as one written before the fold-in: no `createdDataset` on any inline source. */
  private def asLegacyJournal(applicationId: String): Unit =
    await(privDb.run(sqlu"""UPDATE patch_set_applications SET edits = (
      SELECT jsonb_agg(CASE WHEN jsonb_exists(elem, 'inlineSources') THEN jsonb_set(elem, '{inlineSources}',
        (SELECT coalesce(jsonb_agg(s - 'createdDataset'), '[]'::jsonb) FROM jsonb_array_elements(elem->'inlineSources') s)) ELSE elem END ORDER BY ord)
      FROM jsonb_array_elements(edits) WITH ORDINALITY AS t(elem, ord)) WHERE id = $applicationId""")) shouldBe 1

  "the app role" should {
    "not bypass RLS" in {
      await(appDb.run(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe false
    }
  }

  "undoing a pipeline create that made an inline dataset root" should {
    "succeed, removing the pipeline, the source and its rows, when nothing changed (guard)" in {
      val r = applied(pipelineSet("Clean inline 1796", Vector(inlineRoot("Clean inline src 1796"))))
      val pid = r.edits.head.newId.get
      val sid = inlineIds(r.applicationId.get).head
      await(appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).isRight shouldBe true
      pipelineExists(pid) shouldBe false
      sourceExists(sid) shouldBe false
    }

    "refuse with a count, naming the source and no id, changing nothing, when a row was appended" in {
      val r = applied(pipelineSet("Appended inline 1796", Vector(inlineRoot("Appended inline src 1796"))))
      val pid = r.edits.head.newId.get
      val sid = inlineIds(r.applicationId.get).head
      val existing = rows(sid).map(_.id)
      append(sid)
      val msg = refusalOf(r.applicationId.get)
      msg should include("""edit 0 (pipeline create): its inline data source "Appended inline src 1796"""")
      msg should include("1 row(s) were added or replaced after the patch set was applied and would be deleted")
      msg should not include sid
      msg should not include pid
      existing.foreach(id => msg should not include id)
      pipelineExists(pid) shouldBe true
      sourceExists(sid) shouldBe true
      rowCount(sid) shouldBe 4
    }

    "refuse when the append lands on the second of two inline roots" in {
      val r = applied(pipelineSet("Two roots 1796", Vector(inlineRoot("First root 1796"), inlineRoot("Second root 1796"))))
      val pid = r.edits.head.newId.get
      val ids = inlineIds(r.applicationId.get)
      ids should have size 2
      val second = await(dataSourceRepo.findByIdInternal(DataSourceId(ids(1)))).get
      append(second.id.value)
      val msg = refusalOf(r.applicationId.get)
      msg should include(s""""${second.name}"""")
      msg should include("1 row(s) were added or replaced")
      msg should not include ids(0)
      msg should not include ids(1)
      pipelineExists(pid) shouldBe true
      ids.foreach(sourceExists(_) shouldBe true)
    }

    "refuse when a row the apply created was edited" in {
      val r = applied(pipelineSet("Edited inline 1796", Vector(inlineRoot("Edited inline src 1796"))))
      val sid = inlineIds(r.applicationId.get).head
      val first = rows(sid).head
      await(appDs.patchRow(DataSourceId(sid), first.id, first.updatedAt.toString, Vector(JsNumber(50)), owner)).getOrElse(fail("patchRow failed"))
      refusalOf(r.applicationId.get) should include("1 row(s) created by the patch set were edited after it was applied and the edits would be lost")
      sourceExists(sid) shouldBe true
    }

    "refuse when only the declared schema was edited, claiming no added rows" in {
      val r = applied(pipelineSet("Schema inline 1796", Vector(inlineRoot("Schema inline src 1796"))))
      val sid = inlineIds(r.applicationId.get).head
      await(appDs.updateDatasetSchema(DataSourceId(sid), UpdateDatasetSchemaRequest(Vector(DatasetFieldDeclarationPayload("value", None, "integer", Some(true)))), owner)).isRight shouldBe true
      val msg = refusalOf(r.applicationId.get)
      msg should include("the dataset schema was edited after the patch set was applied")
      msg should not include "were added or replaced"
      sourceExists(sid) shouldBe true
    }

    "keep a source another pipeline also uses (HEL-1493 option B) and succeed, rows and all (guard)" in {
      val r = applied(pipelineSet("Shared inline 1796", Vector(inlineRoot("Shared inline src 1796"))))
      val pid = r.edits.head.newId.get
      val sid = inlineIds(r.applicationId.get).head
      await(appPipelines.create(CreatePipelineRequest("Other visible pipeline 1796", Vector(CreatePipelineRootRequest(sourceId = Some(sid)))), owner)).getOrElse(fail("pipeline create failed"))
      append(sid)
      val undone = await(appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).getOrElse(fail("expected success"))
      undone.edits.head.inlineSources.getOrElse(fail("no inline outcome")).head.result shouldBe "kept"
      pipelineExists(pid) shouldBe false
      rowCount(sid) shouldBe 4
    }

    // HEL-1797 guard (passes on current code; failable by dropping `refs.panels.nonEmpty` from `referenced` in
    // `PatchSetUndoDatasetLaterWork.inlineFindings`): a FORM panel bound to an inline root is a reference, so the source is
    // kept and the undo succeeds even though a row was appended (later work that would refuse an unreferenced source).
    "keep a source a form panel binds, with its appended row, and succeed (guard)" in {
      val r = applied(pipelineSet("Form-bound inline 1797", Vector(inlineRoot("Form-bound inline src 1797"))))
      val pid = r.edits.head.newId.get
      val sid = inlineIds(r.applicationId.get).head
      val dashboardId = await(appDashboards.create(DashboardService.CreateDashboardInput(Some("Form-bound dashboard 1797")), owner))._1.id.value
      val formConfig = JsObject(
        "dataSourceId" -> JsString(sid),
        "fields"       -> JsArray(JsObject("sourceField" -> JsString("value"), "control" -> JsString("number"), "required" -> JsBoolean(true))),
        "submit"       -> JsObject("writeMode" -> JsString("append"))
      )
      await(appPanels.create(CreatePanelRequest(Some(dashboardId), Some("Form on inline 1797"), Some("form"), Some(formConfig)), owner)).getOrElse(fail("form create failed"))
      append(sid)
      val undone = await(appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).getOrElse(fail("expected success"))
      undone.edits.head.status shouldBe "restored"
      undone.edits.head.inlineSources.getOrElse(fail("no inline outcome")).head.result shouldBe "kept"
      pipelineExists(pid) shouldBe false
      sourceExists(sid) shouldBe true
      rowCount(sid) shouldBe 4
    }

    // HEL-1797 guard (passes on current code; failable by making the `Some(ids)` branch of `rootExcused` in
    // `PatchSetUndoLaterChildren` excuse nothing). The existing HEL-1811 excusal specs use `sourceId` roots only. Here the
    // roots are INLINE and journaled, and `appliedAt` is the epoch, so the `created_at <= appliedAt` fallback excuses none of
    // them: only the journaled rootIds do. (`PatchSetUndoInlineDatasetLaterWorkSpec`'s clean-undo test also reddens under
    // this mutation, but through the refusal path; this one asserts the blocker set directly, over several roots.)
    "excuse the inline roots the pipeline create itself made, by journaled id and not by timestamp (guard)" in {
      val r = applied(pipelineSet("Inline excuse 1797", Vector(inlineRoot("Excuse root A 1797"), inlineRoot("Excuse root B 1797"), inlineRoot("Excuse root C 1797"))))
      val pid = r.edits.head.newId.get
      val edit = journal(r.applicationId.get).head
      edit.createdChildren.flatMap(_.rootIds).getOrElse(fail("rootIds not journaled")) should have size 3
      val later = await(PatchSetUndoLaterChildren.blocking(edit, Vector(edit), Instant.EPOCH, owner, appUndo.context))
      later.roots shouldBe empty
      await(appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).isRight shouldBe true
      pipelineExists(pid) shouldBe false
      inlineIds(r.applicationId.get).foreach(sourceExists(_) shouldBe false)
    }

    "keep a source only a pipeline the undoing user cannot see uses, and succeed" in {
      val r = applied(pipelineSet("Hidden-shared inline 1796", Vector(inlineRoot("Hidden-shared inline src 1796"))))
      val pid = r.edits.head.newId.get
      val sid = inlineIds(r.applicationId.get).head
      insertPipelineOn(sid, otherIdStr)
      append(sid)
      val undone = await(appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).getOrElse(fail("expected success"))
      undone.edits.head.inlineSources.getOrElse(fail("no inline outcome")).head.result shouldBe "kept"
      pipelineExists(pid) shouldBe false
      rowCount(sid) shouldBe 4
    }

    "not count the undone pipeline's own later step reference, and so still refuse an appended row" in {
      val r = applied(pipelineSet("Own-ref inline 1796", Vector(inlineRoot("Own-ref inline src 1796"))))
      val pid = r.edits.head.newId.get
      val sid = inlineIds(r.applicationId.get).head
      val cfg = JsObject("secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(sid)), "mode" -> JsString("byPosition"))
      await(appPipelines.addStep(PipelineId(pid), CreatePipelineStepRequest("union", cfg), owner)).getOrElse(fail("addStep failed"))
      append(sid)
      // the step is itself a later step, refused by the HEL-1795 guard too; the inline message must still be there
      refusalOf(r.applicationId.get) should include("its inline data source \"Own-ref inline src 1796\"")
    }

    "undo a non-dataset inline root whose updated_at moved, and the pipeline" in {
      val r = applied(set(s"""{"edits":[{"target":{"kind":"pipeline"},"op":"create","patch":{"name":"Rest inline 1796","roots":[{"type":"rest_api","name":"Rest inline src 1796","restConfig":{"url":"http://example.invalid/data","method":"GET"}}],"steps":[],"outputs":[]}}]}"""))
      val pid = r.edits.head.newId.get
      val sid = inlineIds(r.applicationId.get).head
      await(privDb.run(sqlu"UPDATE data_sources SET updated_at = now() + interval '1 minute' WHERE id = $sid"))
      await(appUndo.undo(PatchSetApplicationId(r.applicationId.get), owner)).isRight shouldBe true
      pipelineExists(pid) shouldBe false
    }

    "fall back to the apply time on an old journal row: refuse an appended row" in {
      val r = applied(pipelineSet("Legacy inline 1796", Vector(inlineRoot("Legacy inline src 1796"))))
      val sid = inlineIds(r.applicationId.get).head
      asLegacyJournal(r.applicationId.get)
      journal(r.applicationId.get).head.inlineSources.get.head.createdDataset shouldBe None
      append(sid)
      refusalOf(r.applicationId.get) should include("1 row(s) were added or replaced")
      sourceExists(sid) shouldBe true
    }

    "journal the stored created_at and declared schema on each dataset inline root" in {
      val r = applied(pipelineSet("Journaled inline 1796", Vector(inlineRoot("J1 1796"), inlineRoot("J2 1796"))))
      val ids = inlineIds(r.applicationId.get)
      journal(r.applicationId.get).head.inlineSources.get.zip(ids).foreach { case (js, id) =>
        val stored = await(privDb.run(sql"SELECT created_at FROM data_sources WHERE id = $id".as[Timestamp].head)).toInstant
        js.createdDataset.flatMap(_.rowsStampedAt) shouldBe Some(stored)
        js.createdDataset.flatMap(_.declaredSchema).isDefined shouldBe true
      }
    }
  }

  "the Phase-2 re-check of an inline dataset root" should {
    /** A repository whose `datasetLaterWork` runs `onFirstRead` right after the first read (the Phase-1 check). */
    def undoWithHook(onFirstRead: () => Unit): PatchSetUndoService = {
      var reads = 0
      val hooked = new DataSourceRepository(appCtx) {
        override def datasetLaterWork(sourceId: DataSourceId, threshold: Instant): Future[Option[DataSourceRepository.DatasetLaterWork]] =
          super.datasetLaterWork(sourceId, threshold).map { result => reads += 1; if (reads == 1) onFirstRead(); result }
      }
      new PatchSetUndoService(
        appPanels, appDashboards, new DataSourceService(hooked, appFs), appPipelines, appPanelRepo, dashboardRepo, hooked, pipelineRepo, pipelineStepRepo, appApplicationRepo, outputRepo = outputRepo
      )
    }

    "fail the edit with a count-only phrase, deleting nothing, when a row lands after the Phase-1 check" in {
      val r = applied(pipelineSet("Recheck inline 1796", Vector(inlineRoot("Recheck inline src 1796"))))
      val pid = r.edits.head.newId.get
      val sid = inlineIds(r.applicationId.get).head
      val undo = undoWithHook(() => append(sid))
      val logs = errorLogsDuring {
        await(undo.undo(PatchSetApplicationId(r.applicationId.get), owner)).getOrElse(fail("expected outcomes")).edits.map(_.status) shouldBe Vector("failed")
      }
      val reason = logs.find(_.contains("undo restore failed")).getOrElse(fail(s"no ERROR log: $logs"))
      reason should include("1 inline data source(s) gained later work during the undo; nothing further was undone")
      reason should not include sid
      reason should not include "Recheck inline src"
      pipelineExists(pid) shouldBe true
      rowCount(sid) shouldBe 4
    }

    "not fail the edit when the source gained another user before the re-check: it is kept, as HEL-1493 says" in {
      val r = applied(pipelineSet("Recheck-ref inline 1796", Vector(inlineRoot("Recheck-ref inline src 1796"))))
      val pid = r.edits.head.newId.get
      val sid = inlineIds(r.applicationId.get).head
      val undo = undoWithHook(() => { insertPipelineOn(sid, ownerIdStr); append(sid) })
      val undone = await(undo.undo(PatchSetApplicationId(r.applicationId.get), owner)).getOrElse(fail("expected outcomes"))
      undone.edits.map(_.status) shouldBe Vector("restored")
      undone.edits.head.inlineSources.getOrElse(fail("no inline outcome")).head.result shouldBe "kept"
      pipelineExists(pid) shouldBe false
      rowCount(sid) shouldBe 4
    }
  }
}
