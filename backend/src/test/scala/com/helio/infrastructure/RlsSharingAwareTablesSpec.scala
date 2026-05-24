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

/** Integration test proving that V36 RLS policies enforce the sharing-aware
 *  access model on dashboards, panels, and resource_permissions.
 *
 *  Strategy
 *  --------
 *  Follows the pattern established by RlsOwnerTablesSpec (V35):
 *  EmbeddedPostgres starts as postgres superuser. A non-superuser
 *  `helio_app_test` role is created; the app pool connects as postgres and
 *  immediately sets ROLE helio_app_test (non-BYPASSRLS). The privileged pool
 *  stays on postgres superuser and sets ROLE helio_privileged (BYPASSRLS).
 *
 *  Test invariants
 *  ---------------
 *  dashboards / panels:
 *  - withUserContext(ownerA) sees only ownerA's rows.
 *  - withUserContext(ownerB) cannot see ownerA's rows (no grant).
 *  - withUserContext(granteeUser) sees rows for which a grant exists.
 *  - Anonymous (no SET LOCAL) sees only rows with a public-viewer grant.
 *  - withSystemContext (BYPASSRLS) sees all rows.
 *
 *  resource_permissions:
 *  - withUserContext(ownerA) sees all grants for ownerA's dashboards.
 *  - withUserContext(granteeUser) sees only their own grant rows.
 *  - withUserContext(unrelated) sees zero rows.
 *  - withSystemContext sees all grant rows.
 */
class RlsSharingAwareTablesSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb:        JdbcBackend.Database = _
  private var ctx: DbContext = _

  /** ownerA owns the shared dashboard; ownerB is unrelated; granteeUser receives grants. */
  private val ownerA    = UserId(UUID.randomUUID().toString)
  private val ownerB    = UserId(UUID.randomUUID().toString)
  private val granteeUser = UserId(UUID.randomUUID().toString)

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

    // Create helio_app_test non-BYPASSRLS role and grant table permissions.
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
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_app_test")
      // helio_privileged also needs explicit table access (SET ROLE drops superuser privs).
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    // App pool — connects as postgres but immediately sets ROLE helio_app_test.
    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)

    // Seed users — required for dashboard.owner_id FK.
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${ownerA.value}::uuid, ${s"${ownerA.value}@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${ownerB.value}::uuid, ${s"${ownerB.value}@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${granteeUser.value}::uuid, ${s"${granteeUser.value}@test.local"}, now())
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

  /** Truncate all tables touched by this spec. Uses the privileged pool so RLS
   *  does not interfere with cleanup. Cascade covers panels and resource_permissions. */
  private def cleanDb(): Unit =
    await(ctx.withSystemContext(
      sqlu"TRUNCATE TABLE resource_permissions, panels, dashboards CASCADE"
    ))

  // ── Seed helpers — always via withSystemContext so setup is never gated by RLS.

  private def seedDashboard(ownerId: UserId): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'dash', ${ownerId.value}, now(), now(),
                    '{"background":"transparent","gridBackground":"transparent"}'::jsonb,
                    '{"lg":[],"md":[],"sm":[],"xs":[]}'::jsonb,
                    ${ownerId.value}::uuid)"""
    ))
    id
  }

  private def seedPanel(dashId: String, ownerId: UserId): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, owner_id)
             VALUES ($id, $dashId, 'panel', ${ownerId.value}, now(), now(),
                    '{"background":"transparent","color":"inherit","transparency":0.0}'::jsonb,
                    'metric', ${ownerId.value}::uuid)"""
    ))
    id
  }

  private def grantRole(dashId: String, granteeId: UserId, role: String): Unit =
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', $dashId, ${granteeId.value}::uuid, $role, now())
             ON CONFLICT (resource_type, resource_id, grantee_id) DO UPDATE SET role = EXCLUDED.role"""
    ))

  private def grantPublicViewer(dashId: String): Unit =
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', $dashId, NULL, 'viewer', now())
             ON CONFLICT DO NOTHING"""
    ))

  // ── dashboards RLS ────────────────────────────────────────────────────────

  "RLS on dashboards" should {

    "withUserContext(ownerA) returns only ownerA's dashboards" in {
      cleanDb()
      val dashA = seedDashboard(ownerA)
      seedDashboard(ownerB)

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT id FROM dashboards".as[String]
      ))

      rows.toSet shouldBe Set(dashA)
    }

    "withUserContext(ownerB) cannot see ownerA's dashboards (no grant)" in {
      cleanDb()
      val dashA = seedDashboard(ownerA)
      seedDashboard(ownerB)

      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT id FROM dashboards".as[String]
      ))

      rows should not contain dashA
    }

    "withUserContext(grantee) sees dashboards for which a viewer grant exists" in {
      cleanDb()
      val dashA = seedDashboard(ownerA)
      grantRole(dashA, granteeUser, "viewer")
      seedDashboard(ownerB) // no grant for granteeUser

      val rows = await(ctx.withUserContext(granteeUser.value)(
        sql"SELECT id FROM dashboards".as[String]
      ))

      rows.toSet shouldBe Set(dashA)
    }

    "withUserContext(grantee) sees dashboards for which an editor grant exists" in {
      cleanDb()
      val dashA = seedDashboard(ownerA)
      grantRole(dashA, granteeUser, "editor")

      val rows = await(ctx.withUserContext(granteeUser.value)(
        sql"SELECT id FROM dashboards".as[String]
      ))

      rows should contain(dashA)
    }

    "anonymous (no SET LOCAL) sees only dashboards with public-viewer grant" in {
      cleanDb()
      val dashA = seedDashboard(ownerA)
      val dashB = seedDashboard(ownerA)
      grantPublicViewer(dashA)
      // dashB has no public grant

      // Run directly on appDb with no session variable set — simulates anonymous path.
      // The SECURITY DEFINER function returns true when grantee_id IS NULL and role = 'viewer'.
      val rows = Await.result(
        appDb.run(sql"SELECT id FROM dashboards".as[String]),
        5.seconds
      )

      rows should contain(dashA)
      rows should not contain dashB
    }

    "withSystemContext sees all dashboards (BYPASSRLS)" in {
      cleanDb()
      val dashA = seedDashboard(ownerA)
      val dashB = seedDashboard(ownerB)

      val rows = await(ctx.withSystemContext(
        sql"SELECT id FROM dashboards".as[String]
      ))

      rows.toSet should contain allOf (dashA, dashB)
    }
  }

  // ── panels RLS ────────────────────────────────────────────────────────────

  "RLS on panels" should {

    "withUserContext(ownerA) returns only ownerA's panels" in {
      cleanDb()
      val dashA  = seedDashboard(ownerA)
      val panelA = seedPanel(dashA, ownerA)
      val dashB  = seedDashboard(ownerB)
      seedPanel(dashB, ownerB)

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT id FROM panels".as[String]
      ))

      rows.toSet shouldBe Set(panelA)
    }

    "withUserContext(ownerB) cannot see ownerA's panels (no grant)" in {
      cleanDb()
      val dashA  = seedDashboard(ownerA)
      val panelA = seedPanel(dashA, ownerA)
      seedDashboard(ownerB)

      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT id FROM panels".as[String]
      ))

      rows should not contain panelA
    }

    "withUserContext(grantee) sees panels on the shared dashboard" in {
      cleanDb()
      val dashA  = seedDashboard(ownerA)
      val panelA = seedPanel(dashA, ownerA)
      grantRole(dashA, granteeUser, "viewer")

      val rows = await(ctx.withUserContext(granteeUser.value)(
        sql"SELECT id FROM panels".as[String]
      ))

      rows should contain(panelA)
    }

    "withUserContext(grantee) does NOT see panels on a dashboard without a grant" in {
      cleanDb()
      val dashA  = seedDashboard(ownerA)
      val panelA = seedPanel(dashA, ownerA)
      // granteeUser has no grant on dashA

      val rows = await(ctx.withUserContext(granteeUser.value)(
        sql"SELECT id FROM panels".as[String]
      ))

      rows should not contain panelA
    }

    "withSystemContext sees all panels (BYPASSRLS)" in {
      cleanDb()
      val dashA  = seedDashboard(ownerA)
      val panelA = seedPanel(dashA, ownerA)
      val dashB  = seedDashboard(ownerB)
      val panelB = seedPanel(dashB, ownerB)

      val rows = await(ctx.withSystemContext(
        sql"SELECT id FROM panels".as[String]
      ))

      rows.toSet should contain allOf (panelA, panelB)
    }
  }

  // ── resource_permissions RLS ──────────────────────────────────────────────

  "RLS on resource_permissions" should {

    "withUserContext(ownerA) sees all grant rows for ownerA's dashboard" in {
      cleanDb()
      val dashA = seedDashboard(ownerA)
      grantRole(dashA, granteeUser, "viewer")

      val rows = await(ctx.withUserContext(ownerA.value)(
        sql"SELECT resource_id FROM resource_permissions".as[String]
      ))

      rows should contain(dashA)
    }

    "withUserContext(grantee) sees only their own grant row" in {
      cleanDb()
      val dashA = seedDashboard(ownerA)
      grantRole(dashA, granteeUser, "viewer")
      // Also add a second grantee to confirm granteeUser only sees their own row.
      grantRole(dashA, ownerB, "editor")

      val rows = await(ctx.withUserContext(granteeUser.value)(
        sql"""SELECT grantee_id::text FROM resource_permissions
              WHERE grantee_id IS NOT NULL""".as[String]
      ))

      rows.toSet shouldBe Set(granteeUser.value)
      rows should not contain ownerB.value
    }

    "withUserContext(unrelated) sees zero resource_permissions rows" in {
      cleanDb()
      val dashA = seedDashboard(ownerA)
      grantRole(dashA, granteeUser, "viewer")

      // ownerB is neither the owner of dashA nor a grantee.
      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT resource_id FROM resource_permissions".as[String]
      ))

      rows shouldBe empty
    }

    "withSystemContext sees all resource_permissions rows (BYPASSRLS)" in {
      cleanDb()
      val dashA = seedDashboard(ownerA)
      grantRole(dashA, granteeUser, "viewer")
      val dashB = seedDashboard(ownerB)
      grantRole(dashB, granteeUser, "editor")

      val rows = await(ctx.withSystemContext(
        sql"SELECT resource_id FROM resource_permissions".as[String]
      ))

      rows.toSet should contain allOf (dashA, dashB)
    }

    "grant rows for ownerA's dashboard are not visible to ownerB" in {
      cleanDb()
      val dashA = seedDashboard(ownerA)
      grantRole(dashA, granteeUser, "viewer")
      // ownerB owns their own dashboard.
      seedDashboard(ownerB)

      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT resource_id FROM resource_permissions".as[String]
      ))

      rows should not contain dashA
    }
  }
}
