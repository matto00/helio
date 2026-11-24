package com.helio.infrastructure.persistence

import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.sql.{Connection, ResultSet, SQLException}
import java.util.UUID

/** HEL-1852: V148 lowercases and trims `users.email`, replaces the case-sensitive `UNIQUE`
 *  constraint with a unique index on `lower(email)`, and FAILS LOUDLY (changing nothing) when
 *  case/whitespace duplicates already exist -- it never merges or drops rows. Each case gets its own
 *  embedded database, migrated to V147, seeded over the superuser connection, then migrated to head.
 */
class V148UsersEmailLowerUniqueMigrationSpec extends AnyWordSpec with Matchers {

  private def rows[T](c: Connection, sql: String)(f: ResultSet => T): Vector[T] = {
    val st = c.createStatement()
    try {
      val rs = st.executeQuery(sql)
      try Iterator.continually(rs).takeWhile(_.next()).map(f).toVector
      finally rs.close()
    } finally st.close()
  }
  private def exec(c: Connection, sql: String): Unit = { val st = c.createStatement(); try st.execute(sql) finally st.close() }

  /** Seeds `emails` (all with no password) at V147, runs V148, hands the open connection and the migrate outcome to `body`. */
  private def withMigrated[T](emails: Seq[String])(body: (Connection, Either[Throwable, Unit]) => T): T = {
    val pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    try {
      val url = pg.getJdbcUrl("postgres", "postgres")
      def flyway(target: Option[String]) = {
        val b = Flyway.configure().dataSource(url, "postgres", "postgres").locations("classpath:db/migration")
        target.foreach(t => b.target(MigrationVersion.fromVersion(t)))
        b.load()
      }
      flyway(Some("147")).migrate()
      val c = pg.getPostgresDatabase.getConnection
      try {
        emails.foreach { e =>
          val ps = c.prepareStatement("INSERT INTO users (id, email, password_hash) VALUES (?::uuid, ?, 'x')")
          ps.setString(1, UUID.randomUUID().toString); ps.setString(2, e); ps.executeUpdate(); ps.close()
        }
        val outcome = try { flyway(None).migrate(); Right(()) } catch { case e: Exception => Left(e) }
        body(c, outcome)
      } finally c.close()
    } finally pg.close()
  }

  private def emailsOf(c: Connection): Set[String] =
    rows(c, "SELECT email FROM users WHERE email NOT LIKE '%system%'")(_.getString(1)).toSet

  /** The SQLException in the cause chain raised by V148's `RAISE EXCEPTION` (SQLState P0001, raise_exception).
   *  Asserting on it, not on a bare "HEL-1852", matters: Flyway's own message embeds the worktree path,
   *  which contains that ticket id, so a substring check passes even when the DO block never raises. */
  private def raised(t: Throwable): SQLException =
    Iterator.iterate[Throwable](t)(_.getCause).takeWhile(_ != null).collectFirst { case e: SQLException if e.getSQLState == "P0001" => e }
      .getOrElse(fail(s"no P0001 (RAISE EXCEPTION) SQLException in the cause chain of: ${t.getMessage}"))

  private val RaiseText = "V148: case-insensitive email duplicates exist"

  "V148" should {
    "lowercase mixed-case rows, trim padded ones, and create the unique lower(email) index" in {
      withMigrated(Seq("Alice@Example.TEST", "\tbob@example.test\n", "carol@example.test")) { (c, outcome) =>
        outcome shouldBe Right(())
        emailsOf(c) should contain allOf ("alice@example.test", "bob@example.test", "carol@example.test")
        rows(c, "SELECT indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_email_lower_key'")(_.getString(1)).head should include("lower(email)")
        // The case-sensitive constraint is gone.
        rows(c, "SELECT count(*) FROM pg_constraint WHERE conname = 'users_email_key'")(_.getInt(1)).head shouldBe 0
        // Case-variant insert is rejected by the database.
        val ex = intercept[SQLException](exec(c, "INSERT INTO users (id, email, password_hash) VALUES (gen_random_uuid(), 'ALICE@example.test', 'x')"))
        ex.getSQLState shouldBe "23505"
      }
    }

    "fail with a clear message, changing nothing, when a case-duplicate exists" in {
      withMigrated(Seq("a@example.test", "A@Example.test", "other@example.test")) { (c, outcome) =>
        outcome.isLeft shouldBe true
        raised(outcome.left.toOption.get).getMessage should (include(RaiseText) and include("no rows were changed"))
        emailsOf(c) shouldBe Set("a@example.test", "A@Example.test", "other@example.test")
      }
    }

    "fail on a duplicate that differs only by a leading/trailing tab or newline (plus case), changing nothing" in {
      withMigrated(Seq("dup@example.test", "\tDUP@example.test\n")) { (c, outcome) =>
        outcome.isLeft shouldBe true
        raised(outcome.left.toOption.get).getMessage should (include(RaiseText) and include("1 group(s)"))
        emailsOf(c) shouldBe Set("dup@example.test", "\tDUP@example.test\n")
      }
    }

    "never merge or drop rows: row count is unchanged on success" in {
      withMigrated(Seq("x@example.test", "Y@example.test", " z@example.test ")) { (c, outcome) =>
        outcome shouldBe Right(())
        rows(c, "SELECT count(*) FROM users WHERE email IN ('x@example.test','y@example.test','z@example.test')")(_.getInt(1)).head shouldBe 3
      }
    }
  }
}
