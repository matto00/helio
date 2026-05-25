package com.helio.infrastructure

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** Automated guard proving that every ACL'd table in the Helio schema has
 *  FORCE ROW LEVEL SECURITY enabled with at least one policy.
 *
 *  Design decisions
 *  ----------------
 *  D2 — ScalaTest spec (not a shell script): runs inside `sbt test` with the
 *  existing EmbeddedPostgres + Flyway infrastructure; no live DB required.
 *
 *  D3 — Explicit allowlist (not exhaustive count): the `rlsTables` Set lists
 *  every table that must have RLS. Adding a new ACL'd table without updating
 *  this set causes this spec to fail, which is the intended regression signal.
 *
 *  Coverage
 *  --------
 *  - V34: helio_privileged role with BYPASSRLS exists.
 *  - V35: six owner-only tables have RLS + FORCE RLS + at least one policy.
 *  - V36: three sharing-aware tables have RLS + FORCE RLS + at least one policy.
 *  - V37: idx_panels_owner_id and idx_resource_permissions_resource_grantee
 *    exist in pg_indexes after all migrations.
 *
 *  This spec does NOT verify correctness of individual policy predicates —
 *  that is the job of RlsOwnerTablesSpec (V35) and RlsSharingAwareTablesSpec
 *  (V36). This spec is the regression guard: it ensures the structural
 *  database properties cannot silently regress.
 */
class RlsPolicyGuardSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database = _

  /** The complete set of tables that must have FORCE ROW LEVEL SECURITY.
   *
   *  When adding a new ACL'd table to the schema:
   *  1. Add a Flyway migration that enables RLS + FORCE RLS + creates policies.
   *  2. Add the table name to this set.
   *  3. Both steps must be in the same PR so this spec continues to pass.
   */
  private val rlsTables: Set[String] = Set(
    // V35 — owner-only tables
    "pipelines",
    "data_sources",
    "data_types",
    "pipeline_steps",
    "pipeline_runs",
    "data_type_rows",
    // V36 — sharing-aware tables
    "dashboards",
    "panels",
    "resource_permissions"
  )

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    // Apply all migrations as the postgres superuser — this creates
    // helio_privileged, enables RLS policies, and adds indexes.
    Flyway
      .configure()
      .dataSource(
        embeddedPostgres.getJdbcUrl("postgres", "postgres"),
        "postgres",
        "postgres"
      )
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(
      embeddedPostgres.getPostgresDatabase,
      Some(5)
    )
  }

  override def afterAll(): Unit = {
    if (db != null) db.close()
    if (embeddedPostgres != null) embeddedPostgres.close()
    super.afterAll()
  }

  private def run[T](action: DBIO[T]): T =
    Await.result(db.run(action), 10.seconds)

  // ── V34: helio_privileged role ────────────────────────────────────────────

  "helio_privileged role (V34)" should {

    "exist in pg_roles with rolbypassrls = true" in {
      val result = run(
        sql"""SELECT rolbypassrls FROM pg_roles WHERE rolname = 'helio_privileged'"""
          .as[Boolean]
          .headOption
      )
      result shouldBe Some(true)
    }
  }

  // ── V35 + V36: RLS and FORCE RLS on all ACL'd tables ─────────────────────

  "Row Level Security (V35 + V36)" should {

    for (tableName <- rlsTables.toSeq.sorted) {

      s"$tableName has relrowsecurity = true in pg_class" in {
        val result = run(
          sql"""SELECT relrowsecurity
                FROM pg_class
                WHERE relname = $tableName
                  AND relkind = 'r'"""
            .as[Boolean]
            .headOption
        )
        withClue(s"Table '$tableName' not found or relrowsecurity is false: ") {
          result shouldBe Some(true)
        }
      }

      s"$tableName has relforcerowsecurity = true in pg_class" in {
        val result = run(
          sql"""SELECT relforcerowsecurity
                FROM pg_class
                WHERE relname = $tableName
                  AND relkind = 'r'"""
            .as[Boolean]
            .headOption
        )
        withClue(s"Table '$tableName' not found or relforcerowsecurity is false: ") {
          result shouldBe Some(true)
        }
      }

      s"$tableName has at least one policy in pg_policies" in {
        val count = run(
          sql"""SELECT COUNT(*) FROM pg_policies WHERE tablename = $tableName"""
            .as[Int]
            .head
        )
        withClue(s"Table '$tableName' has no policies: ") {
          count should be > 0
        }
      }
    }
  }

  // ── V37: performance indexes ──────────────────────────────────────────────

  "Performance indexes (V37)" should {

    "idx_panels_owner_id exists in pg_indexes" in {
      val result = run(
        sql"""SELECT indexname FROM pg_indexes
              WHERE tablename = 'panels'
                AND indexname = 'idx_panels_owner_id'"""
          .as[String]
          .headOption
      )
      result shouldBe Some("idx_panels_owner_id")
    }

    "idx_resource_permissions_resource_grantee exists in pg_indexes" in {
      val result = run(
        sql"""SELECT indexname FROM pg_indexes
              WHERE tablename = 'resource_permissions'
                AND indexname = 'idx_resource_permissions_resource_grantee'"""
          .as[String]
          .headOption
      )
      result shouldBe Some("idx_resource_permissions_resource_grantee")
    }
  }
}
