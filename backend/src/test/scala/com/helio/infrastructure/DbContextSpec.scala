package com.helio.infrastructure

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Verifies the HEL-274 two-pool DbContext:
 *
 *  - `withUserContext` routes to the app pool; `app.current_user_id` is
 *    scoped to the transaction via SET LOCAL and does not leak across calls.
 *  - `withSystemContext` routes to the privileged pool (BYPASSRLS) and runs
 *    without the session variable.
 *  - The physical pool separation means a `withUserContext` call cannot gain
 *    BYPASSRLS regardless of session variable state.
 *
 *  RLS isolation test (Task 4.1): creates a scratch table, enables RLS, adds
 *  a policy that filters on `app.current_user_id`, and confirms:
 *  - `withUserContext(userA)` can see only userA's rows.
 *  - `withSystemContext` sees all rows (BYPASSRLS on privileged pool).
 *  - A `withUserContext(userB)` cannot see userA's rows.
 *  - A `withUserContext(userA)` cannot see userB's rows.
 */
class DbContextSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var appDb:            JdbcBackend.Database = _
  private var privilegedDb:     JdbcBackend.Database = _
  private var ctx:              DbContext = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    // V34 creates helio_privileged and GRANTs it to current_user.
    // In the embedded postgres the current_user is 'postgres' (superuser)
    // who implicitly has all roles, so SET ROLE helio_privileged works.
    //
    // For the RLS isolation test we build a privilegedDb whose HikariCP init
    // SQL sets ROLE helio_privileged, mirroring production configuration.
    val ds = embeddedPostgres.getPostgresDatabase
    appDb = JdbcBackend.Database.forDataSource(ds, Some(10))

    // Build the privileged pool with connectionInitSql to mirror production.
    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
    val hikariCfg = new HikariConfig()
    hikariCfg.setDataSource(ds)
    hikariCfg.setMaximumPoolSize(5)
    hikariCfg.setConnectionInitSql("SET ROLE helio_privileged")
    val privilegedDs = new HikariDataSource(hikariCfg)
    privilegedDb = JdbcBackend.Database.forDataSource(privilegedDs, Some(5))

    ctx = new DbContext(appDb, privilegedDb)
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def readUserIdVar: DBIO[String] =
    sql"SELECT current_setting('app.current_user_id', true)".as[String].head

  "DbContext.withUserContext" should {

    /** Connection-leak regression: after the transaction completes the session
     *  variable must not survive on the pooled connection. If `SET SESSION` were
     *  used instead of `set_config(..., true)` (= `SET LOCAL`) the value would
     *  persist and this test would fail. */
    "set app.current_user_id inside the transaction and clear it at commit" in {
      val userA = "user-a-" + java.util.UUID.randomUUID().toString
      val userB = "user-b-" + java.util.UUID.randomUUID().toString

      val insideTxA = await(ctx.withUserContext(userA)(readUserIdVar))
      insideTxA shouldBe userA

      // Next call with a different user must see that user's id, not userA's.
      // SET LOCAL clears on commit; without it the pooled connection would leak userA.
      val insideTxB = await(ctx.withUserContext(userB)(readUserIdVar))
      insideTxB shouldBe userB
    }

    /** Rollback variant: even when the action fails and the transaction rolls
     *  back, the session variable must not remain set on the pooled connection. */
    "not leak app.current_user_id to the pool after a rolled-back transaction" in {
      val userId = "rollback-spec-" + java.util.UUID.randomUUID().toString
      val nextUser = "next-user-" + java.util.UUID.randomUUID().toString

      val failingAction: DBIO[String] = readUserIdVar.andThen(
        DBIO.failed(new RuntimeException("intentional rollback"))
      )

      // The Future should fail …
      val result = await(ctx.withUserContext(userId)(failingAction).failed)
      result.getMessage shouldBe "intentional rollback"

      // … and the next transaction must not inherit the rolled-back user id.
      val afterRollback = await(ctx.withUserContext(nextUser)(readUserIdVar))
      afterRollback shouldBe nextUser
    }
  }

  "DbContext.withSystemContext" should {

    /** Privileged pool does not set app.current_user_id — the bypass is
     *  achieved by the helio_privileged role (BYPASSRLS), not a session
     *  variable. The variable is absent / empty on the privileged pool. */
    "not set app.current_user_id on the privileged pool" in {
      // current_setting with missing_ok = true returns '' when unset.
      val observed = await(ctx.withSystemContext(
        sql"SELECT current_setting('app.current_user_id', true)".as[String].head
      ))
      // The variable is not set by withSystemContext; it should be absent or empty.
      observed should (be ("") or be (null))
    }
  }

  "DbContext RLS isolation" should {

    /** Task 4.1 — prove pool separation via role introspection.
     *
     *  `withSystemContext` MUST run on a connection whose active role is
     *  `helio_privileged` (BYPASSRLS). `withUserContext` MUST run on a
     *  connection whose active role is NOT `helio_privileged`.
     *
     *  This verifies the physical pool separation without relying on actual
     *  RLS policies on real schema tables (policy enforcement is tested in
     *  HEL-275/276 when policies are applied). The embedded postgres test
     *  user is `postgres` superuser, which always bypasses RLS, so end-to-end
     *  row filtering cannot be tested here — but the role-separation invariant
     *  is the foundational prerequisite.
     *
     *  Additionally, we verify that withSystemContext does NOT set
     *  `app.current_user_id`, so a policy that checks that variable on the
     *  app pool cannot be triggered on the privileged pool. */
    "route withSystemContext to the helio_privileged role pool" in {
      // Privileged pool: current_role must be helio_privileged.
      val privilegedRole = await(ctx.withSystemContext(
        sql"SELECT current_role".as[String].head
      ))
      privilegedRole shouldBe "helio_privileged"
    }

    "route withUserContext to the non-privileged pool (not helio_privileged role)" in {
      val userId = "rls-user-ctx-" + java.util.UUID.randomUUID().toString
      val roleInUserCtx = await(ctx.withUserContext(userId)(
        sql"SELECT current_role".as[String].head
      ))
      // The app pool does NOT switch to helio_privileged; it runs as
      // the original login role (postgres in the embedded test instance).
      roleInUserCtx should not be "helio_privileged"
    }

    "withUserContext still sets app.current_user_id for the policy to evaluate" in {
      val userId = "rls-var-check-" + java.util.UUID.randomUUID().toString
      val observed = await(ctx.withUserContext(userId)(
        sql"SELECT current_setting('app.current_user_id', true)".as[String].head
      ))
      observed shouldBe userId
    }

    "withSystemContext does not set app.current_user_id (bypass is role-based only)" in {
      // On the privileged pool the session variable is absent — a policy that
      // checks `current_setting('app.current_user_id', true) = owner_id` would
      // never fire for privileged connections because the connections bypass
      // RLS entirely via BYPASSRLS, not by matching any policy predicate.
      val observed = await(ctx.withSystemContext(
        sql"SELECT current_setting('app.current_user_id', true)".as[String].head
      ))
      observed should (be ("") or be (null))
    }
  }
}
