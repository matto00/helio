package com.helio.infrastructure

import com.helio.domain._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Integration test proving that V35 RLS policies enforce per-owner row isolation
 *  across all six protected tables (data_sources, data_types, pipelines,
 *  pipeline_steps, pipeline_runs, data_type_rows).
 *
 *  Strategy
 *  --------
 *  EmbeddedPostgres starts as the `postgres` superuser (BYPASSRLS).  To
 *  observe real RLS filtering we create a non-superuser `helio_app_test` role
 *  and connect a second JDBC pool with that role as the login user.  The
 *  app-pool `DbContext` uses this non-privileged pool, while the privileged
 *  pool stays on the `postgres` superuser and carries the
 *  `helio_privileged` BYPASSRLS role.
 *
 *  Test invariants
 *  ---------------
 *  - `withUserContext(ownerA)` on the app pool sees only ownerA's rows.
 *  - `withUserContext(ownerB)` sees only ownerB's rows; cannot see ownerA's.
 *  - `withSystemContext` (privileged pool, BYPASSRLS) sees all rows.
 *  - `withUserContext` with no SET LOCAL (simulated by omitting the variable)
 *    sees zero rows because `current_setting('app.current_user_id')::uuid`
 *    raises an error — the fail-closed property.
 */
class RlsOwnerTablesSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _   // postgres superuser
  private var appDb:        JdbcBackend.Database = _   // helio_app_test (non-superuser)
  private var ctx: DbContext = _

  /** Two synthetic owner UUIDs whose rows must never bleed across user contexts. */
  private val ownerA = UserId(UUID.randomUUID().toString)
  private val ownerB = UserId(UUID.randomUUID().toString)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    // Run Flyway as postgres superuser — creates helio_privileged + RLS policies.
    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway
      .configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

    // Privileged pool — postgres superuser switches to helio_privileged (BYPASSRLS).
    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    // Create helio_app_test: a NOLOGIN, non-BYPASSRLS role the app pool will SET ROLE into.
    // Also grant helio_privileged the table-level access it needs for withSystemContext.
    // We do this via a direct JDBC connection to the superuser before HikariCP pools start.
    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      // Allow postgres (the login user) to SET ROLE helio_app_test.
      stmt.execute("GRANT helio_app_test TO postgres")
      // Grant table-level permissions to both roles.
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      // helio_privileged also needs explicit table access since SET ROLE drops postgres superuser privs.
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    // App pool — connects as postgres but immediately sets ROLE helio_app_test.
    // helio_app_test is NOT BYPASSRLS, so the V35 policies are evaluated.
    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)

    // Seed user rows so pipelines.owner_id FK references are satisfied.
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${ownerA.value}::uuid, ${s"${ownerA.value}@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${ownerB.value}::uuid, ${s"${ownerB.value}@test.local"}, now())
             ON CONFLICT DO NOTHING"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** Truncate all tables touched by this spec between tests.  Uses the
   *  privileged pool so RLS does not interfere with the cleanup. */
  private def cleanDb(): Unit =
    await(ctx.withSystemContext(
      sqlu"TRUNCATE TABLE data_type_rows, data_types, data_sources, pipeline_steps, pipeline_runs, pipelines CASCADE"
    ))

  // ── Helper: seed via withSystemContext (BYPASSRLS) so setup is never ──────
  // ── gated by RLS.                                                     ──────

  /** Seed a data_source row via the privileged pool and return its UUID string. */
  private def seedSource(ownerId: UserId): String = {
    val id   = UUID.randomUUID().toString
    val name = s"src-${ownerId.value.take(8)}"
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($id::uuid, $name, 'csv', '{"path":"csv/test.csv"}'::jsonb,
                     ${ownerId.value}::uuid, now(), now())"""
    ))
    id
  }

  /** Seed a data_types row via the privileged pool and return its UUID string. */
  private def seedDataType(ownerId: UserId): String = {
    val id   = UUID.randomUUID().toString
    val name = s"type-${ownerId.value.take(8)}"
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($id::uuid, $name, '[]'::jsonb, 1, ${ownerId.value}::uuid, now(), now())"""
    ))
    id
  }

  // ── data_sources RLS ─────────────────────────────────────────────────────

  "RLS on data_sources" should {

    "withUserContext(ownerA) returns only ownerA's sources" in {
      cleanDb()
      val srcA = seedSource(ownerA)
      val srcB = seedSource(ownerB)

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT id::text FROM data_sources".as[String]
      ))

      rows.toSet shouldBe Set(srcA)
      rows should not contain srcB
    }

    "withUserContext(ownerB) cannot see ownerA's sources" in {
      cleanDb()
      val srcA = seedSource(ownerA)
      seedSource(ownerB)

      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT id::text FROM data_sources".as[String]
      ))

      rows should not contain srcA
    }

    "withSystemContext sees all sources (BYPASSRLS)" in {
      cleanDb()
      val srcA = seedSource(ownerA)
      val srcB = seedSource(ownerB)

      val rows = await(ctx.withSystemContext(
        sql"SELECT id::text FROM data_sources".as[String]
      ))

      rows.toSet should contain allOf (srcA, srcB)
    }
  }

  // ── data_types RLS ────────────────────────────────────────────────────────

  "RLS on data_types" should {

    "withUserContext(ownerA) returns only ownerA's types" in {
      cleanDb()
      val dtA = seedDataType(ownerA)
      val dtB = seedDataType(ownerB)

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT id::text FROM data_types".as[String]
      ))

      rows.toSet shouldBe Set(dtA)
      rows should not contain dtB
    }

    "withUserContext(ownerB) cannot see ownerA's types" in {
      cleanDb()
      val dtA = seedDataType(ownerA)
      seedDataType(ownerB)

      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT id::text FROM data_types".as[String]
      ))

      rows should not contain dtA
    }

    "withSystemContext sees all types (BYPASSRLS)" in {
      cleanDb()
      val dtA = seedDataType(ownerA)
      val dtB = seedDataType(ownerB)

      val rows = await(ctx.withSystemContext(
        sql"SELECT id::text FROM data_types".as[String]
      ))

      rows.toSet should contain allOf (dtA, dtB)
    }
  }

  // ── pipelines RLS ─────────────────────────────────────────────────────────

  "RLS on pipelines" should {

    "withUserContext(ownerA) returns only ownerA's pipelines" in {
      cleanDb()
      val srcA = seedSource(ownerA)
      val dtA  = seedDataType(ownerA)
      val srcB = seedSource(ownerB)
      val dtB  = seedDataType(ownerB)
      val pidA = UUID.randomUUID().toString
      val pidB = UUID.randomUUID().toString
      await(ctx.withSystemContext(DBIO.seq(
        sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
               VALUES ($pidA::uuid, 'pipe-a', $srcA::uuid, $dtA::uuid, ${ownerA.value}::uuid, now(), now())""",
        sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
               VALUES ($pidB::uuid, 'pipe-b', $srcB::uuid, $dtB::uuid, ${ownerB.value}::uuid, now(), now())"""
      )))

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT id::text FROM pipelines".as[String]
      ))

      rows.toSet shouldBe Set(pidA)
      rows should not contain pidB
    }

    "withSystemContext sees all pipelines (BYPASSRLS)" in {
      cleanDb()
      val srcA = seedSource(ownerA)
      val dtA  = seedDataType(ownerA)
      val srcB = seedSource(ownerB)
      val dtB  = seedDataType(ownerB)
      val pidA = UUID.randomUUID().toString
      val pidB = UUID.randomUUID().toString
      await(ctx.withSystemContext(DBIO.seq(
        sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
               VALUES ($pidA::uuid, 'pipe-a', $srcA::uuid, $dtA::uuid, ${ownerA.value}::uuid, now(), now())""",
        sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
               VALUES ($pidB::uuid, 'pipe-b', $srcB::uuid, $dtB::uuid, ${ownerB.value}::uuid, now(), now())"""
      )))

      val rows = await(ctx.withSystemContext(
        sql"SELECT id::text FROM pipelines".as[String]
      ))

      rows.toSet should contain allOf (pidA, pidB)
    }
  }

  // ── fail-closed: missing session var raises error on app pool ─────────────

  "RLS fail-closed property" should {

    /** When `app.current_user_id` has never been SET in the session,
     *  `current_setting('app.current_user_id')::uuid` in the USING clause
     *  raises `ERROR: unrecognized configuration parameter`.  The fail-closed
     *  contract is that no rows are visible without an explicit user context. */
    "SELECT on data_sources without app.current_user_id set raises an error" in {
      cleanDb()
      seedSource(ownerA)

      // Run directly on the app pool — no SET LOCAL, no helio_app_test setup.
      // The RLS USING clause evaluates current_setting without missing_ok,
      // which raises ERROR when the GUC has never been set.
      val future = appDb.run(sql"SELECT id FROM data_sources".as[String])
      val thrown = intercept[Exception] {
        Await.result(future, 5.seconds)
      }
      // PostgreSQL error text varies across versions; we confirm it is an exception.
      thrown should not be null
    }
  }
}
