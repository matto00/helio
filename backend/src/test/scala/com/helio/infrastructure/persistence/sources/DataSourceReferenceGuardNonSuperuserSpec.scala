package com.helio.infrastructure.persistence.sources

import com.helio.domain.model.{AuditSource, AuthenticatedUser, CsvSource, CsvSourceConfig, DataSourceId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.sources.DataSourceService
import com.helio.testkit.TempDirectorySupport
import com.typesafe.config.ConfigFactory
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import ch.qos.logback.classic.{Level, Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.postgresql.util.PSQLException
import org.slf4j.{Logger, LoggerFactory}
import slick.jdbc.JdbcBackend

import java.sql.{Connection, DriverManager}
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1252 -- the non-superuser (RLS-honouring) proof for the data-source reference guard and the
 *  workspace-teardown dependent check. Dev/CI normally connect as a BYPASSRLS superuser, which makes
 *  every visibility claim pass vacuously (MISTAKES.md), so this spec runs over TWO genuinely distinct
 *  pools -- an app pool as `helio_migration_test` (NOSUPERUSER NOBYPASSRLS, FORCE RLS applies) and a
 *  separate `helio_privileged` pool -- exactly like `V100ZeroRootGuardNonSuperuserSpec` (whose role
 *  setup is copied verbatim). A third, superuser pool backs the "RLS masked" contrast fixtures.
 *
 *  Fixtures are inserted on a privileged connection so no insert is ever gated by RLS. */
class DataSourceReferenceGuardNonSuperuserSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll
    with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def ec: ExecutionContext                       = typedSystem.executionContext
  private def await[T](f: Future[T]): T                  = Await.result(f, 30.seconds)

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var migrationUrl: String                 = _
  private var appDb: JdbcBackend.Database          = _
  private var privilegedDb: JdbcBackend.Database   = _
  private var superDb: JdbcBackend.Database        = _
  private var ctx: DbContext                       = _
  private var superCtx: DbContext                  = _
  private var dataSourceRepo: DataSourceRepository = _
  private var fileSystem: LocalFileSystem          = _
  private var service: DataSourceService           = _
  private var teardownRepo: WorkspaceTeardownRepository      = _
  private var superTeardownRepo: WorkspaceTeardownRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val superConn = embeddedPostgres.getPostgresDatabase.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute("CREATE ROLE helio_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      stmt.execute("ALTER SCHEMA public OWNER TO helio_migration_test")
      stmt.execute("GRANT CREATE, USAGE ON SCHEMA public TO helio_migration_test")
      stmt.execute("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      stmt.execute("GRANT helio_privileged TO helio_migration_test WITH ADMIN OPTION")
      stmt.close()
    } finally superConn.close()

    migrationUrl = embeddedPostgres.getJdbcUrl("helio_migration_test", "postgres")
    Flyway.configure().dataSource(migrationUrl, "helio_migration_test", "test")
      .locations("classpath:db/migration").load().migrate()

    val sep = if (migrationUrl.contains('?')) "&" else "?"
    appDb = JdbcBackend.Database.forURL(
      s"$migrationUrl${sep}stringtype=unspecified",
      user = "helio_migration_test", password = "test", driver = "org.postgresql.Driver"
    )
    privilegedDb = JdbcBackend.Database.forConfig(
      "privileged",
      ConfigFactory.parseString(
        s"""privileged {
           |  url = "$migrationUrl${sep}stringtype=unspecified"
           |  user = "helio_migration_test"
           |  password = "test"
           |  driver = "org.postgresql.Driver"
           |  connectionInitSql = "SET ROLE helio_privileged"
           |  numThreads = 2
           |  connectionPool = "HikariCP"
           |}""".stripMargin
      )
    )
    // The superuser pool exists ONLY for the pre-fix contrast ("RLS masks the leak"), never for a guarantee.
    val superUrl = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    superDb = JdbcBackend.Database.forURL(
      s"$superUrl${if (superUrl.contains('?')) "&" else "?"}stringtype=unspecified",
      user = "postgres", password = "", driver = "org.postgresql.Driver"
    )

    ctx            = new DbContext(appDb, privilegedDb)(ec)
    superCtx       = new DbContext(superDb, superDb)(ec)
    dataSourceRepo = new DataSourceRepository(ctx)(ec)
    fileSystem     = new LocalFileSystem(newTempDir("hel1252-ref-guard"))(ec)
    service        = new DataSourceService(dataSourceRepo, fileSystem)
    teardownRepo      = new WorkspaceTeardownRepository(ctx)(ec)
    superTeardownRepo = new WorkspaceTeardownRepository(superCtx)(ec)
  }

  override def afterAll(): Unit = {
    if (appDb != null) appDb.close()
    if (privilegedDb != null) privilegedDb.close()
    if (superDb != null) superDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  // ── fixture helpers (privileged connection: inserts are never RLS-gated) ──────────────────────

  private def authUser(id: String): AuthenticatedUser = AuthenticatedUser(UserId(id), AuditSource.Ui, None)
  private def uuid(): String                          = UUID.randomUUID().toString

  private def withPriv[T](f: Connection => T): T = {
    val conn = DriverManager.getConnection(migrationUrl, "helio_migration_test", "test")
    try {
      conn.setAutoCommit(true)
      val s = conn.createStatement(); s.execute("SET ROLE helio_privileged"); s.close()
      f(conn)
    } finally conn.close()
  }
  private def exec(conn: Connection, sql: String): Unit = {
    val s = conn.createStatement()
    try s.execute(sql) finally s.close()
  }
  private def q(s: String): String = s.replace("'", "''")
  private def tagSql(tag: Option[String]): String = tag.map(t => s"'${q(t)}'").getOrElse("NULL")

  private def seedUser(id: String): String = {
    withPriv(exec(_, s"INSERT INTO users (id, email, created_at) VALUES ('$id'::uuid, 'ref1252-$id@test.local', now()) ON CONFLICT (id) DO NOTHING"))
    id
  }

  /** A dataset source owned by `owner`. */
  private def seedSource(owner: String, name: String, tag: Option[String] = None): String = {
    val id = uuid()
    withPriv(exec(_,
      s"""INSERT INTO data_sources (id, name, source_type, config, owner_id, tag, created_at, updated_at)
         |VALUES ('$id', '${q(name)}', 'dataset', '{"columns":[],"rows":[]}', '$owner'::uuid, ${tagSql(tag)}, now(), now())""".stripMargin))
    id
  }

  /** A file-backed CSV source, so a refused delete can be shown to leave the file. */
  private def seedCsvSource(owner: String, name: String): (DataSourceId, String) = {
    val path = s"ref1252-${uuid()}.csv"
    await(fileSystem.write(path, "a,b\n1,2\n".getBytes))
    val src = CsvSource(DataSourceId(uuid()), name, UserId(owner), Instant.now(), Instant.now(), CsvSourceConfig(path))
    await(dataSourceRepo.insert(src, authUser(owner)))
    (src.id, path)
  }

  /** A pipeline owned by `owner` with one root per `rootSources` (position order); returns (pipelineId, rootIds). */
  private def seedPipeline(owner: String, name: String, rootSources: Vector[String], tag: Option[String] = None): (String, Vector[String]) = {
    val pid = uuid()
    val rootIds = rootSources.map(_ => uuid())
    withPriv { c =>
      exec(c, s"INSERT INTO pipelines (id, name, owner_id, tag, created_at, updated_at) VALUES ('$pid', '${q(name)}', '$owner'::uuid, ${tagSql(tag)}, now(), now())")
      rootSources.zip(rootIds).zipWithIndex.foreach { case ((ds, rid), i) =>
        exec(c, s"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ('$rid', '$pid', '$ds', $i)")
      }
    }
    (pid, rootIds)
  }

  private def seedStep(pipelineId: String, rootId: String, op: String, config: String, enabled: Boolean = true, position: Int = 0): String = {
    val id = uuid()
    withPriv(exec(_,
      s"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, root_id, enabled)
         |VALUES ('$id', '$pipelineId', $position, '$op', '${q(config)}', '$rootId', $enabled)""".stripMargin))
    id
  }

  private def secondaryJson(src: String) = s"""{"secondaryInput":{"kind":"source","dataSourceId":"$src"}}"""
  private def upsertJson(src: String)    = s"""{"target":{"kind":"existingSource","dataSourceId":"$src"},"mode":"append"}"""

  private def seedDashboard(owner: String, name: String, tag: Option[String] = None): String = {
    val id = uuid()
    withPriv(exec(_,
      s"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id, tag)
         |VALUES ('$id', '${q(name)}', '$owner', now(), now(), '{"background":"transparent","gridBackground":"transparent"}', '{"lg":[],"md":[],"sm":[],"xs":[]}', '$owner'::uuid, ${tagSql(tag)})""".stripMargin))
    id
  }

  private def seedFormPanel(dashboardId: String, owner: String, title: String, src: String): String = {
    val id = uuid()
    withPriv(exec(_,
      s"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id, form_config)
         |VALUES ('$id', '$dashboardId', '${q(title)}', '$owner', now(), now(),
         |        '{"background":"transparent","color":"inherit","transparency":0.0}', 'form', '$owner'::uuid,
         |        '{"dataSourceId":"$src","fields":[],"submit":{}}'::jsonb)""".stripMargin))
    id
  }

  private def grant(resourceType: String, resourceId: String, grantee: Option[String]): Unit =
    withPriv(exec(_,
      s"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role)
         |VALUES ('$resourceType', '$resourceId', ${grantee.map(g => s"'$g'::uuid").getOrElse("NULL")}, 'viewer')""".stripMargin))

  private def sourceExists(id: String): Boolean =
    withPriv { c =>
      val rs = c.createStatement().executeQuery(s"SELECT count(*) FROM data_sources WHERE id = '$id'")
      rs.next(); rs.getInt(1) == 1
    }

  private def pipelineExists(id: String): Boolean =
    withPriv { c =>
      val rs = c.createStatement().executeQuery(s"SELECT count(*) FROM pipelines WHERE id = '$id'")
      rs.next(); rs.getInt(1) == 1
    }

  /** Fixture liveness (mandatory): the app role, under RLS, genuinely cannot see the foreign pipeline. */
  private def appRoleSeesPipeline(viewer: String, pipelineId: String): Boolean = {
    val conn = DriverManager.getConnection(migrationUrl, "helio_migration_test", "test")
    try {
      conn.setAutoCommit(true)
      exec(conn, s"SELECT set_config('app.current_user_id', '$viewer', false)")
      val rs = conn.createStatement().executeQuery(s"SELECT count(*) FROM pipelines WHERE id = '$pipelineId'")
      rs.next(); rs.getInt(1) == 1
    } finally conn.close()
  }

  private def teardown(repo: WorkspaceTeardownRepository, tag: String, dryRun: Boolean, caller: String) =
    await(repo.teardown(tag, dryRun, authUser(caller)))

  // ── 1.2 / 6.3: teardown, hidden referencing pipeline, non-superuser ────────────────────────────

  "workspace teardown over a non-BYPASSRLS app pool" should {

    "6.3a block, unnamed, when a HIDDEN pipeline joins the tagged source (secondary input)" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val base   = seedSource(stranger, "ref-base")
      val (pid, roots) = seedPipeline(stranger, "STRANGER-JOIN-PIPELINE", Vector(base))
      seedStep(pid, roots.head, "join", secondaryJson(target))
      appRoleSeesPipeline(caller, pid) shouldBe false // liveness

      val out = teardown(teardownRepo, tag, dryRun = false, caller)
      withClue(s"outcome=$out: ") {
        out.blocked shouldBe true
        out.committed shouldBe false
        out.toString should not include pid
        out.toString should not include "STRANGER-JOIN-PIPELINE"
        out.conflicts.map(_.reason).foreach { r => r should startWith("This data source "); r should endWith(".") }
      }
      sourceExists(target) shouldBe true
    }

    "6.3b block, unnamed, when a HIDDEN pipeline has the tagged source as one of SEVERAL roots" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val other  = seedSource(stranger, "ref-other")
      val (pid, _) = seedPipeline(stranger, "STRANGER-MULTIROOT-PIPELINE", Vector(other, target))
      appRoleSeesPipeline(caller, pid) shouldBe false

      val out = teardown(teardownRepo, tag, dryRun = false, caller)
      withClue(s"outcome=$out: ") {
        out.blocked shouldBe true
        out.toString should not include pid
        out.toString should not include "STRANGER-MULTIROOT-PIPELINE"
      }
      sourceExists(target) shouldBe true
      pipelineExists(pid) shouldBe true
    }

    "6.3c block, unnamed, when a HIDDEN pipeline is SOLELY rooted on the tagged source (pre-fix: V99/V100 P0001)" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val (pid, _) = seedPipeline(stranger, "STRANGER-SOLEROOT-PIPELINE", Vector(target))
      appRoleSeesPipeline(caller, pid) shouldBe false

      val out = teardown(teardownRepo, tag, dryRun = false, caller)
      withClue(s"outcome=$out: ") {
        out.blocked shouldBe true
        out.toString should not include pid
        out.toString should not include "STRANGER-SOLEROOT-PIPELINE"
      }
      sourceExists(target) shouldBe true
    }

    "6.3d dry run reports the same hidden-reference block a real call would hit" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val base   = seedSource(stranger, "ref-base")
      val (pid, roots) = seedPipeline(stranger, "STRANGER-DRY-PIPELINE", Vector(base))
      seedStep(pid, roots.head, "lookup", secondaryJson(target))

      val out = teardown(teardownRepo, tag, dryRun = true, caller)
      out.blocked shouldBe true
      out.toString should not include pid
    }

    "6.3e block, unnamed, when a HIDDEN pipeline's upsert step targets the tagged source" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val base   = seedSource(stranger, "ref-base")
      val (pid, roots) = seedPipeline(stranger, "STRANGER-UPSERT-PIPELINE", Vector(base))
      seedStep(pid, roots.head, "upsertsource", upsertJson(target))

      val out = teardown(teardownRepo, tag, dryRun = false, caller)
      out.blocked shouldBe true
      out.toString should not include pid
      sourceExists(target) shouldBe true
    }

    "6.3f block, unnamed, when a HIDDEN form panel (foreign dashboard) is bound to the tagged source" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val dash   = seedDashboard(stranger, "STRANGER-DASHBOARD")
      val panel  = seedFormPanel(dash, stranger, "STRANGER-FORM-PANEL", target)

      val out = teardown(teardownRepo, tag, dryRun = false, caller)
      out.blocked shouldBe true
      out.toString should not include panel
      out.toString should not include dash
      out.toString should not include "STRANGER-FORM-PANEL"
      sourceExists(target) shouldBe true
    }
  }

  "workspace teardown over a BYPASSRLS superuser pool (the dev/CI shape)" should {
    "6.4d name no hidden id or name (pre-fix the superuser connection SEES and names the hidden root pipeline)" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val other  = seedSource(stranger, "ref-other")
      val (pid, _) = seedPipeline(stranger, "STRANGER-SUPER-PIPELINE", Vector(other, target))

      val out = teardown(superTeardownRepo, tag, dryRun = false, caller)
      withClue(s"outcome=$out: ") {
        out.blocked shouldBe true
        out.toString should not include pid
        out.toString should not include "STRANGER-SUPER-PIPELINE"
      }
    }
  }


  // ── teardown: visible naming, in-batch exemption, foreign tagged dependents ────────────────────

  "workspace teardown dependent check (any role)" should {

    "6.4a name a VISIBLE out-of-batch referencing pipeline and form panel" in {
      val caller = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val base   = seedSource(caller, "ref-base")
      val (pid, roots) = seedPipeline(caller, "VISIBLE-JOIN-PIPELINE", Vector(base)) // untagged
      seedStep(pid, roots.head, "join", secondaryJson(target))
      val dash  = seedDashboard(caller, "VISIBLE-DASH") // untagged
      val panel = seedFormPanel(dash, caller, "VISIBLE-FORM-PANEL", target)

      val out = teardown(teardownRepo, tag, dryRun = false, caller)
      out.blocked shouldBe true
      val reason = out.conflicts.map(_.reason).mkString
      reason should include(pid); reason should include("VISIBLE-JOIN-PIPELINE"); reason should include("join input")
      reason should include(panel); reason should include("VISIBLE-FORM-PANEL")
    }

    "6.4b exempt exactly what this call deletes: caller-owned T-tagged pipeline and T-tagged dashboard's form panel" in {
      val caller = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val base   = seedSource(caller, "ref-base")
      val (pid, roots) = seedPipeline(caller, "IN-BATCH-PIPELINE", Vector(base), Some(tag))
      seedStep(pid, roots.head, "join", secondaryJson(target))
      seedStep(pid, roots.head, "upsertsource", upsertJson(target), position = 1)
      val dash = seedDashboard(caller, "IN-BATCH-DASH", Some(tag))
      seedFormPanel(dash, caller, "IN-BATCH-PANEL", target)

      val out = teardown(teardownRepo, tag, dryRun = false, caller)
      withClue(s"outcome=$out: ") {
        out.blocked shouldBe false
        out.committed shouldBe true
      }
      sourceExists(target) shouldBe false
      pipelineExists(pid) shouldBe false
      sourceExists(base) shouldBe true
    }

    "6.4c another user's identically T-tagged referencing pipeline still blocks, and is neither deleted nor counted" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val base   = seedSource(stranger, "ref-base")
      val (pid, roots) = seedPipeline(stranger, "FOREIGN-TAGGED-PIPELINE", Vector(base), Some(tag))
      seedStep(pid, roots.head, "join", secondaryJson(target))

      val out = teardown(teardownRepo, tag, dryRun = false, caller)
      out.blocked shouldBe true
      out.pipelinesDeleted shouldBe 0
      out.toString should not include pid
      out.toString should not include "FOREIGN-TAGGED-PIPELINE"
      pipelineExists(pid) shouldBe true
      sourceExists(target) shouldBe true
    }

    "6.4g a foreign T-tagged pipeline and T-tagged dashboard that are VISIBLE (granted to the caller) still block, named, never deleted" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val base   = seedSource(stranger, "ref-base")
      val (pid, roots) = seedPipeline(stranger, "GRANTED-TAGGED-PIPELINE", Vector(base), Some(tag))
      seedStep(pid, roots.head, "join", secondaryJson(target))
      grant("pipeline", pid, Some(caller))
      val dash = seedDashboard(stranger, "GRANTED-TAGGED-DASH", Some(tag))
      grant("dashboard", dash, Some(caller))
      val panel = seedFormPanel(dash, stranger, "GRANTED-TAGGED-PANEL", target)

      val out = teardown(teardownRepo, tag, dryRun = false, caller)
      out.blocked shouldBe true
      val reason = out.conflicts.map(_.reason).mkString
      reason should include(pid)
      reason should include(panel)
      pipelineExists(pid) shouldBe true
      sourceExists(target) shouldBe true
    }

    "6.4e a form panel on an untagged dashboard blocks; the dashboard shared WITH the caller is named" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val dash = seedDashboard(stranger, "SHARED-WITH-CALLER-DASH")
      grant("dashboard", dash, Some(caller))
      seedFormPanel(dash, stranger, "SHARED-PANEL", target)

      val out = teardown(teardownRepo, tag, dryRun = false, caller)
      out.blocked shouldBe true
      out.conflicts.map(_.reason).mkString should include("SHARED-PANEL")
    }

    "6.4f the IN-TRANSACTION narrowing check blocks identity-free on a BYPASSRLS connection (which sees hidden pipelines)" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val target = seedSource(caller, "ref-target", Some(tag))
      val other  = seedSource(stranger, "ref-other")
      // Multi-root, so the V99/V100 trigger never fires and the in-tx query is what blocks.
      val (pid, _) = seedPipeline(stranger, "STRANGER-INTX-PIPELINE", Vector(other, target))
      // Skip the privileged pre-check so the in-tx query is the only thing that can block.
      val inTxOnly = new WorkspaceTeardownRepository(superCtx)(ec) {
        override protected def dependentConflicts(t: String, u: AuthenticatedUser) =
          super.dependentConflicts(t, u).map { case (sources, _) => (sources, Vector.empty) }(ec)
      }
      val out = teardown(inTxOnly, tag, dryRun = false, caller)
      withClue(s"outcome=$out: ") {
        out.blocked shouldBe true
        out.conflicts should not be empty
        out.toString should not include pid
        out.toString should not include "STRANGER-INTX-PIPELINE"
      }
      sourceExists(target) shouldBe true
    }
  }

  // ── delete guard (non-superuser two-pool) ──────────────────────────────────────────────────────

  private def deleteConflict(src: DataSourceId, caller: String) = {
    val r = await(service.delete(src, authUser(caller)))
    withClue(s"delete result=$r: ") { r.isLeft shouldBe true }
    r.left.toOption.get.conflict.get
  }

  /** Every hidden-reference scenario: a foreign pipeline holding the reference `kind`, owned by `stranger`. */
  private def seedHiddenReference(kind: String, target: String, stranger: String): (String, String) = {
    kind match {
      case "root" =>
        val other = seedSource(stranger, "ref-other")
        val (pid, _) = seedPipeline(stranger, "STRANGER-PIPELINE", Vector(other, target)); (pid, "STRANGER-PIPELINE")
      case "form" =>
        val dash = seedDashboard(stranger, "STRANGER-DASH")
        val panel = seedFormPanel(dash, stranger, "STRANGER-PANEL", target); (panel, "STRANGER-PANEL")
      case op =>
        val base = seedSource(stranger, "ref-base")
        val (pid, roots) = seedPipeline(stranger, "STRANGER-PIPELINE", Vector(base))
        seedStep(pid, roots.head, op, if (op == "upsertsource") upsertJson(target) else secondaryJson(target))
        (pid, "STRANGER-PIPELINE")
    }
  }

  "DataSourceService.delete over a non-BYPASSRLS app pool" should {
    for (kind <- Seq("root", "join", "lookup", "union", "upsertsource", "form")) {
      s"6.2a refuse with an UNNAMED 409 when a HIDDEN $kind reference exists, leaving the file" in {
        val caller = seedUser(uuid()); val stranger = seedUser(uuid())
        val (src, path) = seedCsvSource(caller, "ref-csv")
        val (hiddenId, hiddenName) = seedHiddenReference(kind, src.value, stranger)

        val c = deleteConflict(src, caller)
        c.pipelines shouldBe empty
        c.panels shouldBe empty
        c.reason should not include hiddenId
        c.reason should not include hiddenName
        c.reason should include("you cannot access")
        // Structured hidden counts are COUNTS ONLY (C2) and tailor the remediation to the kind present.
        (c.hiddenPipelineCount, c.hiddenPanelCount) shouldBe (if (kind == "form") (0, 1) else (1, 0))
        c.reason should startWith("This source is still referenced by ")
        c.reason should endWith(").")
        if (kind == "form") { c.reason should not include "pipeline editor"; c.reason should include("form panel") }
        else { c.reason should include("pipeline editor"); c.reason should not include "form panel or delete" }
        await(fileSystem.exists(path)) shouldBe true
        sourceExists(src.value) shouldBe true
      }
    }

    "6.2b name VISIBLE references with their kinds: owned pipeline (root + join), granted pipeline, owned and granted form panel" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val src = seedSource(caller, "ref-target")
      val base = seedSource(caller, "ref-base")
      val (own, ownRoots) = seedPipeline(caller, "OWN-PIPELINE", Vector(base, src))
      seedStep(own, ownRoots.head, "join", secondaryJson(src))
      val other = seedSource(stranger, "ref-other")
      val (shared, sharedRoots) = seedPipeline(stranger, "SHARED-PIPELINE", Vector(other))
      seedStep(shared, sharedRoots.head, "upsertsource", upsertJson(src))
      grant("pipeline", shared, Some(caller))
      val ownDash = seedDashboard(caller, "OWN-DASH")
      val ownPanel = seedFormPanel(ownDash, caller, "OWN-PANEL", src)
      val sharedDash = seedDashboard(stranger, "SHARED-DASH")
      grant("dashboard", sharedDash, Some(caller))
      val sharedPanel = seedFormPanel(sharedDash, stranger, "SHARED-PANEL", src)

      val c = deleteConflict(DataSourceId(src), caller)
      c.pipelines.map(p => p.id -> p.references).toMap shouldBe Map(own -> Vector("root", "join"), shared -> Vector("upsertTarget"))
      c.panels.map(_.id).toSet shouldBe Set(ownPanel, sharedPanel)
      c.panels.find(_.id == sharedPanel).get.dashboardName shouldBe "SHARED-DASH"
      c.panels.find(_.id == sharedPanel).get.dashboardId shouldBe sharedDash
      c.reason should not include "you cannot access"
    }

    "6.2c C1: a pipeline shared with a THIRD user, and a dashboard shared with a third user AND publicly, stay unnamed" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid()); val third = seedUser(uuid())
      val src = seedSource(caller, "ref-target")
      val base = seedSource(stranger, "ref-base")
      val (pid, roots) = seedPipeline(stranger, "THIRD-PARTY-PIPELINE", Vector(base))
      seedStep(pid, roots.head, "join", secondaryJson(src))
      grant("pipeline", pid, Some(third))
      grant("pipeline", pid, None) // grantee-less
      val dash = seedDashboard(stranger, "THIRD-PARTY-DASH")
      grant("dashboard", dash, Some(third))
      grant("dashboard", dash, None)
      val panel = seedFormPanel(dash, stranger, "THIRD-PARTY-PANEL", src)

      val c = deleteConflict(DataSourceId(src), caller)
      c.pipelines shouldBe empty
      c.panels shouldBe empty
      c.reason should (not include pid and not include "THIRD-PARTY-PIPELINE" and not include panel and not include "THIRD-PARTY-PANEL" and not include dash)
      c.reason should include("a pipeline you cannot access")
      c.reason should include("a form panel you cannot access")
      (c.hiddenPipelineCount, c.hiddenPanelCount) shouldBe ((1, 1))
    }

    "6.2d count hidden RESOURCES, not reference edges: a hidden pipeline holding root + join counts once" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val src = seedSource(caller, "ref-target")
      val (pid, roots) = seedPipeline(stranger, "STRANGER-TWO-EDGES", Vector(src))
      seedStep(pid, roots.head, "join", secondaryJson(src))
      val c = deleteConflict(DataSourceId(src), caller)
      c.reason should include("a pipeline you cannot access")
      c.reason should not include "2 pipelines"
      c.hiddenPipelineCount shouldBe 1
    }

    "6.2e a disabled step still blocks" in {
      val caller = seedUser(uuid())
      val src = seedSource(caller, "ref-target"); val base = seedSource(caller, "ref-base")
      val (pid, roots) = seedPipeline(caller, "DISABLED-STEP-PIPELINE", Vector(base))
      seedStep(pid, roots.head, "union", secondaryJson(src), enabled = false)
      deleteConflict(DataSourceId(src), caller).pipelines.map(_.references) shouldBe Vector(Vector("union"))
    }

    "6.2f lane, newSource and empty-draft secondary inputs are NOT references: delete succeeds" in {
      val caller = seedUser(uuid())
      val src = seedSource(caller, "ref-target"); val base = seedSource(caller, "ref-base")
      val (pid, roots) = seedPipeline(caller, "NON-REF-PIPELINE", Vector(base))
      seedStep(pid, roots.head, "join", """{"secondaryInput":{"kind":"lane","stepId":"x"}}""", position = 0)
      seedStep(pid, roots.head, "union", """{"secondaryInput":{"kind":"source","dataSourceId":""}}""", position = 1)
      seedStep(pid, roots.head, "upsertsource", """{"target":{"kind":"newSource","name":"n"},"mode":"append"}""", position = 2)
      seedStep(pid, roots.head, "lookup", "not json at all", position = 3)
      await(service.delete(DataSourceId(src), authUser(caller))) shouldBe Right(())
      sourceExists(src) shouldBe false
    }
  }

  // ── C2: warn+ logs never carry a hidden id (race path) ────────────────────────────────────────

  private def captureLogs[T](body: => T): (T, Vector[ILoggingEvent]) = {
    val root = LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME).asInstanceOf[LogbackLogger]
    val appender = new ListAppender[ILoggingEvent]()
    appender.start()
    root.addAppender(appender)
    try { val r = body; (r, appender.list.asScala.toVector) }
    finally root.detachAppender(appender)
  }

  private def eventText(e: ILoggingEvent): String =
    e.getFormattedMessage + Option(e.getThrowableProxy).map(t => t.getMessage + t.getStackTraceElementProxyArray.mkString).getOrElse("")

  "the race-path P0001 mappings (C2)" should {

    "6.6a DataSourceService.delete: warn+ log names the source id and SQLSTATE only, never the hidden pipeline" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val src = seedSource(caller, "ref-target")
      val (pid, _) = seedPipeline(stranger, "STRANGER-RACE-PIPELINE", Vector(src)) // hidden SOLE root
      // A stale/empty finder result = the check-then-delete race: the pre-check sees nothing, the trigger fires.
      val racing = new DataSourceRepository(ctx)(ec) {
        override def findReferences(id: DataSourceId, user: AuthenticatedUser) =
          Future.successful(DataSourceReferenceRepository.SourceReferences(Vector.empty, 0, Vector.empty, 0))
      }
      val racingService = new DataSourceService(racing, fileSystem)
      val (result, events) = captureLogs(await(racingService.delete(DataSourceId(src), authUser(caller))))

      val c = result.left.toOption.get.conflict.get
      c.reason should not include pid
      val warns = events.filter(_.getLevel.isGreaterOrEqual(Level.WARN))
      withClue("the race path must actually have warned (else this test is vacuous): ") {
        warns.exists(e => e.getFormattedMessage.contains(src) && e.getFormattedMessage.contains("P0001")) shouldBe true
      }
      warns.foreach { e => withClue(s"warn+ event leaks the hidden pipeline id: ${eventText(e)}") { eventText(e) should not include pid } }
      sourceExists(src) shouldBe true
    }

    "6.6b teardown: a P0001 from its own DELETE blocks, with no hidden id in the body or a warn+ log" in {
      val caller = seedUser(uuid()); val stranger = seedUser(uuid())
      val tag = s"t-${uuid()}"
      val src = seedSource(caller, "ref-target", Some(tag))
      val (pid, _) = seedPipeline(stranger, "STRANGER-RACE-PIPELINE", Vector(src)) // hidden SOLE root
      val racing = new WorkspaceTeardownRepository(ctx)(ec) {
        // Stale pre-check (the race): no conflicts, so the in-tx transaction proceeds to its DELETE.
        override protected def dependentConflicts(t: String, u: AuthenticatedUser) =
          super.dependentConflicts(t, u).map { case (sources, _) => (sources, Vector.empty) }(ec)
      }
      val (out, events) = captureLogs(await(racing.teardown(tag, dryRun = false, authUser(caller))))
      out.blocked shouldBe true
      out.committed shouldBe false
      out.toString should not include pid
      events.filter(_.getLevel.isGreaterOrEqual(Level.WARN)).foreach { e =>
        withClue(s"warn+ event leaks the hidden pipeline id: ${eventText(e)}") { eventText(e) should not include pid }
      }
      sourceExists(src) shouldBe true
    }
  }
}
