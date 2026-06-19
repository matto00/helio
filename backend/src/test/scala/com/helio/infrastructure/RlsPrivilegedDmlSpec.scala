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

/** Integration test that exercises the **real two-role topology** for
 *  `DbContext`:
 *
 *  - **App pool**: postgres login, immediately `SET ROLE helio_app_test`
 *    (non-superuser, NOT BYPASSRLS). RLS policies are evaluated.
 *  - **Privileged pool**: postgres login, immediately `SET ROLE helio_privileged`
 *    (BYPASSRLS). RLS policies are skipped.
 *
 *  This mirrors production more faithfully than the existing `DbContextSpec`
 *  (where the app pool shares the same raw superuser datasource and bypasses
 *  RLS implicitly). Neither pool here is a superuser on the connection it runs
 *  queries on, which means:
 *
 *  1. Missing table-level GRANTs on `helio_privileged` are immediately visible
 *     (the V38 regression class is covered).
 *  2. `withUserContext` row-filtering is real — the app pool runs as a
 *     non-BYPASSRLS role.
 *
 *  Acceptance criteria from HEL-285:
 *  - `withSystemContext SELECT current_role` returns `helio_privileged`.
 *  - `withSystemContext` can INSERT on every one of the nine ACL'd tables.
 *  - `withSystemContext` can UPDATE and DELETE on representative tables.
 *  - `withUserContext(ownerA)` sees only ownerA's rows (RLS-filtered).
 */
class RlsPrivilegedDmlSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database = _
  private var ctx: DbContext = _

  private val ownerA = UserId(UUID.randomUUID().toString)
  private val ownerB = UserId(UUID.randomUUID().toString)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    // Run Flyway as postgres superuser — creates helio_privileged (V34),
    // RLS policies (V35/V36), indexes (V37), and table-level GRANTs (V38).
    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway
      .configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

    // Create helio_app_test (non-superuser, non-BYPASSRLS) and grant permissions.
    // Also ensure helio_privileged has the table-level grants it needs
    // (V38 already ran them, but we re-grant idempotently for safety).
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
      // App role table permissions.
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_app_test")
      // helio_privileged's table/sequence DML grants come from Flyway V38 — do NOT
      // re-grant here so that a missing V38 causes permission denied, not a silent pass.
      // The function EXECUTE grant is not covered by V38, so we must establish it here.
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    // Privileged pool: postgres login → SET ROLE helio_privileged (BYPASSRLS).
    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    // App pool: postgres login → SET ROLE helio_app_test (non-BYPASSRLS).
    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)

    // Seed user rows (FK prerequisite for owner_id columns).
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

  /** Delete all rows from ACL'd tables via the privileged pool.
   *  Uses DELETE (not TRUNCATE) because V38 grants DELETE but not TRUNCATE to
   *  helio_privileged, so TRUNCATE would fail the very privilege-regression check
   *  this spec exists to enforce.
   */
  private def cleanDb(): Unit = {
    // Delete in dependency order to satisfy foreign-key constraints.
    val tables = Seq(
      "resource_permissions",
      "panels",
      "pipeline_steps",
      "pipeline_runs",
      "pipelines",
      "data_type_rows",
      "dashboards",
      "data_types",
      "data_sources"
    )
    await(ctx.withSystemContext(
      DBIO.sequence(tables.map(t => sqlu"DELETE FROM #$t"))
    ))
  }

  // ── 1.5: current_role sanity check ───────────────────────────────────────

  "withSystemContext" should {

    "return helio_privileged as the active role (privileged pool sanity check)" in {
      val role = await(ctx.withSystemContext(
        sql"SELECT current_role".as[String].head
      ))
      role shouldBe "helio_privileged"
    }
  }

  // ── 1.2 / 1.3 / 1.4: INSERT, UPDATE, DELETE on all nine ACL'd tables ────

  "withSystemContext DML on data_sources" should {

    "INSERT a row" in {
      cleanDb()
      val id = UUID.randomUUID().toString
      noException should be thrownBy await(ctx.withSystemContext(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($id::uuid, 'src-a', 'csv', '{"path":"csv/test.csv"}'::jsonb,
                       ${ownerA.value}::uuid, now(), now())"""
      ))
    }

    "UPDATE a field on an inserted row" in {
      cleanDb()
      val id = UUID.randomUUID().toString
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($id::uuid, 'src-before', 'csv', '{"path":"csv/test.csv"}'::jsonb,
                       ${ownerA.value}::uuid, now(), now())"""
      ))
      val affected = await(ctx.withSystemContext(
        sqlu"UPDATE data_sources SET name = 'src-after' WHERE id = $id"
      ))
      affected shouldBe 1
    }

    "DELETE an inserted row" in {
      cleanDb()
      val id = UUID.randomUUID().toString
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($id::uuid, 'src-del', 'csv', '{"path":"csv/test.csv"}'::jsonb,
                       ${ownerA.value}::uuid, now(), now())"""
      ))
      val affected = await(ctx.withSystemContext(
        sqlu"DELETE FROM data_sources WHERE id = $id"
      ))
      affected shouldBe 1
    }
  }

  "withSystemContext DML on data_types" should {

    "INSERT a row" in {
      cleanDb()
      val id = UUID.randomUUID().toString
      noException should be thrownBy await(ctx.withSystemContext(
        sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($id::uuid, 'dt-a', '[]'::jsonb, 1, ${ownerA.value}::uuid, now(), now())"""
      ))
    }
  }

  "withSystemContext DML on pipelines" should {

    "INSERT a row" in {
      cleanDb()
      val srcId = UUID.randomUUID().toString
      val dtId  = UUID.randomUUID().toString
      val pipId = UUID.randomUUID().toString
      await(ctx.withSystemContext(DBIO.seq(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($srcId::uuid, 'src-pipe', 'csv', '{"path":"csv/test.csv"}'::jsonb,
                       ${ownerA.value}::uuid, now(), now())""",
        sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId::uuid, 'dt-pipe', '[]'::jsonb, 1, ${ownerA.value}::uuid, now(), now())"""
      )))
      noException should be thrownBy await(ctx.withSystemContext(
        sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
               VALUES ($pipId, 'pipe-a', $srcId, $dtId, ${ownerA.value}::uuid, now(), now())"""
      ))
    }
  }

  "withSystemContext DML on pipeline_steps" should {

    "INSERT a row" in {
      cleanDb()
      val srcId  = UUID.randomUUID().toString
      val dtId   = UUID.randomUUID().toString
      val pipId  = UUID.randomUUID().toString
      val stepId = UUID.randomUUID().toString
      await(ctx.withSystemContext(DBIO.seq(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($srcId::uuid, 'src-steps', 'csv', '{"path":"csv/test.csv"}'::jsonb,
                       ${ownerA.value}::uuid, now(), now())""",
        sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId::uuid, 'dt-steps', '[]'::jsonb, 1, ${ownerA.value}::uuid, now(), now())""",
        sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
               VALUES ($pipId, 'pipe-steps', $srcId, $dtId, ${ownerA.value}::uuid, now(), now())"""
      )))
      noException should be thrownBy await(ctx.withSystemContext(
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at)
               VALUES ($stepId, $pipId, 1, 'rename', '{}', now(), now())"""
      ))
    }
  }

  "withSystemContext DML on pipeline_runs" should {

    "INSERT a row" in {
      cleanDb()
      val srcId = UUID.randomUUID().toString
      val dtId  = UUID.randomUUID().toString
      val pipId = UUID.randomUUID().toString
      val runId = UUID.randomUUID().toString
      await(ctx.withSystemContext(DBIO.seq(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($srcId::uuid, 'src-runs', 'csv', '{"path":"csv/test.csv"}'::jsonb,
                       ${ownerA.value}::uuid, now(), now())""",
        sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId::uuid, 'dt-runs', '[]'::jsonb, 1, ${ownerA.value}::uuid, now(), now())""",
        sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
               VALUES ($pipId, 'pipe-runs', $srcId, $dtId, ${ownerA.value}::uuid, now(), now())"""
      )))
      noException should be thrownBy await(ctx.withSystemContext(
        sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at)
               VALUES ($runId, $pipId, 'running', now())"""
      ))
    }
  }

  "withSystemContext DML on data_type_rows" should {

    "INSERT a row" in {
      cleanDb()
      val dtId = UUID.randomUUID().toString
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId::uuid, 'dt-rows', '[]'::jsonb, 1, ${ownerA.value}::uuid, now(), now())"""
      ))
      noException should be thrownBy await(ctx.withSystemContext(
        sqlu"""INSERT INTO data_type_rows (data_type_id, row_index, data)
               VALUES ($dtId, 0, '{"key":"value"}'::jsonb)"""
      ))
    }
  }

  "withSystemContext DML on dashboards" should {

    "INSERT a row" in {
      cleanDb()
      val id = UUID.randomUUID().toString
      noException should be thrownBy await(ctx.withSystemContext(
        sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($id, 'dash-a', ${ownerA.value}, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}'::jsonb,
                       '{"lg":[],"md":[],"sm":[],"xs":[]}'::jsonb,
                       ${ownerA.value}::uuid)"""
      ))
    }

    "UPDATE a field on an inserted row" in {
      cleanDb()
      val id = UUID.randomUUID().toString
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($id, 'dash-before', ${ownerA.value}, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}'::jsonb,
                       '{"lg":[],"md":[],"sm":[],"xs":[]}'::jsonb,
                       ${ownerA.value}::uuid)"""
      ))
      val affected = await(ctx.withSystemContext(
        sqlu"UPDATE dashboards SET name = 'dash-after' WHERE id = $id"
      ))
      affected shouldBe 1
    }

    "DELETE an inserted row" in {
      cleanDb()
      val id = UUID.randomUUID().toString
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($id, 'dash-del', ${ownerA.value}, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}'::jsonb,
                       '{"lg":[],"md":[],"sm":[],"xs":[]}'::jsonb,
                       ${ownerA.value}::uuid)"""
      ))
      val affected = await(ctx.withSystemContext(
        sqlu"DELETE FROM dashboards WHERE id = $id"
      ))
      affected shouldBe 1
    }
  }

  "withSystemContext DML on panels" should {

    "INSERT a row" in {
      cleanDb()
      val dashId  = UUID.randomUUID().toString
      val panelId = UUID.randomUUID().toString
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($dashId, 'dash-panel', ${ownerA.value}, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}'::jsonb,
                       '{"lg":[],"md":[],"sm":[],"xs":[]}'::jsonb,
                       ${ownerA.value}::uuid)"""
      ))
      noException should be thrownBy await(ctx.withSystemContext(
        sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, owner_id)
               VALUES ($panelId, $dashId, 'panel-a', ${ownerA.value}, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}'::jsonb,
                       'metric', ${ownerA.value}::uuid)"""
      ))
    }
  }

  "withSystemContext DML on resource_permissions" should {

    "INSERT a row" in {
      cleanDb()
      val dashId = UUID.randomUUID().toString
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($dashId, 'dash-perm', ${ownerA.value}, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}'::jsonb,
                       '{"lg":[],"md":[],"sm":[],"xs":[]}'::jsonb,
                       ${ownerA.value}::uuid)"""
      ))
      noException should be thrownBy await(ctx.withSystemContext(
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('dashboard', $dashId, ${ownerB.value}::uuid, 'viewer', now())"""
      ))
    }
  }

  // ── 1.6: withUserContext RLS-filtered spot-check ──────────────────────────

  "withUserContext on the non-superuser app pool" should {

    "return only ownerA's data_sources row and not ownerB's" in {
      cleanDb()

      // Seed rows for both owners via the privileged pool (bypasses RLS).
      val srcA = UUID.randomUUID().toString
      val srcB = UUID.randomUUID().toString
      await(ctx.withSystemContext(DBIO.seq(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($srcA::uuid, 'src-owner-a', 'csv', '{"path":"csv/a.csv"}'::jsonb,
                       ${ownerA.value}::uuid, now(), now())""",
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($srcB::uuid, 'src-owner-b', 'csv', '{"path":"csv/b.csv"}'::jsonb,
                       ${ownerB.value}::uuid, now(), now())"""
      )))

      // ownerA's context sees only srcA.
      val rowsA = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT id::text FROM data_sources".as[String]
      ))
      rowsA.toSet shouldBe Set(srcA)
      rowsA should not contain srcB

      // ownerB's context sees only srcB.
      val rowsB = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT id::text FROM data_sources".as[String]
      ))
      rowsB.toSet shouldBe Set(srcB)
      rowsB should not contain srcA
    }
  }
}
