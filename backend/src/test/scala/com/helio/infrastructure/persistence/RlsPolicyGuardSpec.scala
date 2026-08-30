package com.helio.infrastructure.persistence

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
 *  D3 — Explicit allowlist (not exhaustive count): the `rlsTables` map lists
 *  every table that must have RLS. Adding a new ACL'd table without updating
 *  this map causes this spec to fail, which is the intended regression
 *  signal. Each entry's value is `None` for the ordinary "at least one
 *  policy exists" check, or `Some(expectedPolicyNames)` for tables where
 *  more than one policy exists and an exact name-set match is needed to
 *  catch one of several policies being silently dropped (see `audit_events`
 *  below and HEL-842).
 *
 *  Coverage
 *  --------
 *  - V34: helio_privileged role with BYPASSRLS exists.
 *  - V35: six owner-only tables have RLS + FORCE RLS + at least one policy.
 *  - V36: three sharing-aware tables have RLS + FORCE RLS + at least one policy.
 *  - V37: idx_panels_owner_id and idx_resource_permissions_resource_grantee
 *    exist in pg_indexes after all migrations.
 *  - HEL-842: a dedicated non-vacuousness probe test (below) proves the
 *    per-table check actually fails when a required policy is dropped,
 *    against a second, disposable EmbeddedPostgres+Flyway instance.
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

  /** The complete set of tables that must have FORCE ROW LEVEL SECURITY,
   *  mapped to an optional expected policy-name set.
   *
   *  When adding a new ACL'd table to the schema:
   *  1. Add a Flyway migration that enables RLS + FORCE RLS + creates policies.
   *  2. Add the table name to this map (`None` unless it carries more than
   *     one policy, in which case use `Some(expectedPolicyNames)`).
   *  3. Both steps must be in the same PR so this spec continues to pass.
   */
  private val rlsTables: Map[String, Option[Set[String]]] = Map(
    // V35 — owner-only tables
    "pipelines" -> None,
    "data_sources" -> None,
    "data_types" -> None,
    "pipeline_steps" -> None,
    "pipeline_runs" -> None,
    "data_type_rows" -> None,
    // V36 — sharing-aware tables
    "dashboards" -> None,
    "panels" -> None,
    "resource_permissions" -> None,
    // V42 — owner-only Personal Access Tokens (HEL-148 Phase 1)
    "api_tokens" -> None,
    // V46 — binary_refs, indirect owner via data_type_id -> data_types (HEL-217)
    "binary_refs" -> None,
    // V54 — image_uploads, direct owner (HEL-246)
    "image_uploads" -> None,
    // V60 — alert_rules, direct owner (HEL-447)
    "alert_rules" -> None,
    // V61 — alert_events, direct owner (HEL-455)
    "alert_events" -> None,
    // V62 — pipeline_schedules, indirect owner via pipeline_id -> pipelines (HEL-414)
    "pipeline_schedules" -> None,
    // V75 — metrics, direct owner (HEL-446)
    "metrics" -> None,
    // V77 — authoring_conversations, direct owner (HEL-397)
    "authoring_conversations" -> None,
    // V79 — patch_set_applications, direct owner (HEL-413)
    "patch_set_applications" -> None,
    // V80 — assistant_conversations, direct owner (HEL-663)
    "assistant_conversations" -> None,
    // V81 — agent_preferences, direct owner (user_id is itself the PK) (HEL-472 / 420-A)
    "agent_preferences" -> None,
    // V82 — agent_memory, direct owner (HEL-478 / 420-B)
    "agent_memory" -> None,
    // V84 — pipeline_run_assertions, indirect owner via run_id -> pipeline_runs
    // -> pipelines.owner_id (HEL-509 / 419-B)
    "pipeline_run_assertions" -> None,
    // V88 — assistant_daily_usage, direct owner (user_id is part of the composite PK) (HEL-703)
    "assistant_daily_usage" -> None,
    // V90 — invite_codes, direct owner (HEL-704)
    "invite_codes" -> None,
    // V91 — audit_events, direct owner via actor_user_id, three-policy split
    // (HEL-471). The append-only guarantee is carried by BEFORE STATEMENT
    // triggers, not RLS (see the migration's own header) — these three
    // policies are read-scoping/defence-in-depth, not the load-bearing
    // mechanism. A bare `count > 0` check would stay green if
    // audit_events_update or audit_events_delete were silently dropped
    // while audit_events_owner remained, so this entry asserts the full
    // expected policy-name set instead (HEL-842).
    "audit_events" -> Some(Set("audit_events_owner", "audit_events_update", "audit_events_delete")),
    // V92 — connector_credentials, direct owner (user_id), single policy,
    // V35 pattern (HEL-536). Previously missing from this allowlist (HEL-842).
    "connector_credentials" -> None,
    // V93 — connectors, direct owner (HEL-821)
    "connectors" -> None
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

  private def run[T](action: DBIO[T])(implicit database: JdbcBackend.Database): T =
    Await.result(database.run(action), 10.seconds)

  /** Structural checks shared by the main per-table loop below AND the
   *  non-vacuousness probe test (D3), so a future weakening of one cannot
   *  drift from the other — the probe must exercise the exact code path the
   *  spec ships, not a copy of it.
   */
  private def checkRowSecurity(tableName: String)(implicit database: JdbcBackend.Database): Either[String, Unit] = {
    val result = run(
      sql"""SELECT relrowsecurity FROM pg_class WHERE relname = $tableName AND relkind = 'r'"""
        .as[Boolean]
        .headOption
    )
    if (result == Some(true)) Right(())
    else Left(s"Table '$tableName' not found or relrowsecurity is false")
  }

  private def checkForceRowSecurity(
      tableName: String
  )(implicit database: JdbcBackend.Database): Either[String, Unit] = {
    val result = run(
      sql"""SELECT relforcerowsecurity FROM pg_class WHERE relname = $tableName AND relkind = 'r'"""
        .as[Boolean]
        .headOption
    )
    if (result == Some(true)) Right(())
    else Left(s"Table '$tableName' not found or relforcerowsecurity is false")
  }

  private def checkPolicies(tableName: String, expectedPolicyNames: Option[Set[String]])(implicit
      database: JdbcBackend.Database
  ): Either[String, Unit] = expectedPolicyNames match {
    case None =>
      val count = run(
        sql"""SELECT COUNT(*) FROM pg_policies WHERE tablename = $tableName""".as[Int].head
      )
      if (count > 0) Right(()) else Left(s"Table '$tableName' has no policies")
    case Some(expected) =>
      val actual = run(
        sql"""SELECT policyname FROM pg_policies WHERE tablename = $tableName""".as[String]
      ).toSet
      if (actual == expected) Right(())
      else Left(s"Table '$tableName' expected policies $expected but found $actual")
  }

  "helio_privileged role (V34)" should {

    "exist in pg_roles with rolbypassrls = true" in {
      val result = run(
        sql"""SELECT rolbypassrls FROM pg_roles WHERE rolname = 'helio_privileged'"""
          .as[Boolean]
          .headOption
      )(db)
      result shouldBe Some(true)
    }
  }

  "Row Level Security (V35 + V36)" should {

    for ((tableName, expectedPolicyNames) <- rlsTables.toSeq.sortBy(_._1)) {

      s"$tableName has relrowsecurity = true in pg_class" in {
        withClue(s"Table '$tableName': ") {
          checkRowSecurity(tableName)(db) shouldBe Right(())
        }
      }

      s"$tableName has relforcerowsecurity = true in pg_class" in {
        withClue(s"Table '$tableName': ") {
          checkForceRowSecurity(tableName)(db) shouldBe Right(())
        }
      }

      expectedPolicyNames match {
        case None =>
          s"$tableName has at least one policy in pg_policies" in {
            withClue(s"Table '$tableName': ") {
              checkPolicies(tableName, None)(db) shouldBe Right(())
            }
          }
        case Some(expected) =>
          s"$tableName has exactly the expected policies $expected in pg_policies" in {
            withClue(s"Table '$tableName': ") {
              checkPolicies(tableName, Some(expected))(db) shouldBe Right(())
            }
          }
      }
    }
  }

  "Performance indexes (V37)" should {

    "idx_panels_owner_id exists in pg_indexes" in {
      val result = run(
        sql"""SELECT indexname FROM pg_indexes
              WHERE tablename = 'panels'
                AND indexname = 'idx_panels_owner_id'"""
          .as[String]
          .headOption
      )(db)
      result shouldBe Some("idx_panels_owner_id")
    }

    "idx_resource_permissions_resource_grantee exists in pg_indexes" in {
      val result = run(
        sql"""SELECT indexname FROM pg_indexes
              WHERE tablename = 'resource_permissions'
                AND indexname = 'idx_resource_permissions_resource_grantee'"""
          .as[String]
          .headOption
      )(db)
      result shouldBe Some("idx_resource_permissions_resource_grantee")
    }
  }

  "Regression-guard sanity check (HEL-842, design.md D3)" should {

    "fails when a required policy is missing" in {
      // A separate, disposable EmbeddedPostgres+Flyway instance so this
      // destructive DROP POLICY never touches the shared beforeAll instance
      // the other tests in this spec depend on.
      val probePostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
      try {
        Flyway
          .configure()
          .dataSource(probePostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
          .locations("classpath:db/migration")
          .load()
          .migrate()

        implicit val probeDb: JdbcBackend.Database =
          JdbcBackend.Database.forDataSource(probePostgres.getPostgresDatabase, Some(5))
        try {
          val expected = rlsTables("audit_events").get

          // Sanity: the check passes before we break anything. Uses the same
          // checkPolicies the shipped loop above calls — not a copy of it.
          checkPolicies("audit_events", Some(expected)) shouldBe Right(())

          run(sqlu"""DROP POLICY audit_events_update ON audit_events""")

          val result = checkPolicies("audit_events", Some(expected))
          withClue("Expected the guard to fail after dropping audit_events_update: ") {
            result.isLeft shouldBe true
          }
        } finally probeDb.close()
      } finally probePostgres.close()
    }
  }
}
