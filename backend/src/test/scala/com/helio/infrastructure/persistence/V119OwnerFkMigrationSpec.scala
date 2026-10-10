package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.FlywayException
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Paths}
import java.sql.{Connection, DriverManager, ResultSet, SQLException}
import java.util.concurrent.atomic.AtomicInteger
import scala.jdk.CollectionConverters._

/** HEL-1347: V119 binds `data_sources` and `image_uploads` to an existing owner (`ON DELETE CASCADE`, NOT NULL).
 *
 *  Why this shape (see V117DeadOutputConfigKeysMigrationSpec and FlywayNonSuperuserMigrationSpec for the full
 *  story): prod's Flyway role is a table-owning NOSUPERUSER NOBYPASSRLS role whose connection never sets
 *  `app.current_user_id`, and every table V119 touches is FORCE ROW LEVEL SECURITY. A superuser run (CI's, local dev's)
 *  bypasses RLS and would show a missing bracket as green, and V119's own guard shares the migration's RLS state, so it
 *  is blind to a missing bracket on a fail-silent table. So: the migration runs as `helio_migration_test` (the prod
 *  shape), and EVERY count is read over the superuser connection, which RLS cannot hide anything from.
 *
 *  Each scenario gets its own database cloned from one template migrated to V118, so scenarios cannot contaminate each
 *  other (one aborted migration, one seeded orphan) and a scenario that needs a hostile fixture is cheap.
 */
