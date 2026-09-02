package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.io.Source

/** HEL-943 regression gate: proves the ENTIRE Flyway migration chain applies cleanly, against
 *  REALISTIC pre-migration data, when run as the same kind of role the production deploy
 *  actually uses to run it.
 *
 *  Round 1 (empty-database) blind spot
 *  ------------------------------------
 *  Every other RLS spec in this package (`RlsPolicyGuardSpec`, `RlsOwnerTablesSpec`,
 *  `RlsSharingAwareTablesSpec`, `PublicPathRlsSmokeSpec`, ...) runs `Flyway.migrate()` as the
 *  `postgres` EmbeddedPostgres superuser, then only uses a second, non-superuser role
 *  (`helio_app_test`) to exercise READS/WRITES against an already-migrated schema. That can never
 *  catch a migration STATEMENT itself failing under RLS -- a superuser always bypasses RLS
 *  unconditionally, so `Flyway.migrate()` under `postgres` evaluates zero policies, exactly like
 *  CI's `helio` Postgres-image initdb superuser and exactly like the local-superuser replay that
 *  passed cleanly against a real prod dump the night before the v0.7.9 deploy failed.
 *
 *  This spec's FIRST version fixed that half of the gap (migrating as a genuine non-superuser,
 *  non-BYPASSRLS role) but ran the chain against an EMPTY database. V94's data-migration DO
 *  blocks all loop over query results -- zero pre-existing `pipelines`/`panels`/`data_types` rows
 *  means zero loop iterations, so the `INSERT INTO outputs` / `INSERT INTO node_snapshots`
 *  statements that actually trip RLS were never reached. That gate went green on the v0.7.10
 *  regression (`ERROR: new row violates row-level security policy for table "outputs"`,
 *  Cloud Run revision helio-backend-00068-hb5) despite exercising the DDL and skipping all the
 *  DML that matters. A guard never observed failing against the bug it claims to catch is not
 *  evidence -- exercising the DDL path is not the same as exercising the DML path.
 *
 *  Round 2 fix: seed with `db/fixtures/hel904-real-dump.sql`, a real (scrubbed) `pg_dump` of the
 *  shared dev DB used by `V94OutputsMigrationSpec` -- reused here rather than hand-built, per the
 *  archived HEL-904 evaluation notes: hand-built fixtures, no matter how many rows are added after
 *  each review round, only ever cover the exact instance a reviewer already named, never the class
 *  of defect nobody thought to check for yet (that is literally how this gate's own round-1 gap
 *  went unnoticed). On top of the dump this spec supplements exactly what `V94OutputsMigrationSpec`
 *  already documented as absent from the dump: `alert_rules` (the dev DB carries zero rows) and,
 *  new here, a matching `alert_events` row (task 2.9(f) touches both tables).
 *
 *  What's actually new relative to `V94OutputsMigrationSpec`: that spec proves the DATA migration
 *  is *correct* (right rows land in the right places) but migrates as the `postgres` superuser
 *  throughout, so it cannot see an RLS-context failure either. This spec proves the migration
 *  *applies at all* under real RLS enforcement -- V1 through the newest migration, including the
 *  fixture load itself, run as a role with the same non-superuser, non-BYPASSRLS, table-owner
 *  shape as production's `helio`. The two specs are complementary, not redundant.
 */
class FlywayNonSuperuserMigrationSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  // Same two real ids `V94OutputsMigrationSpec` uses to seed the alert-rules gap in the dump
  // (`select p.id, p.output_data_type_id, p.owner_id from pipelines p where exists (select 1
  // from panels pnl where pnl.type_id = p.output_data_type_id and pnl.type in (...)) limit 1`).
  private val alertPipelineTypeId  = "b1730647-ab3e-40a6-8793-d87d8196ed79"
  private val alertPipelineOwnerId = "d5710fad-da06-4d64-848d-433f3fb9e96e"

  "the full Flyway migration chain, run as a non-superuser role that owns its own schema (mirrors prod DB_USER), against realistic pre-V94 data" should {

    "apply cleanly with real RLS policies enforced on Flyway's own connection" in {
      val embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
      try {
        val superDs = embeddedPostgres.getPostgresDatabase

        // ── Non-superuser migration role, shaped exactly like production's DB_USER (`helio`):
        // LOGIN, NOSUPERUSER, NOBYPASSRLS, and OWNER of the `public` schema so every `CREATE
        // TABLE` it issues makes it the table owner -- exactly what makes FORCE ROW LEVEL
        // SECURITY apply to Flyway's own connection in production. `helio_privileged` is
        // pre-seeded (as a real superuser would provision it once, out-of-band) and ADMIN-OPTION
        // granted, so V34's `CREATE ROLE ... BYPASSRLS` (which only a BYPASSRLS-carrying role may
        // ever issue -- verified empirically against a local Postgres) is a no-op under this role,
        // exactly as it is in production, and V34's trailing `GRANT helio_privileged TO
        // current_user` succeeds. ──────────────────────────────────────────────────────────────
        val superConn = superDs.getConnection
        try {
          val stmt = superConn.createStatement()
          stmt.execute("CREATE ROLE helio_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
          stmt.execute("ALTER SCHEMA public OWNER TO helio_migration_test")
          stmt.execute("GRANT CREATE, USAGE ON SCHEMA public TO helio_migration_test")
          stmt.execute("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
          stmt.execute("GRANT helio_privileged TO helio_migration_test WITH ADMIN OPTION")
          stmt.close()
        } finally superConn.close()

        val migrationUrl = embeddedPostgres.getJdbcUrl("helio_migration_test", "postgres")

        // ── Migrate ONLY to V93 (pre-outputs-model) as the non-superuser role -- every table
        // V94 will touch is already owned by `helio_migration_test`, matching production, where
        // the same DB_USER has run every migration since V1. ──────────────────────────────────
        Flyway
          .configure()
          .dataSource(migrationUrl, "helio_migration_test", "test")
          .locations("classpath:db/migration")
          .target(MigrationVersion.fromVersion("93"))
          .load()
          .migrate()

        // ── Seed realistic pre-V94 data: the real (scrubbed) pg_dump from the shared dev DB,
        // loaded verbatim via a raw superuser connection (a superuser bypasses RLS/ownership
        // checks unconditionally, so the LOAD itself -- as opposed to the migration under test --
        // does not need to run as `helio_migration_test`). This is what round 1 of this gate
        // omitted: without it, V94's backfill DO blocks loop zero times and never reach the
        // INSERTs that actually trip RLS. Mirrors `V94OutputsMigrationSpec`'s exact fixture-load
        // recipe (truncate the dump's target tables first, since V1-V93's own seed migrations
        // already populated a fixed-id baseline user). ────────────────────────────────────────
        val rawConn = superDs.getConnection
        try {
          val truncStmt = rawConn.createStatement()
          try
            truncStmt.execute(
              """TRUNCATE TABLE users, data_sources, data_types, pipelines, pipeline_steps, panels,
                |dashboards, metrics, binary_refs, data_type_rows, patch_set_applications
                |RESTART IDENTITY CASCADE""".stripMargin
            )
          finally truncStmt.close()

          val dumpSql = {
            val src = Source.fromResource("db/fixtures/hel904-real-dump.sql")
            try src.mkString
            finally src.close()
          }
          val dumpStmt = rawConn.createStatement()
          try dumpStmt.execute(dumpSql)
          finally dumpStmt.close()

          // The dump's own header resets `search_path` to '' (newer pg_dump's search-path-
          // injection hardening -- `SELECT pg_catalog.set_config('search_path', '', false)`,
          // which is why every statement inside the dump is schema-qualified as
          // `public.<table>`). That `SET` is session-scoped, not local to the dump's own
          // statements, so without restoring it here every UNQUALIFIED reference on this SAME
          // connection for the rest of its life fails with a spurious "relation ... does not
          // exist" -- caught empirically while wiring up the seed inserts below.
          val resetSearchPathStmt = rawConn.createStatement()
          try resetSearchPathStmt.execute("SET search_path TO public")
          finally resetSearchPathStmt.close()

          // Supplement exactly what `V94OutputsMigrationSpec` documents as absent from the dump:
          // the dev DB carries zero `alert_rules` rows, so task 2.9(f)'s `UPDATE alert_rules` /
          // `UPDATE alert_events` backfill (the other DML this migration performs against a
          // FORCE-RLS table) has nothing real to exercise otherwise. One rule + one matching
          // event, bound to a real pipeline/type pair the dump already contains.
          val seedStmt = rawConn.createStatement()
          try {
            seedStmt.execute(
              s"""INSERT INTO alert_rules (id, owner_id, target_data_type_id, metric, condition, name, severity)
                 |VALUES ('hel943-gate-rule', '$alertPipelineOwnerId'::uuid, '$alertPipelineTypeId', 'value', '{}', 'hel943-gate-rule', 'info')""".stripMargin
            )
            seedStmt.execute(
              s"""INSERT INTO alert_events (id, alert_rule_id, owner_id, target_data_type_id, value, severity, state, first_fired_at, last_evaluated_at)
                 |VALUES ('hel943-gate-event', 'hel943-gate-rule', '$alertPipelineOwnerId'::uuid, '$alertPipelineTypeId', '{}', 'info', 'firing', now(), now())""".stripMargin
            )
          } finally seedStmt.close()
        } finally rawConn.close()

        // Sanity: the seed actually produced non-empty loop inputs for V94's backfills -- if this
        // ever goes to zero (e.g. the fixture file changes shape), the gate above would silently
        // stop testing the DML path again, exactly like round 1. Asserting it here makes that
        // regression visible in THIS spec rather than requiring a second incident to notice.
        val superDbPreV94 = JdbcBackend.Database.forDataSource(superDs, Some(2))
        try {
          val pipelineCount = await(superDbPreV94.run(sql"SELECT count(*) FROM pipelines".as[Int].head))
          val panelCount    = await(superDbPreV94.run(sql"SELECT count(*) FROM panels".as[Int].head))
          val boundPanelCount = await(
            superDbPreV94.run(
              sql"""SELECT count(*) FROM panels
                    WHERE type IN ('metric', 'chart', 'table', 'collection', 'timeline')
                       OR (type IN ('text', 'markdown') AND type_id IS NOT NULL)"""
                .as[Int]
                .head
            )
          )
          val dataTypeRowCount = await(superDbPreV94.run(sql"SELECT count(*) FROM data_type_rows".as[Int].head))
          // HEL-943 round 3: at least one panel with `metric_id` set (an HEL-292 aggregation
          // panel) is what drives section 9's `SELECT ... FROM metrics` -- the statement rounds
          // 1/2 of this gate never reached, because neither an empty database nor round 2's
          // first fixture pass exercised this branch. `metrics` is dropped by V94 itself, so this
          // must be read BEFORE migrating.
          val metricIdPanelCount = await(superDbPreV94.run(sql"SELECT count(*) FROM panels WHERE metric_id IS NOT NULL".as[Int].head))
          val alertRuleCount   = await(superDbPreV94.run(sql"SELECT count(*) FROM alert_rules".as[Int].head))
          val alertEventCount  = await(superDbPreV94.run(sql"SELECT count(*) FROM alert_events".as[Int].head))
          val binaryRefCount   = await(superDbPreV94.run(sql"SELECT count(*) FROM binary_refs".as[Int].head))
          val nonEmptyPatchSetCount = await(
            superDbPreV94.run(sql"SELECT count(*) FROM patch_set_applications WHERE edits <> '[]'::jsonb".as[Int].head)
          )
          withClue("Fixture sanity -- pipelines: ") { pipelineCount should be > 0 }
          withClue("Fixture sanity -- panels: ") { panelCount should be > 0 }
          withClue("Fixture sanity -- panels bound to an Output-producing type (drives the INSERT INTO outputs backfill): ") {
            boundPanelCount should be > 1 // multiple panels per pipeline, per the archived HEL-904 ordering note
          }
          withClue("Fixture sanity -- data_type_rows (drives the INSERT INTO node_snapshots backfill): ") {
            dataTypeRowCount should be > 0
          }
          withClue("Fixture sanity -- panels with metric_id set (drives the SELECT FROM metrics backfill branch): ") {
            metricIdPanelCount should be > 0
          }
          withClue("Fixture sanity -- alert_rules (drives the UPDATE alert_rules backfill): ") { alertRuleCount should be > 0 }
          withClue("Fixture sanity -- alert_events (drives the UPDATE alert_events backfill): ") { alertEventCount should be > 0 }
          withClue("Fixture sanity -- binary_refs (drives the UPDATE binary_refs backfill): ") { binaryRefCount should be > 0 }
          withClue("Fixture sanity -- patch_set_applications with non-empty edits (drives section 15's UPDATE/DELETE): ") {
            nonEmptyPatchSetCount should be > 0
          }
        } finally superDbPreV94.close()

        // ── Migrate to latest (applies V94) as the SAME non-superuser role. This is the
        // load-bearing step: with realistic data now in place, every DO block's loop actually
        // executes, reaching the INSERT/UPDATE/DELETE statements against FORCE-RLS tables that
        // round 1 of this gate never reached. ─────────────────────────────────────────────────
        noException should be thrownBy {
          Flyway
            .configure()
            .dataSource(migrationUrl, "helio_migration_test", "test")
            .locations("classpath:db/migration")
            .load()
            .migrate()
        }

        val migratedDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(2))
        try {
          // Sanity: the migration actually ran to completion and really populated `outputs`/
          // `node_snapshots` from the seeded data (not a vacuous no-row-touched pass).
          val outputsCount = await(migratedDb.run(sql"SELECT count(*) FROM outputs".as[Int].head))
          val snapshotsCount = await(migratedDb.run(sql"SELECT count(*) FROM node_snapshots".as[Int].head))
          withClue("outputs should be non-empty after V94's panel-backfill DML actually ran: ") { outputsCount should be > 0 }
          withClue("node_snapshots should be non-empty after V94's data_type_rows backfill actually ran: ") {
            snapshotsCount should be > 0
          }

          // HEL-943: prove the fix's `NO FORCE` / `FORCE` bracket (V94 sections 0/22, plus the
          // deferred-FORCE treatment of `outputs`/`node_snapshots` created in sections 2/3)
          // actually leaves EVERY affected table with FORCE ROW LEVEL SECURITY on at the end --
          // the pre-existing 8 restored, and the 2 new tables getting it for the first time.
          // Migrating as `helio_migration_test` itself (not the `postgres` superuser) is what
          // makes this check meaningful: only a non-superuser reconnecting to these tables would
          // ever observe a bracket left open.
          val forceRlsTables = Seq(
            "pipelines",
            "data_sources",
            "pipeline_steps",
            "panels",
            "binary_refs",
            "alert_rules",
            "alert_events",
            "patch_set_applications",
            "outputs",
            "node_snapshots"
          )
          for (tableName <- forceRlsTables) {
            val forced = await(
              migratedDb.run(
                sql"""SELECT relforcerowsecurity FROM pg_class WHERE relname = $tableName AND relkind = 'r'"""
                  .as[Boolean]
                  .head
              )
            )
            withClue(s"Table '$tableName' should have FORCE ROW LEVEL SECURITY set after V94: ") {
              forced shouldBe true
            }
          }
        } finally migratedDb.close()
      } finally embeddedPostgres.close()
    }
  }
}
