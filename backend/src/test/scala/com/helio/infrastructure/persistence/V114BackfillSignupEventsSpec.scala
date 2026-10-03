package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.sql.{Connection, SQLException}
import scala.io.Source

/** HEL-1244: proves V114 (signup_completed backfill) under the SAME kind of role production's
 *  Flyway uses -- NOSUPERUSER, NOBYPASSRLS, owner of the schema -- with rows actually inserted.
 *  `product_events` is FORCE ROW LEVEL SECURITY, so a plain INSERT ... SELECT passes under a
 *  superuser and fails here; the red-first test below records that failure verbatim. */
class V114BackfillSignupEventsSpec extends AnyWordSpec with Matchers {

  private val RolledThroughReset = "2026-03-20"

  private final class Fixture(val pg: EmbeddedPostgres) {
    val url: String = pg.getJdbcUrl("helio_migration_test", "postgres")
    def superConn(): Connection = pg.getPostgresDatabase.getConnection
    def roleConn(): Connection  = java.sql.DriverManager.getConnection(url + "&stringtype=unspecified", "helio_migration_test", "test")

    def exec(sql: String): Unit = {
      val c = superConn()
      try { val s = c.createStatement(); try s.execute(sql) finally s.close() } finally c.close()
    }
    def query[T](sql: String)(read: java.sql.ResultSet => T): T = {
      val c = superConn()
      try {
        val s = c.createStatement()
        try { val rs = s.executeQuery(sql); rs.next(); read(rs) } finally s.close()
      } finally c.close()
    }
    def count(sql: String): Long = query(sql)(_.getLong(1))

    def migrate(target: Option[String]): Unit = {
      val cfg = Flyway.configure().dataSource(url, "helio_migration_test", "test").locations("classpath:db/migration")
      target.foreach(t => cfg.target(MigrationVersion.fromVersion(t)))
      cfg.load().migrate()
    }
  }

