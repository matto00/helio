package com.helio.infrastructure.persistence.telemetry

import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.telemetry.AdminUsageService
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.time.LocalDate
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1211 task 1.6 (design.md Decision 2): proves the owner-usage read path under a
 *  NON-BYPASSRLS, non-superuser privileged role holding only V113's explicit GRANT -- the shape
 *  production's `helio_privileged` access path depends on, never masked by a superuser. Flyway and
 *  the app pool connect as a non-superuser table owner (recipe from `FlywayNonSuperuserMigrationSpec`);
 *  the privileged pool `SET ROLE`s `helio_privileged`, created here with `NOBYPASSRLS` so the
 *  grant is the only thing that can let a read through. Rollup rows are inserted directly because
 *  this spec proves access, not numbers (the numbers live in `AdminUsageServiceSpec`). */
class ProductUsageRepositoryRoleSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var pg: EmbeddedPostgres         = _
  private var ownerDb: JdbcBackend.Database = _
  private var privDb: JdbcBackend.Database  = _
  private var ctx: DbContext                = _

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  override def beforeAll(): Unit = {
    super.beforeAll()
    pg = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val su = pg.getPostgresDatabase.getConnection
    try {
      val st = su.createStatement()
      st.execute("CREATE ROLE helio_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      st.execute("ALTER SCHEMA public OWNER TO helio_migration_test")
      // Created BYPASSRLS because earlier migrations (V41...) rely on it, exactly like production;
      // flipped to NOBYPASSRLS right after the chain has migrated (below).
      st.execute("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      st.execute("GRANT helio_privileged TO helio_migration_test WITH ADMIN OPTION")
      st.close()
    } finally su.close()
    val url = pg.getJdbcUrl("helio_migration_test", "postgres")
    Flyway.configure().dataSource(url, "helio_migration_test", "test").locations("classpath:db/migration").load().migrate()
    val su2 = pg.getPostgresDatabase.getConnection
    try {
      // The point of this spec: from here on RLS and grants both apply to helio_privileged in full.
      su2.createStatement().execute("ALTER ROLE helio_privileged NOBYPASSRLS")
    } finally su2.close()
    def pool(initSql: Option[String]): JdbcBackend.Database = {
      val cfg = new HikariConfig()
      cfg.setJdbcUrl(url + "&stringtype=unspecified")
      cfg.setUsername("helio_migration_test")
      cfg.setPassword("test")
      cfg.setMaximumPoolSize(3)
      initSql.foreach(cfg.setConnectionInitSql)
      JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(3))
    }
    ownerDb = pool(None)
    privDb  = pool(Some("SET ROLE helio_privileged"))
    ctx     = new DbContext(ownerDb, privDb)
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"UPDATE product_rollup_state SET rolled_through = DATE '2026-04-13' WHERE id = 1",
      sqlu"INSERT INTO product_event_daily (day, event, event_count, active_users) VALUES (DATE '2026-04-12', 'signup_completed', 4, 4)",
      sqlu"INSERT INTO product_active_users_daily (day, daily_active_users, weekly_active_users) VALUES (DATE '2026-04-12', 5, NULL)",
      sqlu"INSERT INTO product_ttfd_daily (day, sample_count, median_seconds, p90_seconds, histogram) VALUES (DATE '2026-04-12', 3, 60, 120, '{}'::jsonb)",
      sqlu"INSERT INTO product_event_property_daily (day, event, property_key, property_value, event_count) VALUES (DATE '2026-04-12', 'firstrun_template_chosen', 'template', 'streamer', 2)"
    )))
  }

  override def afterAll(): Unit = {
    ownerDb.close()
    privDb.close()
    pg.close()
    super.afterAll()
  }

  private val repo    = () => new ProductUsageRepository(ctx)
  private val service = () => new AdminUsageService(repo(), new Clock { def now(): Instant = Instant.parse("2026-04-14T00:00:00Z") })

  "the usage read path" should {

    "run as a non-superuser, NOBYPASSRLS role" in {
      val (isSuper, bypass, who) = await(ctx.withSystemContext(
        sql"SELECT rolsuper, rolbypassrls, current_user FROM pg_roles WHERE rolname = current_user".as[(Boolean, Boolean, String)].head
      ))
      (isSuper, bypass, who) shouldBe ((false, false, "helio_privileged"))
    }

    "be unable to read per-user product_events (the role has no RLS bypass, so the usage page never could scan it)" in {
      an[Exception] should be thrownBy await(ctx.withSystemContext(sql"SELECT COUNT(*) FROM product_events".as[Int].head))
    }

    "read every rollup table through the V113 GRANT alone" in {
      val r = await(service().usage(Some("3"))).toOption.get
      r.rolledThrough shouldBe Some("2026-04-13")
      r.signupsPerDay.map(_.count) shouldBe Seq(0L, 4L, 0L)
      r.activeUsers.map(a => (a.dailyActiveUsers, a.weeklyActiveUsers)) shouldBe Seq((0L, None), (5L, None), (0L, None))
      r.ttfd.latest.map(d => (d.sampleCount, d.medianSeconds, d.p90Seconds)) shouldBe Some((3, Some(60.0), Some(120.0)))
      r.templateChoices.map(t => t.template -> t.count) shouldBe Seq("streamer" -> 2L)
    }

    "fail once the GRANT is revoked (the grant is the access path, not a superuser/RLS accident)" in {
      await(ownerDb.run(sqlu"REVOKE SELECT ON product_event_daily FROM helio_privileged"))
      try an[Exception] should be thrownBy await(repo().eventDaily(LocalDate.parse("2026-04-12"), LocalDate.parse("2026-04-12"), Seq("signup_completed")))
      finally await(ownerDb.run(sqlu"GRANT SELECT ON product_event_daily TO helio_privileged"))
      await(repo().eventDaily(LocalDate.parse("2026-04-12"), LocalDate.parse("2026-04-12"), Seq("signup_completed"))).size shouldBe 1
    }
  }
}
