package com.helio.infrastructure.persistence.sharing

import com.helio.domain.model.{DashboardId, ShareToken, ShareTokenId, UserId}
import com.helio.infrastructure.persistence.DbContext
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-590 task 6.7: `share_tokens` RLS (V101's owner-only policy), proven under a REAL
 *  non-bypassing role -- never `new DbContext(db, db)`, which would hand the same superuser
 *  connection to both slots and pass vacuously (ticket's own RLS/superuser-masking trap, and the
 *  cause of the v0.7.x prod incident, HEL-974). Uses the same two-role (`helio_app_test`
 *  non-BYPASSRLS + `helio_privileged` BYPASSRLS) topology as `ConnectorCredentialRepositorySpec`/
 *  `RlsOwnerTablesSpec`, including a fixture-liveness assertion so a misconfigured fixture fails
 *  loudly instead of passing on an empty result. */
class ShareTokenRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb:        JdbcBackend.Database = _
  private var ctx: DbContext = _
  private var repo: ShareTokenRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway
      .configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

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
      stmt.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx  = new DbContext(appDb, privilegedDb)
    repo = new ShareTokenRepository(ctx)
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def freshUser(): UserId = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES ($id::uuid, ${s"$id@test.local"}, now())
             ON CONFLICT DO NOTHING"""
    ))
    UserId(id)
  }

  private def freshDashboard(owner: UserId): DashboardId = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'RLS Test Dashboard', ${owner.value}, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${owner.value}::uuid)"""
    ))
    DashboardId(id)
  }

  private def freshToken(owner: UserId, dashboardId: DashboardId): ShareToken =
    await(repo.insert(
      ShareToken(
        id          = ShareTokenId(UUID.randomUUID().toString),
        dashboardId = dashboardId,
        userId      = owner,
        tokenHash   = UUID.randomUUID().toString,
        expiresAt   = None,
        revokedAt   = None,
        createdAt   = Instant.now()
      )
    ))

  "RLS on share_tokens" should {

    "fixture liveness: the app pool positively reads a token under its OWNER's own session context" in {
      val owner = freshUser()
      val token = freshToken(owner, freshDashboard(owner))

      val rows = await(ctx.withUserContext(owner.value)(
        sql"SELECT id FROM share_tokens WHERE id = ${token.id.value}::uuid".as[String]
      ))

      // Positive liveness check FIRST -- an empty result here would make the negative assertion
      // below pass vacuously for the wrong reason (e.g. a broken SET LOCAL, not real RLS).
      rows should contain(token.id.value)
    }

    "denies cross-owner reads under a real non-bypassing session" in {
      val ownerA = freshUser()
      val ownerB = freshUser()
      val tokenA = freshToken(ownerA, freshDashboard(ownerA))
      freshToken(ownerB, freshDashboard(ownerB))

      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT id FROM share_tokens WHERE id = ${tokenA.id.value}::uuid".as[String]
      ))

      rows shouldBe empty
    }

    "findByDashboard (app pool, owner-scoped) returns nothing for another owner's dashboard" in {
      val ownerA = freshUser()
      val ownerB = freshUser()
      val dashA  = freshDashboard(ownerA)
      freshToken(ownerA, dashA)

      await(repo.findByDashboard(dashA, ownerB)) shouldBe empty
      await(repo.findByDashboard(dashA, ownerA)) should not be empty
    }

    "revoke (app pool, owner-scoped) is a no-op against another owner's token" in {
      val ownerA = freshUser()
      val ownerB = freshUser()
      val tokenA = freshToken(ownerA, freshDashboard(ownerA))

      await(repo.revoke(tokenA.id, ownerB)) shouldBe false
      await(repo.revoke(tokenA.id, ownerA)) shouldBe true
    }

    "findActiveByHash (privileged pool) sees rows regardless of owner -- the anonymous validation path" in {
      val owner = freshUser()
      val token = freshToken(owner, freshDashboard(owner))

      await(repo.findActiveByHash(token.tokenHash)) shouldBe defined
    }
  }
}
