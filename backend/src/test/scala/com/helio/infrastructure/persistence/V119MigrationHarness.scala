package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.{FlywayException, MigrationVersion}
import org.scalatest.{BeforeAndAfterAll, Suite}
import org.scalatest.matchers.should.Matchers

import java.sql.{Connection, ResultSet, SQLException}
import java.util.concurrent.atomic.AtomicInteger

/** HEL-1347 / HEL-1433: the shared harness of the V119 migration specs ([[V119OwnerFkCleanupSpec]],
 *  [[V119OwnerFkGuardSpec]], [[V119OwnerFkMigrationSpec]]), split along their scenario seams.
 *
 *  Why this shape (see V117DeadOutputConfigKeysMigrationSpec and FlywayNonSuperuserMigrationSpec for the full
 *  story): prod's Flyway role is a table-owning NOSUPERUSER NOBYPASSRLS role whose connection never sets
 *  `app.current_user_id`, and every table V119 touches is FORCE ROW LEVEL SECURITY. A superuser run (CI's, local dev's)
 *  bypasses RLS and would show a missing bracket as green, and V119's own guard shares the migration's RLS state, so it
 *  is blind to a missing bracket on a fail-silent table. So: the migration runs as `helio_migration_test` (the prod
 *  shape), and EVERY count is read over the superuser connection, which RLS cannot hide anything from.
 *
 *  Each scenario gets its own database cloned from one template migrated to V118, so scenarios cannot contaminate each
 *  other (one aborted migration, one seeded orphan) and a scenario that needs a hostile fixture is cheap. Each mixing
 *  suite owns its own embedded Postgres (per-suite lifecycle).
 */
trait V119MigrationHarness extends BeforeAndAfterAll { this: Suite with Matchers =>

  protected val Role = "helio_migration_test"
  protected val Template = "tpl118"

  protected val U1 = "00000000-0000-0000-0000-0000000000a1" // a live user
  protected val U2 = "00000000-0000-0000-0000-0000000000a2" // a second live user
  protected val Ghost = "00000000-0000-0000-0000-0000000000ff" // an owner id with no users row

  protected val BracketedTables = Seq("data_sources", "image_uploads", "pipeline_roots", "pipeline_steps", "panels")

  private lazy val pg: EmbeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
  private val dbSeq = new AtomicInteger(0)

