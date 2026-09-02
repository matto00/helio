package com.helio.infrastructure.persistence

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-943 regression gate: proves the ENTIRE Flyway migration chain applies cleanly when run
 *  as the same kind of role the production deploy actually uses to run it.
 *
 *  Why this gate did not already exist (the blind spot)
 *  ------------------------------------------------------
 *  Every other RLS spec in this package (`RlsPolicyGuardSpec`, `RlsOwnerTablesSpec`,
 *  `RlsSharingAwareTablesSpec`, `PublicPathRlsSmokeSpec`, ...) runs `Flyway.migrate()` as the
 *  `postgres` EmbeddedPostgres superuser, then only uses a second, non-superuser role
 *  (`helio_app_test`) to exercise READS/WRITES against an already-migrated schema. That is the
 *  right pattern for testing policy correctness, but it can never catch a migration STATEMENT
 *  itself failing under RLS -- a superuser always bypasses RLS outright (independent of
 *  BYPASSRLS), so `Flyway.migrate()` under `postgres` evaluates zero policies, exactly like
 *  CI's `helio` Postgres-image initdb superuser (see this spec's own header note in
 *  `RlsPolicyGuardSpec`) and exactly like the local-superuser replay that passed cleanly against
 *  a real prod dump the night before the v0.7.9 deploy failed.
 *
 *  In production, `Database.initApp` (com.helio.infrastructure.persistence.Database) runs
 *  Flyway with the plain `DB_USER` credentials (`helio`) -- the same non-privileged,
 *  non-BYPASSRLS role every `withUserContext` request uses, NOT `postgres` and NOT
 *  `helio_privileged`. `helio` also owns every table Flyway creates (CREATE TABLE run as that
 *  role makes it the owner), which is exactly why `FORCE ROW LEVEL SECURITY` -- there to stop
 *  the table OWNER bypassing RLS -- applies to Flyway's own migration connection in production.
 *  V94__outputs_model.sql line 49 hit this directly: `UPDATE pipeline_steps ...` evaluates
 *  `pipeline_steps`'s V35 owner policy (`current_setting('app.current_user_id')::uuid`, no
 *  `missing_ok`) with the GUC never SET on Flyway's raw JDBC connection --
 *  `ERROR: unrecognized configuration parameter "app.current_user_id"` (SQLSTATE 42704).
 *
 *  This spec closes that gap by running the FULL migration chain (`V1` through the newest) as a
 *  fresh non-superuser, non-BYPASSRLS, LOGIN role that owns the schema it creates -- the same
 *  shape as production's `helio` -- against a disposable EmbeddedPostgres instance. It is
 *  deliberately generic (not V94-specific): any future migration that DML's an existing
 *  FORCE-RLS table without going through `NO FORCE ROW LEVEL SECURITY` bracketing (or an
 *  equivalent migration-context mechanism) will fail this gate the same way V94 did.
 */
class FlywayNonSuperuserMigrationSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 10.seconds)

  "the full Flyway migration chain, run as a non-superuser role that owns its own schema (mirrors prod DB_USER)" should {

    "apply cleanly with real RLS policies enforced on Flyway's own connection" in {
      val embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
      try {
        val superDs = embeddedPostgres.getPostgresDatabase

        // Create a fresh LOGIN role with NO superuser and NO BYPASSRLS -- the same posture as
        // production's DB_USER (`helio`). Make it the OWNER of the `public` schema so every
        // `CREATE TABLE` Flyway issues as this role makes the role the table owner, exactly as
        // happens in production (Flyway there also creates every table as `helio`).
        // In production `helio_privileged` (BYPASSRLS) is provisioned once, out-of-band, by an
        // operator with real superuser access -- NOT created by `helio` itself at migration time
        // (Postgres refuses to let a non-BYPASSRLS role create a BYPASSRLS role; verified
        // empirically against a local Postgres: "Only roles with the BYPASSRLS attribute may
        // create roles with the BYPASSRLS attribute"). V34__rls_privileged_role.sql's `CREATE
        // ROLE` is inside an `IF NOT EXISTS` DO block specifically so a from-scratch deploy where
        // an operator pre-seeded the role is a no-op there; only the trailing
        // `GRANT helio_privileged TO current_user` needs to succeed for `helio`, which requires
        // ADMIN OPTION on that role (also granted here, mirroring the one-time operator setup).
        // This is reproduced here (not glossed over) so the gate exercises the REAL non-BYPASSRLS
        // posture `helio` has for every migration from V35 onward, not an accidentally-privileged
        // stand-in.
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

        noException should be thrownBy {
          Flyway
            .configure()
            .dataSource(migrationUrl, "helio_migration_test", "test")
            .locations("classpath:db/migration")
            .load()
            .migrate()
        }

        // Sanity: the migration actually ran to completion (not a no-op) and the resulting
        // schema is queryable as the same non-superuser role that just migrated it.
        val migratedDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(2))
        try {
          val outputsExists = await(
            migratedDb.run(
              sql"""SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'outputs')"""
                .as[Boolean]
                .head
            )
          )
          outputsExists shouldBe true

          // HEL-943: prove the fix's `NO FORCE` / `FORCE` bracket (V94 sections 0/22) actually
          // restores the pre-migration RLS posture -- every pre-existing table it toggles must
          // come out the other side with FORCE ROW LEVEL SECURITY back on, exactly like every
          // table `RlsPolicyGuardSpec` already asserts this of. Migrating as `helio_migration_test`
          // itself (not the `postgres` superuser) is what makes this check meaningful: only a
          // non-superuser reconnecting to these tables would ever observe a bracket left open.
          val bracketedTables = Seq(
            "pipelines",
            "data_sources",
            "pipeline_steps",
            "panels",
            "binary_refs",
            "alert_rules",
            "alert_events",
            "patch_set_applications"
          )
          for (tableName <- bracketedTables) {
            val forced = await(
              migratedDb.run(
                sql"""SELECT relforcerowsecurity FROM pg_class WHERE relname = $tableName AND relkind = 'r'"""
                  .as[Boolean]
                  .head
              )
            )
            withClue(s"Table '$tableName' should have FORCE ROW LEVEL SECURITY restored after V94: ") {
              forced shouldBe true
            }
          }
        } finally migratedDb.close()
      } finally embeddedPostgres.close()
    }
  }
}
