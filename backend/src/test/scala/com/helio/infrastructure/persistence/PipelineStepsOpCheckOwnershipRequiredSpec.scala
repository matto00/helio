package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.postgresql.util.PSQLException
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.sql.SQLException

/** HEL-1104 task 2.2 (design.md Decision 2's falsifiability half): `FlywayNonSuperuserMigrationSpec`
 *  proves a role that OWNS `pipeline_steps` (mirroring production's `helio` DB_USER, which creates
 *  every table since V1) can drop/re-add `pipeline_steps_op_check`. That alone only shows ownership
 *  is SUFFICIENT -- it does not show ownership is what actually gates the operation, as opposed to,
 *  say, some other privilege the same setup happens to also grant. This spec closes the other
 *  direction: a role with the identical NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE shape, but that does
 *  NOT own `pipeline_steps`, must be DENIED the exact same drop/re-add, with Postgres's own
 *  ownership error (SQLSTATE 42501, "must be owner of table pipeline_steps") -- not some other failure. */
class PipelineStepsOpCheckOwnershipRequiredSpec extends AnyWordSpec with Matchers {

  "a non-superuser, non-BYPASSRLS role that does not own pipeline_steps" should {

    "be denied with SQLSTATE 42501 (must be owner of table pipeline_steps) when attempting V107's own drop/re-add of pipeline_steps_op_check" in {
      val embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
      try {
        val superConn = embeddedPostgres.getPostgresDatabase.getConnection
        try {
          val stmt = superConn.createStatement()
          try {
            // A minimal table this role does not own, shaped just enough to attempt V107's own
            // constraint drop/re-add against it -- no need to run the full Flyway chain, since the
            // claim under test is purely "ownership gates DROP/ADD CONSTRAINT", independent of
            // pipeline_steps' full real schema.
            stmt.execute("CREATE TABLE pipeline_steps (id TEXT PRIMARY KEY, op TEXT NOT NULL)")
            stmt.execute(
              "ALTER TABLE pipeline_steps ADD CONSTRAINT pipeline_steps_op_check CHECK (op IN ('rename', 'filter'))"
            )
            // Same shape as helio_migration_test/helio in FlywayNonSuperuserMigrationSpec, minus
            // ownership of pipeline_steps -- it owns nothing, deliberately.
            stmt.execute(
              "CREATE ROLE hel1104_non_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'"
            )
          } finally stmt.close()
        } finally superConn.close()

        val nonOwnerUrl = embeddedPostgres.getJdbcUrl("hel1104_non_owner", "postgres")
        val nonOwnerConn = java.sql.DriverManager.getConnection(nonOwnerUrl, "hel1104_non_owner", "test")
        try {
          val stmt = nonOwnerConn.createStatement()
          try {
            val ex = intercept[SQLException] {
              stmt.execute(
                "ALTER TABLE pipeline_steps DROP CONSTRAINT IF EXISTS pipeline_steps_op_check, " +
                  "ADD CONSTRAINT pipeline_steps_op_check CHECK (op IN ('rename', 'filter', 'join'))"
              )
            }
            withClue(s"expected SQLSTATE 42501 (insufficient_privilege / must be owner of table pipeline_steps), got: ${ex.getMessage}") {
              ex.asInstanceOf[PSQLException].getSQLState shouldBe "42501"
            }
            ex.getMessage should include("must be owner of table pipeline_steps")
          } finally stmt.close()
        } finally nonOwnerConn.close()
      } finally embeddedPostgres.close()
    }
  }
}
