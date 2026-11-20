package com.helio.services.patchsets

import com.helio.api.JsonProtocols
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.sources.{RestApiConfigPayload, SqlSourceConfigPayload, StaticColumnPayload, StaticDataPayload, StaticDataSourceRequest, UpdateDataSourceRequest}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ServiceError
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.PipelineService
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1722: patch-set PREVIEW vs the DIRECT service write, for the edit kinds HEL-1638 left behind: `pipelineStep`
 *  create/update, `dataSource` create/update, and a `pipeline` create whose roots have no steps or Outputs.
 *
 *  The oracle is the service itself (`PipelineService.addStep`/`updateStep`/`create`, `DataSourceService.createStatic`/
 *  `update`), never `PatchSetApplyService` (after the fix apply's `resolveAll` agrees with preview by construction).
 *  Each corpus entry builds a fresh fixture, previews a one-edit set, then runs the direct write on the SAME fixture
 *  (preview writes nothing, asserted) and requires: accepted iff accepted, and every rejection is the same status with
 *  message `edit 0: <service message>`. A rejected direct write must also leave the snapshot untouched.
 *
 *  Same-set entries (design D7) run end to end through `PatchSetApplyService` and must stay green: a set whose later
 *  edit is only valid against the graph an earlier edit leaves must still apply.
 *
 *  Harness: private embedded Postgres; every service and repository runs on the non-BYPASSRLS `helio_app_test` role. */
class PatchSetPreviewWriteParitySpec
    extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var appDb: JdbcBackend.Database          = _
  private var privilegedDb: JdbcBackend.Database   = _
  private var ctx: DbContext                       = _
  private var stepRepo: PipelineStepRepository     = _
  private var dataSourceService: DataSourceService = _
  private var pipelineService: PipelineService     = _
  private var previewService: PatchSetPreviewService = _
  private var applyService: PatchSetApplyService   = _

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

    ctx = new DbContext(appDb, privilegedDb)(routeEc)
    implicit val ec: ExecutionContext = routeEc
    val dashboardRepo  = new DashboardRepository(ctx)
    val panelRepo      = new PanelRepository(ctx)
    val dataSourceRepo = new DataSourceRepository(ctx)
    val permissionRepo = new ResourcePermissionRepository(ctx)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
    stepRepo           = new PipelineStepRepository(ctx)
    val outputRepo     = new OutputRepository(ctx)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fs            = new LocalFileSystem(newTempDir("patch-set-preview-write-parity"))

    dataSourceService = new DataSourceService(dataSourceRepo, fs)
    val sourceService = new SourceService(dataSourceRepo, new RestApiConnectorDriver())
    pipelineService = new PipelineService(
      pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo, sourceService = sourceService, dataSourceService = dataSourceService
    )
    val dashboardService = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    val panelService     = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo)
    applyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, stepRepo,
      accessChecker, new PatchSetApplicationRepository(ctx), outputRepo
    )
    previewService = new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, stepRepo, accessChecker, outputRepo, sourceService, SourceFetchBudget.default()
    )
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private def newUser(): AuthenticatedUser = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"wp-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def grant(pipelineId: String, grantee: AuthenticatedUser, role: String): Unit =
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', $pipelineId, ${grantee.id.value}::uuid, $role, now())"""))

  private def source(owner: AuthenticatedUser, name: String = "Src"): String =
    await(dataSourceService.createStatic(
      StaticDataSourceRequest(name, "static", Vector(StaticColumnPayload("value", "integer")), Vector(Vector(JsNumber(1)))), owner
    )).fold(e => fail(s"seed source failed: $e"), _.id.value)

  private def pipeline(owner: AuthenticatedUser, roots: Vector[String]): String =
    await(pipelineService.create(CreatePipelineRequest(s"P-${UUID.randomUUID()}", roots.map(r => CreatePipelineRootRequest(Some(r)))), owner))
      .fold(e => fail(s"seed pipeline failed: $e"), _.id)

  private def limit(n: Int): JsObject = JsObject("count" -> JsNumber(n))
  private def unionLane(stepId: String): JsObject =
    JsObject("secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString(stepId)), "mode" -> JsString("byPosition"))
  private def unionSource(sourceId: String): JsObject =
    JsObject("secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(sourceId)), "mode" -> JsString("byPosition"))
  private def upsertTo(sourceId: String): JsObject =
    JsObject(
      "target" -> JsObject("kind" -> JsString("existingSource"), "dataSourceId" -> JsString(sourceId)),
      "mode"   -> JsString("append")
    )

  private def addStep(pid: String, owner: AuthenticatedUser, kind: String, cfg: JsObject, parent: Option[String] = None, tail: Boolean = false): String =
    await(pipelineService.addStep(PipelineId(pid), CreatePipelineStepRequest(kind, cfg, parentStepId = parent, attachAsTail = if (tail) Some(true) else None), owner))
      .fold(e => fail(s"seed step failed: $e"), _.id)

  /** s1 (limit) <- s2 (union over an own source, child of s1) and s3 (union lane -> s2, a tail sibling of s2 under s1). */
  private final case class Graph(owner: AuthenticatedUser, pid: String, srcId: String, s1: String, s2: String, s3: String)
  private def graph(): Graph = {
    val owner = newUser()
    val src   = source(owner)
    val pid   = pipeline(owner, Vector(src))
    val s1    = addStep(pid, owner, "limit", limit(5))
    val s2    = addStep(pid, owner, "union", unionSource(src), parent = Some(s1))
    val s3    = addStep(pid, owner, "union", unionLane(s2), parent = Some(s1), tail = true)
    Graph(owner, pid, src, s1, s2, s3)
  }

  private def createEdit(pid: String, req: CreatePipelineStepRequest): Edit = {
    val fields = Map("type" -> JsString(req.`type`), "config" -> req.config) ++
      req.position.map("position" -> JsNumber(_)) ++ req.enabled.map("enabled" -> JsBoolean(_)) ++
      req.parentStepId.map("parentStepId" -> JsString(_)) ++ req.attachAsTail.map("attachAsTail" -> JsBoolean(_)) ++
      req.rootId.map("rootId" -> JsString(_)) ++ req.rejectIfReparents.map("rejectIfReparents" -> JsBoolean(_))
    Edit(EditTarget("pipelineStep", None, Some(pid)), "create", None, None, None, None, None, Some(JsObject(fields)))
  }
  private def updateEdit(stepId: String, req: UpdatePipelineStepRequest): Edit =
    Edit(EditTarget("pipelineStep", Some(stepId)), "update", None, None, None, None, Some(req), None)

  // ── corpus machinery ──────────────────────────────────────────────────────────────────────────────────────────────

  private final case class Scenario(user: AuthenticatedUser, edit: Edit, direct: () => Future[Either[ServiceError, Any]], snapshot: () => String)
  private final case class Entry(family: String, name: String, accept: Boolean)(val build: () => Scenario)

  private def stepsSnapshot(pid: String): () => String =
    () => await(stepRepo.listByPipelineInternal(PipelineId(pid))).map(_.toString).mkString("|")

  private def ownerSnapshot(owner: AuthenticatedUser): () => String = () =>
    await(ctx.withSystemContext(
      sql"""SELECT (SELECT count(*) FROM pipelines WHERE owner_id = ${owner.id.value}::uuid)::text || '/' ||
                   (SELECT coalesce(string_agg(name, ',' ORDER BY name), '') FROM data_sources WHERE owner_id = ${owner.id.value}::uuid)""".as[String].head))

  private def createEntry(family: String, name: String, accept: Boolean)(build: Graph => (AuthenticatedUser, String, CreatePipelineStepRequest)): Entry =
    Entry(family, name, accept) { () =>
      val g                   = graph()
      val (user, pid, req)    = build(g)
      Scenario(user, createEdit(pid, req), () => pipelineService.addStep(PipelineId(pid), req, user), stepsSnapshot(g.pid))
    }

  private def updateEntry(family: String, name: String, accept: Boolean)(build: Graph => (AuthenticatedUser, String, UpdatePipelineStepRequest)): Entry =
    Entry(family, name, accept) { () =>
      val g                   = graph()
      val (user, stepId, req) = build(g)
      Scenario(user, updateEdit(stepId, req), () => pipelineService.updateStep(PipelineStepId(stepId), req, user), stepsSnapshot(g.pid))
    }

  private def cfgUpdate(cfg: JsObject) = UpdatePipelineStepRequest(None, Some(cfg), None)

  private val bigRows = Vector.fill(501)(Vector[JsValue](JsNumber(1)))

  private def staticReq(name: String = "S", cols: Vector[StaticColumnPayload] = Vector(StaticColumnPayload("value", "integer")),
                        rows: Vector[Vector[JsValue]] = Vector(Vector(JsNumber(1))), tag: Option[String] = None) =
    StaticDataSourceRequest(name, "static", cols, rows, tag)

  private def dsCreateEntry(name: String, accept: Boolean)(req: StaticDataSourceRequest): Entry =
    Entry("dataSource create", name, accept) { () =>
      val owner = newUser()
      val edit  = Edit(EditTarget("dataSource", None), "create", None, None, None, None, None,
        Some(JsObject("name" -> JsString(req.name), "type" -> JsString(req.`type`),
          "columns" -> JsArray(req.columns.map(c => JsObject(Map("name" -> JsString(c.name), "type" -> JsString(c.`type`)) ++ c.required.map("required" -> JsBoolean(_)) ++ c.default.map("default" -> _)))),
          "rows" -> JsArray(req.rows.map(r => JsArray(r))))))
      Scenario(owner, edit, () => dataSourceService.createStatic(req, owner), ownerSnapshot(owner))
    }

  private def dsUpdateEntry(name: String, accept: Boolean)(patchName: Option[String], foreign: Boolean): Entry =
    Entry("dataSource update", name, accept) { () =>
      val owner = newUser()
      val other = newUser()
      val id    = source(if (foreign) other else owner)
      val req   = UpdateDataSourceRequest(patchName)
      Scenario(owner, Edit(EditTarget("dataSource", Some(id)), "update", None, None, Some(req), None, None, None),
        () => dataSourceService.update(DataSourceId(id), req, owner), ownerSnapshot(owner))
    }

  private def rootsEntry(name: String, accept: Boolean)(roots: AuthenticatedUser => Vector[CreatePipelineRootRequest]): Entry =
    Entry("pipeline create (roots only)", name, accept) { () =>
      val owner = newUser()
      val req   = CreatePipelineRequest(s"P-${UUID.randomUUID()}", roots(owner))
      Scenario(owner, Edit(EditTarget("pipeline", None), "create", None, None, None, None, None, Some(createPipelineRequestFormat.write(req))),
        () => pipelineService.create(req, owner), ownerSnapshot(owner))
    }

  private val sqlRoot = (query: String) => CreatePipelineRootRequest(
    `type` = Some("sql"), name = Some("Inline sql"), sqlConfig = Some(SqlSourceConfigPayload("postgresql", "localhost", 5432, "db", "u", "p", query)))

  private val corpus: Vector[Entry] = Vector(
    // ── pipelineStep create ─────────────────────────────────────────────────────────────────────────────────────────
    createEntry("step create", "accepts a tail append", accept = true)(g => (g.owner, g.pid, CreatePipelineStepRequest("limit", limit(3)))),
    createEntry("step create", "accepts position 1", accept = true)(g => (g.owner, g.pid, CreatePipelineStepRequest("limit", limit(3), position = Some(1)))),
    createEntry("step create", "unknown type", accept = false)(g => (g.owner, g.pid, CreatePipelineStepRequest("bogus", limit(3)))),
    createEntry("step create", "raw config problem (aggregate percentile without p)", accept = false) { g =>
      (g.owner, g.pid, CreatePipelineStepRequest("aggregate", JsObject("groupBy" -> JsArray(),
        "aggregations" -> JsArray(JsObject("alias" -> JsString("a"), "fn" -> JsString("percentile"), "field" -> JsString("v"))))))
    },
    createEntry("step create", "config that does not decode", accept = false)(g => (g.owner, g.pid, CreatePipelineStepRequest("limit", JsObject("count" -> JsString("many"))))),
    createEntry("step create", "unknown pipeline", accept = false)(g => (g.owner, UUID.randomUUID().toString, CreatePipelineStepRequest("limit", limit(3)))),
    createEntry("step create", "stranger (no grant)", accept = false)(g => (newUser(), g.pid, CreatePipelineStepRequest("limit", limit(3)))),
    createEntry("step create", "viewer grantee", accept = false) { g => val v = newUser(); grant(g.pid, v, "viewer"); (v, g.pid, CreatePipelineStepRequest("limit", limit(3))) },
    createEntry("step create", "editor grantee", accept = true) { g => val e = newUser(); grant(g.pid, e, "editor"); (e, g.pid, CreatePipelineStepRequest("limit", limit(3))) },
    createEntry("step create", "secondary source owned by someone else", accept = false)(g => (g.owner, g.pid, CreatePipelineStepRequest("union", unionSource(source(newUser()))))),
    createEntry("step create", "lane to a missing step", accept = false)(g => (g.owner, g.pid, CreatePipelineStepRequest("union", unionLane("nope")))),
    createEntry("step create", "lane to a prospective ancestor", accept = false)(g => (g.owner, g.pid, CreatePipelineStepRequest("union", unionLane(g.s1)))),
    createEntry("step create", "lane to a step the insert re-parents (descendant)", accept = false)(g =>
      (g.owner, g.pid, CreatePipelineStepRequest("union", unionLane(g.s1), position = Some(0)))),
    createEntry("step create", "upsert target owned by someone else", accept = false)(g => (g.owner, g.pid, CreatePipelineStepRequest("upsertsource", upsertTo(source(newUser()))))),
    createEntry("step create", "upsert target is the editor's own source (targets stay owner-owned)", accept = false) { g =>
      val e = newUser(); grant(g.pid, e, "editor"); (e, g.pid, CreatePipelineStepRequest("upsertsource", upsertTo(source(e))))
    },
    createEntry("step create", "placement: parentStepId and rootId both named", accept = false)(g =>
      (g.owner, g.pid, CreatePipelineStepRequest("limit", limit(3), parentStepId = Some(g.s1), rootId = Some("r")))),
    createEntry("step create", "placement: unknown root", accept = false)(g => (g.owner, g.pid, CreatePipelineStepRequest("limit", limit(3), rootId = Some("nope")))),
    createEntry("step create", "placement: unknown parent", accept = false)(g => (g.owner, g.pid, CreatePipelineStepRequest("limit", limit(3), parentStepId = Some("nope")))),
    createEntry("step create", "placement: position out of range", accept = false)(g => (g.owner, g.pid, CreatePipelineStepRequest("limit", limit(3), position = Some(99)))),
    createEntry("step create", "placement: several roots, none named", accept = false) { g =>
      val pid2 = pipeline(g.owner, Vector(g.srcId, source(g.owner, "Second")))
      (g.owner, pid2, CreatePipelineStepRequest("limit", limit(3)))
    },
    createEntry("step create", "rejectIfReparents when the insert would move steps", accept = false)(g =>
      (g.owner, g.pid, CreatePipelineStepRequest("limit", limit(3), parentStepId = Some(g.s1), rejectIfReparents = Some(true)))),
    createEntry("step create", "rejectIfReparents with nothing to move", accept = true)(g =>
      (g.owner, g.pid, CreatePipelineStepRequest("limit", limit(3), parentStepId = Some(g.s2), rejectIfReparents = Some(true)))),

    // ── pipelineStep update ─────────────────────────────────────────────────────────────────────────────────────────
    updateEntry("step update", "accepts a config change", accept = true)(g => (g.owner, g.s1, cfgUpdate(limit(9)))),
    updateEntry("step update", "accepts an enabled flip", accept = true)(g => (g.owner, g.s1, UpdatePipelineStepRequest(None, None, None, Some(false)))),
    updateEntry("step update", "unknown step", accept = false)(g => (g.owner, UUID.randomUUID().toString, cfgUpdate(limit(9)))),
    updateEntry("step update", "stranger (invisible pipeline)", accept = false)(g => (newUser(), g.s1, cfgUpdate(limit(9)))),
    updateEntry("step update", "viewer grantee", accept = false) { g => val v = newUser(); grant(g.pid, v, "viewer"); (v, g.s1, cfgUpdate(limit(9))) },
    updateEntry("step update", "editor grantee", accept = true) { g => val e = newUser(); grant(g.pid, e, "editor"); (e, g.s1, cfgUpdate(limit(9))) },
    updateEntry("step update", "type change", accept = false)(g => (g.owner, g.s1, UpdatePipelineStepRequest(Some("union"), Some(limit(9)), None))),
    updateEntry("step update", "raw config problem", accept = false)(g => (g.owner, g.s1, cfgUpdate(JsObject("count" -> JsString("many"), "extra" -> JsNull)))),
    updateEntry("step update", "secondary source owned by someone else", accept = false)(g => (g.owner, g.s2, cfgUpdate(unionSource(source(newUser()))))),
    updateEntry("step update", "lane to a missing step", accept = false)(g => (g.owner, g.s2, cfgUpdate(unionLane("nope")))),
    updateEntry("step update", "lane to itself", accept = false)(g => (g.owner, g.s2, cfgUpdate(unionLane(g.s2)))),
    updateEntry("step update", "lane to an ancestor", accept = false)(g => (g.owner, g.s2, cfgUpdate(unionLane(g.s1)))),
    updateEntry("step update", "lane to a step that depends on it through a lane link", accept = false)(g => (g.owner, g.s2, cfgUpdate(unionLane(g.s3)))),
    updateEntry("step update", "upsert target owned by someone else", accept = false) { g =>
      val up = addStep(g.pid, g.owner, "upsertsource", upsertTo(source(g.owner, "UpsertTarget")), parent = Some(g.s2))
      (g.owner, up, cfgUpdate(upsertTo(source(newUser()))))
    },

    // ── dataSource create / update ──────────────────────────────────────────────────────────────────────────────────
    dsCreateEntry("accepts a valid dataset", accept = true)(staticReq()),
    dsCreateEntry("blank name", accept = false)(staticReq(name = "  ")),
    dsCreateEntry("row cap (501 rows)", accept = false)(staticReq(rows = bigRows)),
    dsCreateEntry("bad column type", accept = false)(staticReq(cols = Vector(StaticColumnPayload("value", "wat")))),
    dsCreateEntry("bad default for the column type", accept = false)(staticReq(cols = Vector(StaticColumnPayload("value", "integer", default = Some(JsString("abc")))))),
    dsCreateEntry("row that does not validate", accept = false)(staticReq(rows = Vector(Vector(JsString("x"))))),
    dsCreateEntry("required column left null", accept = false)(staticReq(cols = Vector(StaticColumnPayload("value", "integer", required = Some(true))), rows = Vector(Vector(JsNull)))),
    dsUpdateEntry("accepts a rename", accept = true)(Some("Renamed"), foreign = false),
    dsUpdateEntry("blank name", accept = false)(Some("   "), foreign = false),
    dsUpdateEntry("blank name on a source the caller does not own", accept = false)(Some(" "), foreign = true),
    dsUpdateEntry("source the caller does not own", accept = false)(Some("Renamed"), foreign = true),

    // ── pipeline create, roots but no steps or Outputs ──────────────────────────────────────────────────────────────
    rootsEntry("existing source root is accepted", accept = true)(o => Vector(CreatePipelineRootRequest(Some(source(o))))),
    rootsEntry("inline static root is accepted", accept = true)(_ =>
      Vector(CreatePipelineRootRequest(`type` = Some("static"), name = Some("Inline"), staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("v", "integer")), Vector(Vector(JsNumber(1)))))))),
    rootsEntry("inline static root with a row that does not validate", accept = false)(_ =>
      Vector(CreatePipelineRootRequest(`type` = Some("static"), name = Some("Inline"), staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("v", "integer")), Vector(Vector(JsString("x")))))))),
    rootsEntry("inline static root over the row cap", accept = false)(_ =>
      Vector(CreatePipelineRootRequest(`type` = Some("static"), name = Some("Inline"), staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("v", "integer")), bigRows))))),
    rootsEntry("inline static root with a bad column type", accept = false)(_ =>
      Vector(CreatePipelineRootRequest(`type` = Some("static"), name = Some("Inline"), staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("v", "wat")), Vector(Vector(JsNumber(1)))))))),
    rootsEntry("inline sql root whose query is not a read", accept = false)(_ => Vector(sqlRoot("DROP TABLE users"))),
    rootsEntry("inline rest root naming both connectorId and url", accept = false)(_ =>
      Vector(CreatePipelineRootRequest(`type` = Some("rest_api"), name = Some("Inline rest"),
        restConfig = Some(RestApiConfigPayload(connectorId = Some("c"), url = Some("http://localhost/x"))))))
  )

  "patch-set preview vs the direct service write" should {
    corpus.foreach { e =>
      s"[${e.family}] ${e.name}" in {
        val sc     = e.build()
        val before = sc.snapshot()
        val prev   = await(previewService.preview(PatchSet(None, Vector(sc.edit)), sc.user))
        withClue("preview must write nothing: ") { sc.snapshot() shouldBe before }
        val direct = await(sc.direct())
        withClue(s"direct write accepted? (expected ${e.accept}) -> $direct: ") { direct.isRight shouldBe e.accept }
        withClue(s"preview accepted? (expected ${e.accept}) -> ${prev.left.toOption}: ") { prev.isRight shouldBe e.accept }
        if (!e.accept) {
          val p = prev.left.getOrElse(fail("preview accepted"))
          val d = direct.left.getOrElse(fail("direct accepted"))
          p.getClass shouldBe d.getClass
          p.message shouldBe s"edit 0: ${d.message}"
          withClue("a rejected direct write must leave nothing behind: ") { sc.snapshot() shouldBe before }
        }
      }
    }
  }

  "same-set graph edits (design D7), applied end to end" should {
    "apply two creates at position N then N+1 (the second is only valid after the first)" in {
      val g = graph() // s1, s2, s3 -> three steps
      val n = 3
      val set = PatchSet(None, Vector(
        createEdit(g.pid, CreatePipelineStepRequest("limit", limit(1), position = Some(n))),
        createEdit(g.pid, CreatePipelineStepRequest("limit", limit(2), position = Some(n + 1)))
      ))
      await(applyService.apply(set, g.owner)).fold(e => fail(s"apply refused: $e"), r => r.failure shouldBe None)
      await(stepRepo.listByPipelineInternal(PipelineId(g.pid))).size shouldBe 5
    }

    "apply an update dropping D's lane to T followed by an update giving T a lane to D" in {
      val g = graph() // s3 has a lane to s2; s2 -> lane to s3 would be refused against the stored graph
      val set = PatchSet(None, Vector(
        updateEdit(g.s3, cfgUpdate(unionSource(g.srcId))),
        updateEdit(g.s2, cfgUpdate(unionLane(g.s3)))
      ))
      await(applyService.apply(set, g.owner)).fold(e => fail(s"apply refused: $e"), r => r.failure shouldBe None)
    }

    "still judge a step create's graph checks at preview when an earlier edit touches a DIFFERENT pipeline" in {
      val g     = graph()
      val other = pipeline(g.owner, Vector(g.srcId))
      val set = PatchSet(None, Vector(
        createEdit(other, CreatePipelineStepRequest("limit", limit(1))),
        createEdit(g.pid, CreatePipelineStepRequest("limit", limit(2), position = Some(99)))
      ))
      val prev = await(previewService.preview(set, g.owner))
      prev.left.map(_.message) shouldBe Left("edit 1: position must be between 0 and 3 (the pipeline's current step count)")
    }
  }
}