class V119OwnerFkMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private val Role = "helio_migration_test"
  private val Template = "tpl118"

  private val U1 = "00000000-0000-0000-0000-0000000000a1" // a live user
  private val U2 = "00000000-0000-0000-0000-0000000000a2" // a second live user
  private val Ghost = "00000000-0000-0000-0000-0000000000ff" // an owner id with no users row

  private val BracketedTables = Seq("data_sources", "image_uploads", "pipeline_roots", "pipeline_steps", "panels")

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

  private def superConn(db: String): Connection = pg.getDatabase("postgres", db).getConnection
  private def flyway(db: String, target: Option[String]): Flyway = {
    val b = Flyway.configure().dataSource(pg.getJdbcUrl(Role, db), Role, "test").locations("classpath:db/migration")
    target.foreach(t => b.target(MigrationVersion.fromVersion(t)))
    b.load()
  }
  private def rows[T](c: Connection, sql: String)(f: ResultSet => T): Vector[T] = {
    val st = c.createStatement()
    try {
      val rs = st.executeQuery(sql)
      try Iterator.continually(rs).takeWhile(_.next()).map(f).toVector
      finally rs.close()
    } finally st.close()
  }
  private def exec(c: Connection, sql: String): Unit = { val st = c.createStatement(); try st.execute(sql) finally st.close() }
  private def count(c: Connection, sql: String): Int = rows(c, sql)(_.getInt(1)).head
  private def sqlState(c: Connection, sql: String): Option[String] =
    try { exec(c, sql); None }
    catch { case e: SQLException => Some(e.getSQLState) }

  /** A fresh database cloned from the V118 template; `body` gets a superuser connection to it. */
  private def withDb[T](body: (String, Connection) => T): T = {
    val db = s"v119_${dbSeq.incrementAndGet()}"
    val su = superConn("postgres")
    try exec(su, s"CREATE DATABASE $db TEMPLATE $Template") finally su.close()
    val c = superConn(db)
    try body(db, c) finally c.close()
  }

  private def forced(c: Connection): Map[String, Boolean] =
    rows(c, s"SELECT relname, relforcerowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN (${BracketedTables.map("'" + _ + "'").mkString(",")})")(
      r => r.getString(1) -> r.getBoolean(2)).toMap
  private def assertForceOnEverywhere(c: Connection): Unit = forced(c) shouldBe BracketedTables.map(_ -> true).toMap

  // ── seeding (superuser; pre-V119 constraints) ───────────────────────────────────────────────────────────────

  private def user(c: Connection, id: String): Unit = exec(c, s"INSERT INTO users (id, email) VALUES ('$id', 'u-$id@example.test')")
  private def ds(c: Connection, id: String, owner: Option[String], rowCount: Int = 0): Unit = {
    exec(c, s"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id)
               |VALUES ('$id', '$id', 'dataset', '{}'::jsonb, now(), now(), ${owner.map("'" + _ + "'").getOrElse("NULL")})""".stripMargin)
    (1 to rowCount).foreach { i =>
      exec(c, s"INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at) VALUES ('$id-r$i', '$id', $i, '{}'::jsonb, now(), now())")
    }
  }
  private def image(c: Connection, id: String, owner: String): Unit =
    exec(c, s"INSERT INTO image_uploads (id, owner_id, storage_key, mime_type, filename, size_bytes) VALUES ('$id', '$owner', 'k-$id', 'image/png', '$id.png', 1)")
  private def pipeline(c: Connection, id: String, owner: String): Unit =
    exec(c, s"INSERT INTO pipelines (id, name, owner_id) VALUES ('$id', '$id', '$owner')")
  private def root(c: Connection, id: String, pipeline: String, source: String, position: Int): Unit =
    exec(c, s"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ('$id', '$pipeline', '$source', $position)")
  /** A first-of-lane step (carries `root_id`). */
  private def rootStep(c: Connection, id: String, pipeline: String, rootId: String, op: String = "filter", config: String = "{}"): Unit =
    exec(c, s"INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, root_id) VALUES ('$id', '$pipeline', 0, '$op', '${config.replace("'", "''")}', '$rootId')")
  /** A later step of a lane (hangs off its parent via `parent_step_id`). */
  private def childStep(c: Connection, id: String, pipeline: String, parent: String): Unit =
    exec(c, s"INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, parent_step_id) VALUES ('$id', '$pipeline', 1, 'limit', '{}', '$parent')")
  private def output(c: Connection, id: String, pipeline: String, rootId: String, owner: String): Unit =
    exec(c, s"INSERT INTO outputs (id, pipeline_id, root_id, owner_id, name, kind) VALUES ('$id', '$pipeline', '$rootId', '$owner', '$id', 'table')")
  private def stepOutput(c: Connection, id: String, pipeline: String, stepId: String, owner: String): Unit =
    exec(c, s"INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind) VALUES ('$id', '$pipeline', '$stepId', '$owner', '$id', 'table')")
  private def dashboard(c: Connection, id: String, owner: String): Unit =
    exec(c, s"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               |VALUES ('$id', '$id', 'test', now(), now(), '{}'::jsonb, '{}'::jsonb, '$owner')""".stripMargin)
  private def formPanel(c: Connection, id: String, dashboardId: String, owner: String, sourceId: String): Unit =
    exec(c, s"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, owner_id, kind, form_config)
               |VALUES ('$id', '$dashboardId', '$id', 'test', now(), now(), '{}'::jsonb, '$owner', 'form', '{"dataSourceId": "$sourceId"}'::jsonb)""".stripMargin)
  private def outputPanel(c: Connection, id: String, dashboardId: String, owner: String, outputId: String): Unit =
    exec(c, s"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, owner_id, kind, output_id)
               |VALUES ('$id', '$dashboardId', '$id', 'test', now(), now(), '{}'::jsonb, '$owner', 'output', '$outputId')""".stripMargin)

  private def ids(c: Connection, table: String): Set[String] = rows(c, s"SELECT id FROM $table")(_.getString(1)).toSet
  /** Users minus the system user a migration seeds (id ...0001). */
  private def userIds(c: Connection): Set[String] = ids(c, "users") - "00000000-0000-0000-0000-000000000001"
  private def v119Applied(c: Connection): Boolean =
    count(c, "SELECT count(*) FROM flyway_schema_history WHERE version = '119' AND success") == 1

  /** Run V119 as the prod-shaped role and return the failure message, asserting nothing was deleted and RLS is intact. */
  private def expectGuardAbort(db: String, c: Connection, messagePart: String): Unit = {
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

  // ── scenarios ──────────────────────────────────────────────────────────────────────────────────────────────

  "V119, run as a NOSUPERUSER NOBYPASSRLS table-owning role" should {

    "delete orphaned and NULL-owner sources (with their dataset rows) and orphaned images, keep owned rows, and restore FORCE" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-own", Some(U1), rowCount = 3)
      ds(c, "s-orphan", Some(Ghost), rowCount = 2)
      ds(c, "s-null", None, rowCount = 1)
      image(c, "i-own", U1)
      image(c, "i-orphan", Ghost)
      pipeline(c, "p-own", U1)
      root(c, "r-own", "p-own", "s-own", 0)
      rootStep(c, "st-own", "p-own", "r-own")

      noException should be thrownBy flyway(db, Some("119")).migrate()

      ids(c, "data_sources") shouldBe Set("s-own")
      ids(c, "dataset_rows") shouldBe Set("s-own-r1", "s-own-r2", "s-own-r3")
      ids(c, "image_uploads") shouldBe Set("i-own")
      ids(c, "pipeline_roots") shouldBe Set("r-own")
      ids(c, "pipeline_steps") shouldBe Set("st-own")
      assertForceOnEverywhere(c)
      v119Applied(c) shouldBe true
      rows(c, "SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid = 'data_sources'::regclass AND a.attname = 'owner_id'")(_.getBoolean(1)) shouldBe Vector(true)
      rows(c, "SELECT conrelid::regclass::text, confdeltype::text FROM pg_constraint WHERE conname IN ('data_sources_owner_id_fkey', 'image_uploads_owner_id_fkey') ORDER BY 1")(
        r => r.getString(1) -> r.getString(2)) shouldBe Vector("data_sources" -> "c", "image_uploads" -> "c")
    }

    "do nothing on a clean database, and add both constraints" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-own", Some(U1), rowCount = 2)
      image(c, "i-own", U1)

      noException should be thrownBy flyway(db, Some("119")).migrate()

      ids(c, "data_sources") shouldBe Set("s-own")
      ids(c, "dataset_rows").size shouldBe 2
      ids(c, "image_uploads") shouldBe Set("i-own")
      count(c, "SELECT count(*) FROM pg_constraint WHERE conname IN ('data_sources_owner_id_fkey', 'image_uploads_owner_id_fkey')") shouldBe 2
      assertForceOnEverywhere(c)
    }

    "abort, deleting nothing, when an orphan is one of TWO roots of a pipeline (V99 cannot fire, only the guard can stop it)" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-live", Some(U1))
      ds(c, "s-orphan", Some(Ghost), rowCount = 2)
      ds(c, "s-null", None)
      pipeline(c, "p-two-roots", U1)
      root(c, "r-live", "p-two-roots", "s-live", 0)
      root(c, "r-orphan", "p-two-roots", "s-orphan", 1)
      // The pipeline has no public grant, so a missing pipeline_roots bracket makes the guard see ZERO roots.
      expectGuardAbort(db, c, "pipeline roots: 1")
    }

    "abort, deleting nothing, when an orphan is a join step's secondaryInput source" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-live", Some(U1))
      ds(c, "s-orphan", Some(Ghost))
      pipeline(c, "p-join", U1)
      root(c, "r-live", "p-join", "s-live", 0)
      rootStep(c, "st-join", "p-join", "r-live", op = "join",
        config = """{"secondaryInput": {"kind": "source", "dataSourceId": "s-orphan"}}""")
      expectGuardAbort(db, c, "steps: 1")
    }

    "abort, deleting nothing, when an orphan is an upsertsource step's existing-source target" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-live", Some(U1))
      ds(c, "s-orphan", None)
      pipeline(c, "p-upsert", U1)
      root(c, "r-live", "p-upsert", "s-live", 0)
      rootStep(c, "st-upsert", "p-upsert", "r-live", op = "upsertsource",
        config = """{"target": {"kind": "existingSource", "dataSourceId": "s-orphan"}}""")
      expectGuardAbort(db, c, "steps: 1")
    }

    "abort, deleting nothing, when an orphan is a form panel's source (on a dashboard with no public grant)" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-orphan", Some(Ghost))
      dashboard(c, "d-private", U1)
      formPanel(c, "pn-form", "d-private", U1, "s-orphan")
      expectGuardAbort(db, c, "form panels: 1")
    }

    "not abort for a step or panel that merely mentions a LIVE source" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s-live", Some(U1))
      ds(c, "s-live-2", Some(U1))
      ds(c, "s-orphan", Some(Ghost))
      pipeline(c, "p", U1)
      root(c, "r-live", "p", "s-live", 0)
      rootStep(c, "st-join", "p", "r-live", op = "join", config = """{"secondaryInput": {"kind": "source", "dataSourceId": "s-live-2"}}""")
      dashboard(c, "d", U1)
      formPanel(c, "pn", "d", U1, "s-live-2")
      noException should be thrownBy flyway(db, Some("119")).migrate()
      ids(c, "data_sources") shouldBe Set("s-live", "s-live-2")
    }
  }

  "After V119, inserts and user deletes" should {

    "reject a data source for a non-existent user (23503), with no owner (23502), and an image upload for a non-existent user (23503)" in withDb { (db, c) =>
      flyway(db, Some("119")).migrate()
      def insDs(owner: String) = s"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id)
                                    |VALUES ('x', 'x', 'dataset', '{}'::jsonb, now(), now(), $owner)""".stripMargin
      sqlState(c, insDs(s"'$Ghost'")) shouldBe Some("23503")
      sqlState(c, insDs("NULL")) shouldBe Some("23502")
      sqlState(c, s"INSERT INTO image_uploads (id, owner_id, storage_key, mime_type, filename, size_bytes) VALUES ('x', '$Ghost', 'k', 'image/png', 'x.png', 1)") shouldBe Some("23503")
      count(c, "SELECT count(*) FROM data_sources") + count(c, "SELECT count(*) FROM image_uploads") shouldBe 0
    }

    "cascade a user delete to their data sources, dataset rows and image uploads (user owns nothing else)" in withDb { (db, c) =>
      user(c, U1); user(c, U2)
      ds(c, "s1", Some(U1), rowCount = 2)
      ds(c, "s2", Some(U2), rowCount = 1)
      image(c, "i1", U1)
      image(c, "i2", U2)
      flyway(db, Some("119")).migrate()

      sqlState(c, s"DELETE FROM users WHERE id = '$U1'") shouldBe None

      ids(c, "data_sources") shouldBe Set("s2")
      ids(c, "dataset_rows") shouldBe Set("s2-r1")
      ids(c, "image_uploads") shouldBe Set("i2")
      userIds(c) shouldBe Set(U2)
    }

    "reject, intact, deleting a user who owns a pipeline (own source, 1-step lane)" in withDb { (db, c) =>
      user(c, U1)
      ds(c, "s1", Some(U1))
      pipeline(c, "p1", U1)
      root(c, "r1", "p1", "s1", 0)
      rootStep(c, "st1", "p1", "r1")
      flyway(db, Some("119")).migrate()

      sqlState(c, s"DELETE FROM users WHERE id = '$U1'").map(_.take(2)) shouldBe Some("23")
      userIds(c) shouldBe Set(U1)
      ids(c, "data_sources") shouldBe Set("s1")
      ids(c, "pipeline_roots") shouldBe Set("r1")
      ids(c, "pipeline_steps") shouldBe Set("st1")
    }

    "reject, intact, a cascade into another user's pipeline's LAST root (1-step lane; the V99 zero-root guard)" in withDb { (db, c) =>
      user(c, U1); user(c, U2)
      ds(c, "s1", Some(U1))
      pipeline(c, "p2", U2)
      root(c, "r1", "p2", "s1", 0)
      rootStep(c, "st1", "p2", "r1")
      flyway(db, Some("119")).migrate()

      val state = sqlState(c, s"DELETE FROM users WHERE id = '$U1'")
      info(s"cross-owner last root, 1-step lane: SQLSTATE $state")
      state.exists(s => s.startsWith("23") || s == "P0001") shouldBe true
      userIds(c) shouldBe Set(U1, U2)
      ids(c, "data_sources") shouldBe Set("s1")
      ids(c, "pipeline_roots") shouldBe Set("r1")
      ids(c, "pipeline_steps") shouldBe Set("st1")
    }

    "reject, intact, a cascade into a root whose lane has 2+ steps (parent_step_id is NO ACTION)" in withDb { (db, c) =>
      user(c, U1); user(c, U2)
      ds(c, "s1", Some(U1))
      ds(c, "s2", Some(U2))
      pipeline(c, "p2", U2)
      root(c, "r1", "p2", "s1", 0)
      root(c, "r2", "p2", "s2", 1) // a second root, so the V99 zero-root guard cannot be what rejects it
      rootStep(c, "st1", "p2", "r1")
      childStep(c, "st1b", "p2", "st1")
      flyway(db, Some("119")).migrate()

      val state = sqlState(c, s"DELETE FROM users WHERE id = '$U1'")
      info(s"cross-owner root, 2-step lane, second root present: SQLSTATE $state")
      state.exists(_.startsWith("23")) shouldBe true
      userIds(c) shouldBe Set(U1, U2)
      ids(c, "data_sources") shouldBe Set("s1", "s2")
      ids(c, "pipeline_roots") shouldBe Set("r1", "r2")
      ids(c, "pipeline_steps") shouldBe Set("st1", "st1b")
    }

    "silently reach another user's pipeline when the deleted user's source is one of several roots (1-step lane)" in withDb { (db, c) =>
      user(c, U1); user(c, U2)
      ds(c, "s1", Some(U1))
      ds(c, "s2", Some(U2))
      pipeline(c, "p2", U2)
      root(c, "r1", "p2", "s1", 0)
      root(c, "r2", "p2", "s2", 1)
      rootStep(c, "st1", "p2", "r1")
      stepOutput(c, "o1", "p2", "st1", U2)
      dashboard(c, "d2", U2)
      outputPanel(c, "pn1", "d2", U2, "o1")
      flyway(db, Some("119")).migrate()

      sqlState(c, s"DELETE FROM users WHERE id = '$U1'") shouldBe None

      // The deleted user's source, its root, that root's step, the Output and the bound panel are gone ...
      userIds(c) shouldBe Set(U2)
      ids(c, "data_sources") shouldBe Set("s2")
      ids(c, "pipeline_roots") shouldBe Set("r2")
      ids(c, "pipeline_steps") shouldBe Set.empty[String]
      ids(c, "outputs") shouldBe Set.empty[String]
      ids(c, "panels") shouldBe Set.empty[String]
      // ... while the other user's pipeline, dashboard and remaining root survive.
      ids(c, "pipelines") shouldBe Set("p2")
      ids(c, "dashboards") shouldBe Set("d2")
    }

    "settle a user who owns a connector and its credential (connectors.credential_id is RESTRICT)" in withDb { (db, c) =>
      user(c, U1)
      exec(c, s"""INSERT INTO connector_credentials (id, user_id, name, key_id, wrapped_data_key, nonce_dek, ciphertext, nonce_value)
                 |VALUES ('00000000-0000-0000-0000-0000000000c1', '$U1', 'cred', 'k', '\\x00', '\\x00', '\\x00', '\\x00')""".stripMargin)
      exec(c, s"""INSERT INTO connectors (id, owner_id, name, kind, base_url, credential_id)
                 |VALUES ('00000000-0000-0000-0000-0000000000c2', '$U1', 'conn', 'rest', 'https://example.test', '00000000-0000-0000-0000-0000000000c1')""".stripMargin)
      flyway(db, Some("119")).migrate()

      val state = sqlState(c, s"DELETE FROM users WHERE id = '$U1'")
      info(s"user with connector + credential, fresh migrated DB: SQLSTATE $state")
      // Observed outcome on a freshly migrated DB; docs/user-reference-inventory.md records it as order-dependent,
      // not a guarantee (RESTRICT is immediate, so the winner depends on RI trigger firing order).
      state shouldBe CONNECTOR_DELETE_OUTCOME
      if (state.isEmpty) {
        count(c, "SELECT count(*) FROM connectors") + count(c, "SELECT count(*) FROM connector_credentials") shouldBe 0
      } else {
        userIds(c) shouldBe Set(U1)
        count(c, "SELECT count(*) FROM connectors") shouldBe 1
        count(c, "SELECT count(*) FROM connector_credentials") shouldBe 1
      }
    }
  }

  // Observed on a fresh migrated database (see the scenario above and docs/user-reference-inventory.md).
  private val CONNECTOR_DELETE_OUTCOME: Option[String] = None

  "The user-reference inventory document" should {
    "list exactly the foreign keys that reference users in a fully migrated database" in withDb { (db, c) =>
      flyway(db, None).migrate()
      val actual = rows(c,
        """SELECT conrelid::regclass::text, a.attname,
          |       CASE confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'c' THEN 'CASCADE' WHEN 'r' THEN 'RESTRICT'
          |                        WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END
          |FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
          |WHERE k.contype = 'f' AND k.confrelid = 'users'::regclass""".stripMargin)(r => (r.getString(1), r.getString(2), r.getString(3))).toSet

      val lines = Files.readAllLines(Paths.get("../docs/user-reference-inventory.md")).asScala.toVector
      val header = lines.indexWhere(_.replaceAll("\\s", "") == "|Table|Column|ONDELETE|")
      withClue("docs/user-reference-inventory.md must contain the `| Table | Column | ON DELETE |` table: ") { header should be >= 0 }
      val documented = lines.drop(header + 2).takeWhile(_.trim.startsWith("|")).map { l =>
        val cells = l.split('|').map(_.trim.stripPrefix("`").stripSuffix("`")).filter(_.nonEmpty)
        (cells(0), cells(1), cells(2))
      }.toSet

      withClue(s"in the database but undocumented: ${actual -- documented}; documented but absent: ${documented -- actual}: ") {
        documented shouldBe actual
      }
      actual should contain(("data_sources", "owner_id", "CASCADE"))
      actual should contain(("image_uploads", "owner_id", "CASCADE"))
    }
  }
}
