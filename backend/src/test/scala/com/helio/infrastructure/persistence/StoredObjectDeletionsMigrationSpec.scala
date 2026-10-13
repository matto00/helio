package com.helio.infrastructure.persistence

import com.helio.infrastructure.persistence.sources.{QueueCounts, StoredObjectDeletionRepository}
import com.helio.testkit.VerifiedEmbeddedPostgres
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.sql.{Connection, DriverManager, ResultSet}
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.Await
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration.DurationInt

/** HEL-1434 [MUTATION] M4: V128's deletion-queue triggers under real RLS.
 *
 *  Dev/CI run as a superuser and bypass RLS, which would show a broken trigger posture as green (MISTAKES.md). So V128
 *  is applied by `helio_migration_test`, a LOGIN NOSUPERUSER NOBYPASSRLS role that OWNS the schema and tables (prod's
 *  Flyway role shape, see [[V119MigrationHarness]]), and the DELETEs run on a connection of that same role --
 *  FORCE ROW LEVEL SECURITY applies to it. Everything is READ over the superuser connection, which RLS cannot hide
 *  anything from. Both entry points must commit the OUTER delete and queue the key:
 *   (a) an RLS-bound session (`app.current_user_id` set) deleting the user's own csv source;
 *   (b) `DELETE FROM users` with the GUC unset (the V119 cascade).
 *
 *  Mutations (each run by editing V128, shown red, reverted): M4.i drop SECURITY DEFINER; M4.ii skip the
 *  `ALTER FUNCTION ... OWNER TO helio_privileged` re-own. `row_security = off` alone is not a mutation target. */
class StoredObjectDeletionsMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private val Role     = "helio_migration_test"
  private val Template = "tpl126"
  private val dbSeq    = new AtomicInteger(0)

  private lazy val pg: EmbeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))

  override def beforeAll(): Unit = {
    val su = superConn("postgres")
    try {
      exec(su, s"CREATE ROLE $Role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      exec(su, "CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      exec(su, s"GRANT helio_privileged TO $Role WITH ADMIN OPTION")
      exec(su, s"CREATE DATABASE $Template")
      rows(su, s"SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '$Role'")(r => (r.getBoolean(1), r.getBoolean(2))) shouldBe Vector((false, false))
    } finally su.close()
    val tc = superConn(Template)
    try {
      exec(tc, s"ALTER SCHEMA public OWNER TO $Role")
      exec(tc, s"GRANT CREATE, USAGE ON SCHEMA public TO $Role")
    } finally tc.close()
    flyway(Template, Some("126")).migrate()
  }

  override def afterAll(): Unit = pg.close()

  private def superConn(db: String): Connection = pg.getDatabase("postgres", db).getConnection
  private def roleConn(db: String): Connection  = DriverManager.getConnection(pg.getJdbcUrl(Role, db), Role, "test")
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
  private def exec(c: Connection, sql: String): Int = { val st = c.createStatement(); try { st.execute(sql); st.getUpdateCount } finally st.close() }

  /** A fresh database cloned from the V126 template with V128 (the code under test) applied as the owner role. */
  private def withMigratedDb[T](body: (Connection, String) => T): T = {
    val db = s"v128_${dbSeq.incrementAndGet()}"
    val su = superConn("postgres")
    try exec(su, s"CREATE DATABASE $db TEMPLATE $Template") finally su.close()
    flyway(db, None).migrate()
    val c = superConn(db)
    try body(c, db) finally c.close()
  }

  private val U1 = "00000000-0000-0000-0000-0000000000b1"
  private val U2 = "00000000-0000-0000-0000-0000000000b2"

  private def seed(c: Connection): Unit = {
    Seq(U1, U2).foreach(u => exec(c, s"INSERT INTO users (id, email) VALUES ('$u', 'u-$u@example.test')"))
    Seq(U1 -> "k1", U2 -> "k2").foreach { case (u, k) =>
      exec(c, s"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id)
                 |VALUES ('ds-$k', 'ds', 'csv', '{"path":"csv/$k.csv"}'::jsonb, now(), now(), '$u')""".stripMargin)
      exec(c, s"INSERT INTO image_uploads (id, owner_id, storage_key, mime_type, filename, size_bytes) VALUES ('img-$k', '$u', 'images/$k.png', 'image/png', 'a.png', 1)")
    }
  }

  private def queueKeys(c: Connection): Set[String] = rows(c, "SELECT storage_key FROM stored_object_deletions")(_.getString(1)).toSet

  "V128 (applied as a NOSUPERUSER NOBYPASSRLS owner role)" should {

    "pin the trigger-function posture and an unreadable queue" in withMigratedDb { (su, db) =>
      rows(su, """SELECT p.proname, p.prosecdef, r.rolname, p.proconfig::text
                  |FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
                  |WHERE p.proname IN ('hel1434_enqueue_image_upload_object', 'hel1434_enqueue_data_source_object')
                  |ORDER BY p.proname""".stripMargin)(r => (r.getBoolean(2), r.getString(3), r.getString(4))).foreach { case (secDef, owner, cfg) =>
        secDef shouldBe true
        owner shouldBe "helio_privileged"
        cfg should (include("row_security=off") and include("search_path=pg_catalog, public"))
      }
      rows(su, "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'stored_object_deletions'")(r => (r.getBoolean(1), r.getBoolean(2))) shouldBe Vector((true, true))
      rows(su, "SELECT count(*) FROM pg_policies WHERE tablename = 'stored_object_deletions'")(_.getInt(1)) shouldBe Vector(0)
      // ENABLE ALWAYS = tgenabled 'A'
      rows(su, "SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE 'hel1434_%' ORDER BY tgname")(r => (r.getString(1), r.getString(2))) shouldBe
        Vector(("hel1434_data_source_object_trigger", "A"), ("hel1434_image_upload_object_trigger", "A"))
    }

    "M4(a) commit an RLS-bound user's own csv-source delete and queue its key" in withMigratedDb { (su, db) =>
      seed(su)
      val app = roleConn(db)
      try {
        app.setAutoCommit(false)
        exec(app, s"SELECT set_config('app.current_user_id', '$U1', true)")
        exec(app, "DELETE FROM data_sources WHERE id = 'ds-k1'") shouldBe 1
        app.commit()
        // the app role itself can neither see nor write the queue (FORCE RLS, no policy)
        rows(app, "SELECT count(*) FROM stored_object_deletions")(_.getInt(1)) shouldBe Vector(0)
      } finally app.close()
      rows(su, "SELECT count(*) FROM data_sources WHERE id = 'ds-k1'")(_.getInt(1)) shouldBe Vector(0)
      queueKeys(su) shouldBe Set("csv/k1.csv")
    }

    "M4(b) commit a DELETE FROM users cascade with app.current_user_id unset and queue every key" in withMigratedDb { (su, db) =>
      seed(su)
      val app = roleConn(db)
      try {
        exec(app, s"DELETE FROM users WHERE id = '$U2'") shouldBe 1
      } finally app.close()
      rows(su, s"SELECT count(*) FROM users WHERE id = '$U2'")(_.getInt(1)) shouldBe Vector(0)
      rows(su, "SELECT count(*) FROM data_sources WHERE id = 'ds-k2'")(_.getInt(1)) shouldBe Vector(0)
      queueKeys(su) shouldBe Set("csv/k2.csv", "images/k2.png")
    }

    "HEL-1531 count the queue through the privileged pool (BYPASSRLS, migration grants only) and read zero on the app pool" in withMigratedDb { (su, db) =>
      Seq(("k1", 0), ("k2", 9), ("k3", 10), ("k4", 12)).foreach { case (k, attempts) =>
        exec(su, s"INSERT INTO stored_object_deletions (storage_key, source_table, attempts) VALUES ('images/$k.png', 'image_uploads', $attempts)")
      }
      def pool(initSql: Option[String]): JdbcBackend.Database = {
        val cfg = new HikariConfig()
        cfg.setJdbcUrl(pg.getJdbcUrl(Role, db) + "&stringtype=unspecified")
        cfg.setUsername(Role)
        cfg.setPassword("test")
        cfg.setMaximumPoolSize(2)
        initSql.foreach(cfg.setConnectionInitSql)
        JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(2))
      }
      val appDb  = pool(None)
      val privDb = pool(Some("SET ROLE helio_privileged"))
      try {
        import PostgresProfile.api._
        val ctx = new DbContext(appDb, privDb)
        // The pool the counts run on is NOSUPERUSER at login and helio_privileged BYPASSRLS at read time (C1).
        Await.result(ctx.withSystemContext(
          sql"SELECT rolsuper, rolbypassrls, current_user FROM pg_roles WHERE rolname = current_user".as[(Boolean, Boolean, String)].head
        ), 20.seconds) shouldBe ((false, true, "helio_privileged"))
        Await.result(appDb.run(sql"SELECT rolsuper FROM pg_roles WHERE rolname = session_user".as[Boolean].head), 20.seconds) shouldBe false
        // Attempts 10 and 12 are stuck (>= cap), 9 and 0 are not.
        Await.result(new StoredObjectDeletionRepository(ctx).queueCounts(10), 20.seconds) shouldBe QueueCounts(4L, 2L)
        // The same read on the app pool is silently empty (FORCE RLS, no policy): the failure mode this guards.
        Await.result(new StoredObjectDeletionRepository(new DbContext(appDb, appDb)).queueCounts(10), 20.seconds) shouldBe QueueCounts(0L, 0L)
      } finally { appDb.close(); privDb.close() }
    }
  }
}