  private def withDb[T](body: Fixture => T): T = {
    val pg = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    try {
      val f = new Fixture(pg)
      f.exec("CREATE ROLE helio_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      f.exec("ALTER SCHEMA public OWNER TO helio_migration_test")
      f.exec("GRANT CREATE, USAGE ON SCHEMA public TO helio_migration_test")
      f.exec("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      f.exec("GRANT helio_privileged TO helio_migration_test WITH ADMIN OPTION")
      f.migrate(Some("113"))
      body(f)
    } finally pg.close()
  }

  private def v114Sql: String = {
    val src = Source.fromResource("db/migration/V114__backfill_signup_completed_events.sql")
    try src.mkString finally src.close()
  }

  private def runAsRole(f: Fixture, sql: String): Connection = {
    val c = f.roleConn()
    c.setAutoCommit(false)
    val s = c.createStatement()
    try s.execute(sql) finally s.close()
    c
  }

  private val idA = "00000000-0000-0000-0000-00000000000a" // created 2026-01-05, no event
  private val idB = "00000000-0000-0000-0000-00000000000b" // created 2026-03-01 23:30Z, no event
  private val idC = "00000000-0000-0000-0000-00000000000c" // already has signup_completed
  private val idD = "00000000-0000-0000-0000-00000000000d" // has only provenance_opened

  private def seedUsers(f: Fixture): Unit = {
    f.exec("TRUNCATE TABLE users CASCADE") // drop V1-V113's seeded baseline user
    def user(id: String, at: String) =
      f.exec(s"INSERT INTO users (id, email, password_hash, created_at) VALUES ('$id', '$id@t.local', 'x', TIMESTAMPTZ '$at')")
    user(idA, "2026-01-05 12:00:00+00")
    user(idB, "2026-03-01 23:30:00+00")
    user(idC, "2026-02-10 08:00:00+00")
    user(idD, "2026-02-20 08:00:00+00")
    f.exec(s"""INSERT INTO product_events (user_id, event, properties, occurred_at)
               VALUES ('$idC', 'signup_completed', '{"existing":true}', TIMESTAMPTZ '2026-02-10 09:00:00+00'),
                      ('$idD', 'provenance_opened', '{}', TIMESTAMPTZ '2026-02-21 09:00:00+00')""")
  }

  "V114 under a NOSUPERUSER NOBYPASSRLS table-owner role" should {

    "fail a plain INSERT ... SELECT FROM users (red), then backfill with real rows, idempotently, with no leaked context" in withDb { f =>
      seedUsers(f)
      f.exec(s"UPDATE product_rollup_state SET rolled_through = DATE '$RolledThroughReset' WHERE id = 1")

      // RED: the naive backfill is rejected by FORCE RLS under the production-shaped role.
      val naive = f.roleConn()
      val err = try {
        val s = naive.createStatement()
        try {
          s.execute("INSERT INTO product_events (user_id, event, properties, occurred_at) SELECT id, 'signup_completed', '{}'::jsonb, created_at FROM users")
          None
        }
      } catch { case e: SQLException => Some(e) } finally naive.close()
      info(s"RED-FIRST naive INSERT error: SQLSTATE=${err.map(_.getSQLState)} message=${err.map(_.getMessage.linesIterator.next())}")
      err should not be empty
      err.get.getSQLState should (equal("42704") or equal("42501"))
      f.count("SELECT COUNT(*) FROM product_events") shouldBe 2L

      // GREEN: the real migration through Flyway (as the same role).
      f.migrate(None)

      f.count("SELECT COUNT(*) FROM product_events WHERE event = 'signup_completed'") shouldBe 4L // A, B, D new + C existing
      f.count(s"SELECT COUNT(*) FROM product_events WHERE user_id IN ('$idA','$idB','$idD') AND event = 'signup_completed'") shouldBe 3L
      f.count("""SELECT COUNT(*) FROM product_events e JOIN users u ON u.id = e.user_id
                |WHERE e.event = 'signup_completed' AND e.user_id <> '00000000-0000-0000-0000-00000000000c'
                |  AND e.occurred_at = u.created_at AND e.properties = '{}'::jsonb""".stripMargin) shouldBe 3L
      f.count("SELECT COUNT(*) FROM product_events WHERE event = 'first_dashboard_rendered'") shouldBe 0L
      // pre-existing rows untouched
      f.query(s"SELECT properties::text, occurred_at = TIMESTAMPTZ '2026-02-10 09:00:00+00' FROM product_events WHERE user_id = '$idC'") { rs =>
        rs.getString(1) shouldBe """{"existing": true}"""
        rs.getBoolean(2) shouldBe true
      }
      f.count(s"SELECT COUNT(*) FROM product_events WHERE user_id = '$idD' AND event = 'provenance_opened'") shouldBe 1L
      f.count("SELECT COUNT(*) FROM product_events") shouldBe 5L
      // rolled_through lowered to (earliest backfilled day 2026-01-05) - 1
      f.query("SELECT rolled_through::text FROM product_rollup_state WHERE id = 1")(_.getString(1)) shouldBe "2026-01-04"

      // Idempotent re-run of the migration body under the same role, on one reused connection:
      // inserts nothing, leaves rolled_through alone, and leaves no app.current_user_id behind.
      f.exec(s"UPDATE product_rollup_state SET rolled_through = DATE '$RolledThroughReset' WHERE id = 1")
      val c = runAsRole(f, v114Sql)
      try {
        c.commit()
        val s = c.createStatement()
        try {
          val rs = s.executeQuery("SELECT current_setting('app.current_user_id', true)")
          rs.next()
          val leaked = rs.getString(1)
          info(s"current_setting('app.current_user_id', true) after commit on the same connection = ${if (leaked == null) "NULL" else s"'$leaked'"}")
          (leaked == null || leaked.isEmpty) shouldBe true
        } finally s.close()
      } finally c.close()
      f.count("SELECT COUNT(*) FROM product_events") shouldBe 5L
      f.query("SELECT rolled_through::text FROM product_rollup_state WHERE id = 1")(_.getString(1)) shouldBe RolledThroughReset
    }

    "leave a NULL rolled_through NULL and a rolled_through before the earliest signup untouched" in withDb { f =>
      seedUsers(f)
      f.migrate(None)
      f.query("SELECT rolled_through IS NULL FROM product_rollup_state WHERE id = 1")(_.getBoolean(1)) shouldBe true
      f.count("SELECT COUNT(*) FROM product_events WHERE event = 'signup_completed'") shouldBe 4L

      // Fresh run of the body, with the mark strictly before every signup day: no change.
      f.exec("DELETE FROM product_events WHERE event = 'signup_completed' AND user_id <> '" + idC + "'")
      f.exec("UPDATE product_rollup_state SET rolled_through = DATE '2025-12-31' WHERE id = 1")
      val c = runAsRole(f, v114Sql)
      try c.commit() finally c.close()
      f.count("SELECT COUNT(*) FROM product_events WHERE event = 'signup_completed'") shouldBe 4L
      f.query("SELECT rolled_through::text FROM product_rollup_state WHERE id = 1")(_.getString(1)) shouldBe "2025-12-31"
    }

    "succeed and change nothing on an empty users table, including a set rolled_through" in withDb { f =>
      f.exec("TRUNCATE TABLE users CASCADE")
      f.exec(s"UPDATE product_rollup_state SET rolled_through = DATE '$RolledThroughReset' WHERE id = 1")
      f.migrate(None)
      f.count("SELECT COUNT(*) FROM product_events") shouldBe 0L
      f.query("SELECT rolled_through::text FROM product_rollup_state WHERE id = 1")(_.getString(1)) shouldBe RolledThroughReset
    }
  }
}
