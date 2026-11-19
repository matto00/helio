package com.helio.services.panels

import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.domain.engine.DatasetRowValidator.FieldError
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.domain.util.SystemClock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.{AutoRunTriggerService, PipelineRunGuardConfig, PipelineRunService, PipelineSchedulerService, TriggerSource}
import com.helio.services.sources.DataSourceService
import com.helio.spark.PipelineRunCache
import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** An editor's form submit under RLS, as a real NOBYPASSRLS role (the two-role `helio_app_test` harness of
 *  `PipelineRunServiceUpsertSourceRlsSpec`), driven through the real `PanelService`: the row lands on the form
 *  owner's source although the editor's own database context can neither see nor write it, and the auto-run it arms
 *  is recorded for the editor and counted against the pipeline owner. */
class FormSubmitEditorRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private implicit val actorSystem: ActorSystem[Nothing] = ActorSystem(Behaviors.empty, "form-submit-editor-rls")
  private implicit val mat: Materializer         = SystemMaterializer(actorSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database        = _
  private var ctx: DbContext                     = _
  private var dataSourceRepo: DataSourceRepository = _
  private var panelService: PanelService         = _
  private var scheduler: PipelineSchedulerService = _

  private val owner  = UserId(UUID.randomUUID().toString)
  private val editor = UserId(UUID.randomUUID().toString)
  private val ownerUser  = AuthenticatedUser(owner)
  private val editorUser = AuthenticatedUser(editor)

  import PostgresProfile.api._

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    val superDs = embeddedPostgres.getPostgresDatabase
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs); privCfg.setMaximumPoolSize(5); privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
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
    } finally superConn.close()

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs); appCfg.setMaximumPoolSize(5); appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)
    dataSourceRepo = new DataSourceRepository(ctx)
    val dashboardRepo    = new DashboardRepository(ctx)
    val panelRepo        = new PanelRepository(ctx)
    val permissionRepo   = new ResourcePermissionRepository(ctx)
    val pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    val pipelineStepRepo = new PipelineStepRepository(ctx)
    val pipelineRootRepo = new PipelineRootRepository(ctx)
    val runRepo          = new PipelineRunRepository(ctx)
    val outputRepo       = new OutputRepository(ctx)
    val debounceRepo     = new PipelineAutoRunDebounceRepository(ctx)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val trigger = new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo, debounceSeconds = 0L)
    val fs      = new LocalFileSystem(Paths.get("/"))
    panelService = new PanelService(
      panelRepo, new AccessCheckerImpl(permissionRepo, registry), dashboardRepo, outputRepo = outputRepo,
      dataSourceRepo = dataSourceRepo, dataSourceService = new DataSourceService(dataSourceRepo, fs, autoRunTriggerService = trigger), fileSystem = fs
    )
    val runService = new PipelineRunService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo, runRepo, new PipelineRunCache(), registry = null, fs,
      outputRepo = outputRepo, pipelineRunGuardRepo = new PipelineRunGuardRepository(ctx),
      guardConfig = PipelineRunGuardConfig(rateLimitPerWindow = 1000, rateWindowSeconds = 60, maxConcurrent = 1000, concurrencyRetryAfterSeconds = 15, sourceFetchRateLimitPerWindow = 30),
      autoRunDebounceRepo = debounceRepo
    )
    scheduler = new PipelineSchedulerService(
      new PipelineScheduleRepository(ctx), pipelineRepo, pipelineStepRepo, runRepo, runService, SystemClock,
      autoRunDebounceRepo = debounceRepo, autoRunTriggerService = trigger, staleClaimAfterSeconds = 300L
    )

    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${owner.value}::uuid, ${owner.value + "@test.local"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${editor.value}::uuid, ${editor.value + "@test.local"}, now())"""
    )))
  }

  override def afterAll(): Unit = { actorSystem.terminate(); appDb.close(); privilegedDb.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private val schemaJson = """[{"name":"quantity","type":"integer","required":true},{"name":"note","type":"string","required":false}]"""

  private final case class Seeded(dashboardId: String, sourceId: String, panelId: PanelId, pipelineId: String)

  private def seed(): Seeded = {
    val dashboardId = UUID.randomUUID().toString
    val sourceId    = UUID.randomUUID().toString
    val panelId     = UUID.randomUUID().toString
    val pipelineId  = UUID.randomUUID().toString
    val config =
      s"""{"dataSourceId":"$sourceId","fields":[{"sourceField":"quantity","control":"number","required":true}],"submit":{"writeMode":"append"}}"""
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($dashboardId, 'd', ${owner.value}, now(), now(), '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${owner.value}::uuid)""",
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', $dashboardId, ${editor.value}::uuid, 'editor', now())""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, dataset_schema)
             VALUES ($sourceId, 'ds', 'dataset', '{}'::jsonb, ${owner.value}::uuid, now(), now(), $schemaJson::jsonb)""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id, form_config)
             VALUES ($panelId, $dashboardId, 'f', ${owner.value}, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}', 'form', ${owner.value}::uuid, $config::jsonb)""",
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pipelineId, 'pipe', ${owner.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES (${UUID.randomUUID().toString}, $pipelineId, $sourceId, 0)"""
    )))
    Seeded(dashboardId, sourceId, PanelId(panelId), pipelineId)
  }

  private def rowCount(sourceId: String): Int =
    await(ctx.withSystemContext(sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = $sourceId".as[Int].head))

  "an editor's form submit, as the NOBYPASSRLS role" should {

    "land one row on the form owner's source through the real service" in {
      val s = seed()
      val result = await(panelService.submitForm(s.panelId, Map("quantity" -> JsNumber(3)), editorUser))
      result.map(_.writerIsFormOwner) shouldBe Right(false)
      rowCount(s.sourceId) shouldBe 1
    }

    "write nothing when the same append runs in the editor's own database context" in {
      val s = seed()
      val build: (Vector[DatasetFieldDeclaration], Instant) => Either[Vector[FieldError], Vector[JsValue]] =
        (declaration, now) => FormSubmission.buildRow(FormPanelConfig(DataSourceId(s.sourceId), Vector(FormFieldSpec("quantity", "number", required = Some(true))), FormSubmitSpec.Default), declaration, Map("quantity" -> JsNumber(3)), now)
      await(dataSourceRepo.findByIdOwned(DataSourceId(s.sourceId), editorUser)) shouldBe None
      await(dataSourceRepo.appendBuiltRow(DataSourceId(s.sourceId), build, 500, Instant.now(), editorUser)) shouldBe None
      rowCount(s.sourceId) shouldBe 0
    }

    "read the bound declarations in the owner's context, and nothing in the editor's" in {
      val s = seed()
      await(dataSourceRepo.getDeclaredSchema(DataSourceId(s.sourceId), ownerUser)).map(_.map(_.name)) shouldBe Some(Vector("quantity", "note"))
      await(dataSourceRepo.getDeclaredSchema(DataSourceId(s.sourceId), editorUser)) shouldBe None
      await(panelService.formSchema(s.panelId, editorUser)).map(_.map(_.name)) shouldBe Right(Vector("quantity"))
    }

    "refuse a form whose owner does not own the bound source, writing nothing" in {
      val s = seed()
      await(ctx.withSystemContext(sqlu"""UPDATE data_sources SET owner_id = ${editor.value}::uuid WHERE id = ${s.sourceId}"""))
      val result = await(panelService.submitForm(s.panelId, Map("quantity" -> JsNumber(3)), editorUser))
      result.left.map(_.err.message) shouldBe Left("Data source not found")
      rowCount(s.sourceId) shouldBe 0
    }

    "store the editor on the debounce row and fire the run as the owner, recorded for the editor" in {
      val s = seed()
      await(panelService.submitForm(s.panelId, Map("quantity" -> JsNumber(3)), editorUser)) shouldBe a[Right[_, _]]
      await(ctx.withSystemContext(sql"SELECT triggered_by_user_id::text FROM pipeline_auto_run_debounce WHERE pipeline_id = ${s.pipelineId}".as[Option[String]].head)) shouldBe Some(editor.value)

      Thread.sleep(100)
      await(scheduler.tick())

      val runs = await(ctx.withSystemContext(
        sql"""SELECT triggered_by_user_id::text, trigger_source FROM pipeline_runs WHERE pipeline_id = ${s.pipelineId}""".as[(Option[String], String)]
      ))
      runs shouldBe Vector((Some(editor.value), TriggerSource.AutoRun))
      // The guard's rate window and the owner's concurrency count are keyed on the pipeline owner, never the editor.
      await(ctx.withSystemContext(sql"SELECT count(*) FROM pipeline_run_rate_window WHERE user_id = ${owner.value}::uuid".as[Int].head)) should be > 0
      await(ctx.withSystemContext(sql"SELECT count(*) FROM pipeline_run_rate_window WHERE user_id = ${editor.value}::uuid".as[Int].head)) shouldBe 0
    }
  }
}