  override def beforeAll(): Unit = {
    val su = superConn("postgres")
    try {
      exec(su, s"CREATE ROLE $Role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      exec(su, s"CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      exec(su, s"GRANT helio_privileged TO $Role WITH ADMIN OPTION")
      exec(su, s"CREATE DATABASE $Template")
      // The role must be the prod shape, and helio_privileged must really bypass RLS.
      rows(su, s"SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '$Role'")(r => (r.getBoolean(1), r.getBoolean(2))) shouldBe Vector((false, false))
      rows(su, "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'helio_privileged'")(_.getBoolean(1)) shouldBe Vector(true)
    } finally su.close()
    val tc = superConn(Template)
    try {
      exec(tc, s"ALTER SCHEMA public OWNER TO $Role")
      exec(tc, s"GRANT CREATE, USAGE ON SCHEMA public TO $Role")
    } finally tc.close()
    flyway(Template, Some("118")).migrate()
  }

  override def afterAll(): Unit = pg.close()

  // ── plumbing ─────────────────────────────────────────────────────────────────────────────────────────────────

  protected def superConn(db: String): Connection = pg.getDatabase("postgres", db).getConnection
  protected def flyway(db: String, target: Option[String]): Flyway = {
    val b = Flyway.configure().dataSource(pg.getJdbcUrl(Role, db), Role, "test").locations("classpath:db/migration")
    target.foreach(t => b.target(MigrationVersion.fromVersion(t)))
    b.load()
  }
  protected def rows[T](c: Connection, sql: String)(f: ResultSet => T): Vector[T] = {
    val st = c.createStatement()
    try {
      val rs = st.executeQuery(sql)
      try Iterator.continually(rs).takeWhile(_.next()).map(f).toVector
      finally rs.close()
    } finally st.close()
  }
  protected def exec(c: Connection, sql: String): Unit = { val st = c.createStatement(); try st.execute(sql) finally st.close() }
  protected def count(c: Connection, sql: String): Int = rows(c, sql)(_.getInt(1)).head
  protected def sqlState(c: Connection, sql: String): Option[String] =
    try { exec(c, sql); None }
    catch { case e: SQLException => Some(e.getSQLState) }

  /** A fresh database cloned from the V118 template; `body` gets a superuser connection to it. */
  protected def withDb[T](body: (String, Connection) => T): T = {
    val db = s"v119_${dbSeq.incrementAndGet()}"
    val su = superConn("postgres")
    try exec(su, s"CREATE DATABASE $db TEMPLATE $Template") finally su.close()
    val c = superConn(db)
    try body(db, c) finally c.close()
  }

  protected def forced(c: Connection): Map[String, Boolean] =
    rows(c, s"SELECT relname, relforcerowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN (${BracketedTables.map("'" + _ + "'").mkString(",")})")(
      r => r.getString(1) -> r.getBoolean(2)).toMap
  protected def assertForceOnEverywhere(c: Connection): Unit = forced(c) shouldBe BracketedTables.map(_ -> true).toMap

  // ── seeding (superuser; pre-V119 constraints) ───────────────────────────────────────────────────────────────

  protected def user(c: Connection, id: String): Unit = exec(c, s"INSERT INTO users (id, email) VALUES ('$id', 'u-$id@example.test')")
  protected def ds(c: Connection, id: String, owner: Option[String], rowCount: Int = 0): Unit = {
    exec(c, s"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id)
               |VALUES ('$id', '$id', 'dataset', '{}'::jsonb, now(), now(), ${owner.map("'" + _ + "'").getOrElse("NULL")})""".stripMargin)
    (1 to rowCount).foreach { i =>
      exec(c, s"INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at) VALUES ('$id-r$i', '$id', $i, '{}'::jsonb, now(), now())")
    }
  }
  protected def image(c: Connection, id: String, owner: String): Unit =
    exec(c, s"INSERT INTO image_uploads (id, owner_id, storage_key, mime_type, filename, size_bytes) VALUES ('$id', '$owner', 'k-$id', 'image/png', '$id.png', 1)")
  protected def pipeline(c: Connection, id: String, owner: String): Unit =
    exec(c, s"INSERT INTO pipelines (id, name, owner_id) VALUES ('$id', '$id', '$owner')")
  protected def root(c: Connection, id: String, pipeline: String, source: String, position: Int): Unit =
    exec(c, s"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ('$id', '$pipeline', '$source', $position)")
  /** A first-of-lane step (carries `root_id`). */
  protected def rootStep(c: Connection, id: String, pipeline: String, rootId: String, op: String = "filter", config: String = "{}"): Unit =
    exec(c, s"INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, root_id) VALUES ('$id', '$pipeline', 0, '$op', '${config.replace("'", "''")}', '$rootId')")
  /** A later step of a lane (hangs off its parent via `parent_step_id`). */
  protected def childStep(c: Connection, id: String, pipeline: String, parent: String): Unit =
    exec(c, s"INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, parent_step_id) VALUES ('$id', '$pipeline', 1, 'limit', '{}', '$parent')")
  protected def output(c: Connection, id: String, pipeline: String, rootId: String, owner: String): Unit =
    exec(c, s"INSERT INTO outputs (id, pipeline_id, root_id, owner_id, name, kind) VALUES ('$id', '$pipeline', '$rootId', '$owner', '$id', 'table')")
  protected def stepOutput(c: Connection, id: String, pipeline: String, stepId: String, owner: String): Unit =
    exec(c, s"INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind) VALUES ('$id', '$pipeline', '$stepId', '$owner', '$id', 'table')")
  protected def dashboard(c: Connection, id: String, owner: String): Unit =
    exec(c, s"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               |VALUES ('$id', '$id', 'test', now(), now(), '{}'::jsonb, '{}'::jsonb, '$owner')""".stripMargin)
  protected def formPanel(c: Connection, id: String, dashboardId: String, owner: String, sourceId: String): Unit =
    exec(c, s"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, owner_id, kind, form_config)
               |VALUES ('$id', '$dashboardId', '$id', 'test', now(), now(), '{}'::jsonb, '$owner', 'form', '{"dataSourceId": "$sourceId"}'::jsonb)""".stripMargin)
  protected def outputPanel(c: Connection, id: String, dashboardId: String, owner: String, outputId: String): Unit =
    exec(c, s"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, owner_id, kind, output_id)
               |VALUES ('$id', '$dashboardId', '$id', 'test', now(), now(), '{}'::jsonb, '$owner', 'output', '$outputId')""".stripMargin)

  protected def ids(c: Connection, table: String): Set[String] = rows(c, s"SELECT id FROM $table")(_.getString(1)).toSet
  /** Users minus the system user a migration seeds (id ...0001). */
  protected def userIds(c: Connection): Set[String] = ids(c, "users") - "00000000-0000-0000-0000-000000000001"
  protected def v119Applied(c: Connection): Boolean =
    count(c, "SELECT count(*) FROM flyway_schema_history WHERE version = '119' AND success") == 1

  /** Run V119 as the prod-shaped role and return the failure message, asserting nothing was deleted and RLS is intact. */
  protected def expectGuardAbort(db: String, c: Connection, messagePart: String): Unit = {
    val before = BracketedTables.map(t => t -> ids(c, t)).toMap ++ Map("dataset_rows" -> ids(c, "dataset_rows"))
    val ex = intercept[FlywayException](flyway(db, Some("119")).migrate())
    withClue(s"failure message: ${ex.getMessage}\n") {
      ex.getMessage should include("HEL-1347:")
      ex.getMessage should include(messagePart)
    }
    // Nothing deleted, V119 not recorded, and the rollback restored FORCE RLS on every relaxed table.
    (BracketedTables.map(t => t -> ids(c, t)).toMap ++ Map("dataset_rows" -> ids(c, "dataset_rows"))) shouldBe before
    v119Applied(c) shouldBe false
    assertForceOnEverywhere(c)
  }
}
