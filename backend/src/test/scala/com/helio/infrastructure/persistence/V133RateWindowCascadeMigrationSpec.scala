package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.sql.{Connection, DriverManager, ResultSet, SQLException}
import java.util.concurrent.atomic.AtomicInteger

/** HEL-1440: V133 makes `pipeline_run_rate_window.user_id` `ON DELETE CASCADE`.
 *
 *  Same hostile shape as V119OwnerFkMigrationSpec: Flyway runs as `helio_migration_test` (NOSUPERUSER NOBYPASSRLS,
 *  owner of every table), and every `DELETE FROM users` runs over a connection as that same role with
 *  `app.current_user_id` UNSET, against FORCE ROW LEVEL SECURITY on the rate-window table. Every count is read over the
 *  superuser connection, which RLS cannot hide anything from, so an RLS-hidden failure shows up as a red test, never a
 *  false green.
 *
 *  Each scenario gets its own database cloned from a template migrated to V130 (the last version before V133).
 */
class V133RateWindowCascadeMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private val Role = "helio_migration_test"
  private val Template = "tpl130"

  private val U1 = "00000000-0000-0000-0000-0000000000b1"
  private val U2 = "00000000-0000-0000-0000-0000000000b2"
  private val Ghost = "00000000-0000-0000-0000-0000000000fe"

  private lazy val pg: EmbeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
  private val dbSeq = new AtomicInteger(0)

  override def beforeAll(): Unit = {
    val su = superConn("postgres")
    try {
      exec(su, s"CREATE ROLE $Role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      exec(su, s"CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      exec(su, s"GRANT helio_privileged TO $Role WITH ADMIN OPTION")
      exec(su, s"CREATE DATABASE $Template")
      rows(su, s"SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '$Role'")(r => (r.getBoolean(1), r.getBoolean(2))) shouldBe Vector((false, false))
    } finally su.close()
    val tc = superConn(Template)
    try {
      exec(tc, s"ALTER SCHEMA public OWNER TO $Role")
      exec(tc, s"GRANT CREATE, USAGE ON SCHEMA public TO $Role")
    } finally tc.close()
    flyway(Template, Some("130")).migrate()
  }

  override def afterAll(): Unit = pg.close()

  // ── plumbing ───────────────────────────────────────────────────────────────────────────────────────────────

  private def superConn(db: String): Connection = pg.getDatabase("postgres", db).getConnection
  /** A connection as the NOSUPERUSER NOBYPASSRLS owner role; `app.current_user_id` is never set on it. */
  private def roleConn(db: String): Connection = DriverManager.getConnection(pg.getJdbcUrl(Role, db), Role, "test")
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

  /** A fresh database cloned from the V130 template, migrated per-scenario by `body`; gives superuser and role connections. */
  private def withDb[T](body: (String, Connection, Connection) => T): T = {
    val db = s"v133_${dbSeq.incrementAndGet()}"
    val su = superConn("postgres")
    try exec(su, s"CREATE DATABASE $db TEMPLATE $Template") finally su.close()
    val c = superConn(db)
    val r = roleConn(db)
    try body(db, c, r) finally { r.close(); c.close() }
  }

  private def user(c: Connection, id: String): Unit = exec(c, s"INSERT INTO users (id, email) VALUES ('$id', 'u-$id@example.test')")
  private def window(c: Connection, userId: String, n: Int): Unit =
    (1 to n).foreach(i => exec(c, s"INSERT INTO pipeline_run_rate_window (user_id, window_start, request_count) VALUES ('$userId', now() - interval '$i hours', $i)"))
  private def dashboard(c: Connection, id: String, owner: String): Unit =
    exec(c, s"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               |VALUES ('$id', '$id', 'test', now(), now(), '{}'::jsonb, '{}'::jsonb, '$owner')""".stripMargin)
  private def windows(c: Connection, userId: String): Int = count(c, s"SELECT count(*) FROM pipeline_run_rate_window WHERE user_id = '$userId'")
  private def userCount(c: Connection, userId: String): Int = count(c, s"SELECT count(*) FROM users WHERE id = '$userId'")
  private def fkAction(c: Connection): Vector[(String, String)] =
    rows(c, "SELECT conname, confdeltype::text FROM pg_constraint WHERE conrelid = 'pipeline_run_rate_window'::regclass AND contype = 'f'")(r => r.getString(1) -> r.getString(2))

  "V133, run as a NOSUPERUSER NOBYPASSRLS table-owning role" should {

    "start from a NO ACTION foreign key named pipeline_run_rate_window_user_id_fkey, and make it CASCADE keeping existing rows" in withDb { (db, c, _) =>
      user(c, U1)
      window(c, U1, 3)
      fkAction(c) shouldBe Vector("pipeline_run_rate_window_user_id_fkey" -> "a")

      noException should be thrownBy flyway(db, Some("133")).migrate()

      fkAction(c) shouldBe Vector("pipeline_run_rate_window_user_id_fkey" -> "c")
      windows(c, U1) shouldBe 3
      count(c, "SELECT count(*) FROM pg_class WHERE relname = 'pipeline_run_rate_window' AND relforcerowsecurity") shouldBe 1
    }

    "delete a user whose only reference is a rate-window row, and the row with it" in withDb { (db, c, r) =>
      user(c, U1)
      window(c, U1, 2)
      flyway(db, Some("133")).migrate()

      sqlState(r, s"DELETE FROM users WHERE id = '$U1'") shouldBe None

      userCount(c, U1) shouldBe 0
      windows(c, U1) shouldBe 0
    }

    "leave another user's rate-window rows untouched" in withDb { (db, c, r) =>
      user(c, U1); user(c, U2)
      window(c, U1, 2); window(c, U2, 4)
      flyway(db, Some("133")).migrate()

      sqlState(r, s"DELETE FROM users WHERE id = '$U1'") shouldBe None

      windows(c, U1) shouldBe 0
      windows(c, U2) shouldBe 4
      userCount(c, U2) shouldBe 1
    }

    "still reject the delete as a whole when another blocking reference (a dashboard) remains" in withDb { (db, c, r) =>
      user(c, U1)
      window(c, U1, 2)
      dashboard(c, "d1", U1)
      flyway(db, Some("133")).migrate()

      sqlState(r, s"DELETE FROM users WHERE id = '$U1'") shouldBe Some("23503")

      userCount(c, U1) shouldBe 1
      windows(c, U1) shouldBe 2
    }

    "still require an existing user for a rate-window row" in withDb { (db, c, _) =>
      flyway(db, Some("133")).migrate()

      sqlState(c, s"INSERT INTO pipeline_run_rate_window (user_id, window_start, request_count) VALUES ('$Ghost', now(), 1)") shouldBe Some("23503")
      count(c, "SELECT count(*) FROM pipeline_run_rate_window") shouldBe 0
    }
  }
}
