package com.helio.testsupport

import com.helio.api.http.{AccessCheckerImpl, AclDirective, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.domain.history.PayloadHistoryConfig
import com.helio.domain.model._
import com.helio.domain.steps.AssertConfig
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.auth.AccessChecker
import com.helio.services.pipelines.{OutputHistoryService, OutputService, PipelineRunService}
import com.helio.spark.PipelineRunCache
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.JdbcBackend
import spray.json._

import java.nio.file.Paths
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource
import scala.concurrent.ExecutionContext

/** HEL-1273: shared DB harness for the history-API specs. Boots Flyway-migrated embedded Postgres,
 *  a superuser `db` (the privileged pool AND the seeding connection) and an app pool that runs as a
 *  NOSUPERUSER, non-BYPASSRLS role (`SET ROLE` init SQL), so sharing visibility is genuinely
 *  enforced (`assertAppPoolEnforcesRls`). The `wrap*` hooks let a spec put a counting proxy on
 *  either pool. Specs call `startHarness()` from `beforeAll` and `stopHarness()` from `afterAll`. */
trait OutputHistoryApiHarness extends OutputHistoryFixtures {

  protected def harnessEc: ExecutionContext

  protected def wrapPrivileged(ds: DataSource): DataSource = ds
  protected def wrapApp(ds: DataSource): DataSource        = ds

  protected var embeddedPostgres: EmbeddedPostgres = _
  protected var db: JdbcBackend.Database           = _
  protected var appDb: JdbcBackend.Database        = _
  protected var ctx: DbContext                     = _
  protected var outputRepo: OutputRepository       = _
  protected var historyRepo: OutputHistoryRepository = _
  protected var payloadRepo: NodePayloadHistoryRepository = _
  protected var panelRepo: PanelRepository         = _
  protected var dashboardRepo: DashboardRepository = _
  protected var permissionRepo: ResourcePermissionRepository = _
  protected var accessChecker: AccessChecker       = _
  protected var aclDirective: AclDirective         = _
  protected var outputService: OutputService       = _
  protected var historyService: OutputHistoryService = _
  protected var pipelineRepo: PipelineRepository   = _
  protected var stepRepo: PipelineStepRepository   = _
  protected var dataSourceRepo: DataSourceRepository = _
  protected var runRepo: PipelineRunRepository     = _
  protected var snapshotRepo: NodeSnapshotRepository = _

  override protected def seedDb: JdbcBackend.Database = db

  private val roleName = "helio_app_test_output_history"

  protected def startHarness(): Unit = {
    implicit val ec: ExecutionContext = harnessEc
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    val superConn = embeddedPostgres.getPostgresDatabase.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(s"CREATE ROLE $roleName NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN")
      stmt.execute(s"GRANT $roleName TO postgres")
      stmt.execute(s"GRANT USAGE ON SCHEMA public TO $roleName")
      // After Flyway, so it covers `output_snapshot_history` too.
      stmt.execute(s"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $roleName")
      stmt.close()
    } finally superConn.close()

    db = JdbcBackend.Database.forDataSource(wrapPrivileged(embeddedPostgres.getPostgresDatabase), Some(10))
    val appCfg = new HikariConfig()
    appCfg.setDataSource(embeddedPostgres.getPostgresDatabase)
    appCfg.setMaximumPoolSize(10)
    appCfg.setConnectionInitSql(s"SET ROLE $roleName")
    appDb = JdbcBackend.Database.forDataSource(wrapApp(new HikariDataSource(appCfg)), Some(10))
    ctx = new DbContext(appDb, db)

    dataSourceRepo = new DataSourceRepository(ctx)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
    stepRepo       = new PipelineStepRepository(ctx)
    runRepo        = new PipelineRunRepository(ctx)
    snapshotRepo   = new NodeSnapshotRepository(ctx)
    outputRepo     = new OutputRepository(ctx)
    historyRepo    = new OutputHistoryRepository(ctx)
    payloadRepo    = new NodePayloadHistoryRepository(ctx)
    panelRepo      = new PanelRepository(ctx)
    dashboardRepo  = new DashboardRepository(ctx)
    permissionRepo = new ResourcePermissionRepository(ctx)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline", id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    accessChecker  = new AccessCheckerImpl(permissionRepo, registry)
    aclDirective   = new AclDirective(permissionRepo, registry, None)
    outputService  = new OutputService(outputRepo, panelRepo, accessChecker)
    historyService = new OutputHistoryService(outputRepo, historyRepo, payloadRepo)
  }

  protected def stopHarness(): Unit = { appDb.close(); db.close(); embeddedPostgres.close() }

  /** Through the APP pool: `(rolsuper OR rolbypassrls)` must be false, else every 404/200 below
   *  would be vacuous (RLS bypassed). */
  protected def appPoolBypassesRls(): Boolean =
    awaitDb(appDb.run(sql"SELECT (rolsuper OR rolbypassrls) FROM pg_roles WHERE rolname = current_user".as[Boolean].head))

  protected def assertAppPoolEnforcesRls(): Unit =
    if (appPoolBypassesRls()) throw new AssertionError("app pool role bypasses RLS (rolsuper OR rolbypassrls): visibility proof would be vacuous")

  protected def grantPipeline(pipelineId: String, granteeId: String, role: String = "viewer"): Unit =
    awaitDb(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                          VALUES ('pipeline', $pipelineId, $granteeId::uuid, $role, now())"""))

  /** Seeds a v1 summary; `metric` is the all-rows headline value (None = no metric). */
  protected def summaryOf(value: Option[Double], rowCount: Int = 10): JsObject =
    JsObject(
      "v" -> JsNumber(1), "rowCount" -> JsNumber(rowCount), "columns" -> JsObject.empty, "columnsTruncated" -> JsBoolean(false),
      "metric" -> JsObject("field" -> JsString("amount"), "agg" -> JsString("sum"), "value" -> value.fold[JsValue](JsNull)(v => JsNumber(v))),
      "series" -> JsNull
    )

  /** Inserts one history point through L1's own `insertAction`. */
  protected def addPoint(outputId: String, pipelineId: String, at: Instant, value: Option[Double], rowCount: Int = 10): Unit =
    awaitDb(db.run(historyRepo.insertAction(Seq(
      historyEntry(outputId, pipelineId, at).copy(rowCount = rowCount, summary = summaryOf(value, rowCount))
    ))))

  /** A rows-mode series summary (x -> y points) for series-bearing history points (HEL-1277). */
  protected def seriesSummary(ys: Seq[Double], rowCount: Int = 10): JsObject = {
    val series = JsObject(
      "mode" -> JsString("rows"), "x" -> JsString("day"), "y" -> JsString("amount"), "agg" -> JsNull,
      "points" -> JsArray(ys.zipWithIndex.map { case (y, i) => JsArray(JsString(s"d$i"), JsNumber(y)) }.toVector),
      "totalPoints" -> JsNumber(ys.size), "downsampled" -> JsBoolean(false)
    )
    summaryOf(None, rowCount).copy(fields = summaryOf(None, rowCount).fields + ("series" -> series))
  }

  /** Inserts one history point carrying `summary` verbatim. */
  protected def addPointWithSummary(outputId: String, pipelineId: String, at: Instant, summary: JsObject): Unit =
    awaitDb(db.run(historyRepo.insertAction(Seq(historyEntry(outputId, pipelineId, at).copy(summary = summary)))))

  /** A pipeline owned by `ownerId` with a metric Output whose config carries `compare` (raw seed, so
   *  no validation path is involved). Returns (pipelineId, outputId). */
  protected def seedMetricOutput(ownerId: String, compare: Option[String]): (String, String) = {
    val cfg = JsObject(Seq("fieldMapping" -> JsObject("value" -> JsString("amount"))) ++ compare.map(c => "compare" -> JsString(c)): _*)
    seedPipelineWithOutput(ownerId, "metric", cfg.compactPrint)
  }

  /** A real, runnable pipeline (dataset source of 5 rows + assert step + metric Output with the given
   *  config); `service` is a real `PipelineRunService` writing history through the production path. */
  protected def seedRunnablePipeline(ownerId: String, compare: String): (PipelineId, OutputId) = {
    implicit val ec: ExecutionContext = harnessEc
    val dsId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    val rows = (1 to 5).map(i => s"""["day$i","${i * 3}"]""").mkString("[", ",", "]")
    val payload = s"""{"columns":[{"name":"label","type":"string"},{"name":"amount","type":"string"}],"rows":$rows}"""
    awaitDb(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', $ownerId::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload),
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'p', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    val pipelineId = PipelineId(pid)
    val step = awaitDb(stepRepo.insertInternal(pipelineId, "assert", AssertConfig(Vector.empty), enabled = true, None, explicitRootId = None))
    val cfg = s"""{"fieldMapping":{"value":"amount"},"aggregation":{"value":"amount","agg":"sum"},"compare":"$compare"}""".parseJson.asJsObject
    val out = awaitDb(outputRepo.insertInternal(pipelineId, Some(step.id), UserId(ownerId), "metric", OutputKind.Metric, cfg, explicitRootId = None))
    (pipelineId, out.id)
  }

  /** Override to change the payload caps/tier limits used by `runService()`. */
  protected def payloadConfig: PayloadHistoryConfig = PayloadHistoryConfig.Defaults

  protected def runService(payloadCfg: PayloadHistoryConfig = payloadConfig): PipelineRunService = {
    implicit val ec: ExecutionContext = harnessEc
    new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, runRepo, new PipelineRunCache(), registry = null,
      new LocalFileSystem(Paths.get("/")), outputRepo = outputRepo, nodeSnapshotRepo = snapshotRepo, outputHistoryRepo = historyRepo,
      nodePayloadRepo = payloadRepo, payloadConfig = payloadCfg
    )
  }
}
