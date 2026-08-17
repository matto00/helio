package com.helio.infrastructure

import com.helio.domain.UserId
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-704 tasks.md 7.1 — `InviteCodeRepository.redeemAndUpgrade`'s atomic consume-and-upgrade
 *  behavior (design.md D3) PLUS real Postgres RLS enforcement on `invite_codes` (design.md D1).
 *  Mirrors `AssistantConversationRepositorySpec`'s exact dual-pool harness — a real
 *  `helio_app_test` role (NOT BYPASSRLS) the app pool `SET ROLE`s into, so the V90 policy is
 *  actually evaluated, not skipped by a superuser connection. */
class InviteCodeRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _ // postgres superuser
  private var appDb: JdbcBackend.Database         = _ // helio_app_test (non-superuser)
  private var ctx: DbContext                      = _
  private var repo: InviteCodeRepository          = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

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

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(10)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(10))

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
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(10)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(10))

    ctx  = new DbContext(appDb, privilegedDb)
    repo = new InviteCodeRepository(ctx)
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
  }

  private def cleanDb(): Unit =
    await(ctx.withSystemContext(sqlu"TRUNCATE TABLE invite_codes"))

  /** Inserts a fresh `users` row with the given tier ("free" unless overridden) and returns its
   *  id. Every test starts from a clean, known tier rather than relying on the column default. */
  private def newUser(tier: String = "free"): UserId = {
    val id = UserId(UUID.randomUUID().toString)
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at, tier)
             VALUES (${id.value}::uuid, ${s"${id.value}@test.local"}, now(), $tier)"""
    ))
    id
  }

  private def issueCode(recipient: UserId, codeHash: String): Unit =
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO invite_codes (id, code_hash, user_id, created_at, redeemed_at)
             VALUES (${UUID.randomUUID().toString}::uuid, $codeHash, ${recipient.value}::uuid, now(), NULL)"""
    ))

  private def tierOf(userId: UserId): String =
    await(ctx.withSystemContext(sql"SELECT tier FROM users WHERE id = ${userId.value}::uuid".as[String].head))

  private def redeemedAtIsSet(codeHash: String): Boolean =
    await(ctx.withSystemContext(
      sql"SELECT redeemed_at IS NOT NULL FROM invite_codes WHERE code_hash = $codeHash".as[Boolean].head
    ))

  "InviteCodeRepository.redeemAndUpgrade" should {

    "redeems a valid code and upgrades the caller's tier to beta, in one transaction" in {
      cleanDb()
      val user = newUser(tier = "free")
      issueCode(user, "hash-valid-1")

      val result = await(repo.redeemAndUpgrade(user, "hash-valid-1"))

      result shouldBe true
      redeemedAtIsSet("hash-valid-1") shouldBe true
      tierOf(user) shouldBe "beta"
    }

    "a second redemption of the same (now-used) code fails" in {
      cleanDb()
      val user = newUser(tier = "free")
      issueCode(user, "hash-reused")

      await(repo.redeemAndUpgrade(user, "hash-reused")) shouldBe true
      val second = await(repo.redeemAndUpgrade(user, "hash-reused"))

      second shouldBe false
      // Tier was already upgraded by the first call — still beta, not reverted.
      tierOf(user) shouldBe "beta"
    }

    "a code issued for a different user fails and leaves both users' tiers unchanged" in {
      cleanDb()
      val recipient = newUser(tier = "free")
      val impostor  = newUser(tier = "free")
      issueCode(recipient, "hash-foreign")

      val result = await(repo.redeemAndUpgrade(impostor, "hash-foreign"))

      result shouldBe false
      redeemedAtIsSet("hash-foreign") shouldBe false
      tierOf(recipient) shouldBe "free"
      tierOf(impostor) shouldBe "free"
    }

    "an unknown code fails" in {
      cleanDb()
      val user = newUser(tier = "free")

      val result = await(repo.redeemAndUpgrade(user, "hash-never-issued"))

      result shouldBe false
      tierOf(user) shouldBe "free"
    }

    "never downgrades an owner-tier caller, even given a valid code issued for them" in {
      cleanDb()
      val owner = newUser(tier = "owner")
      issueCode(owner, "hash-owner")

      await(repo.redeemAndUpgrade(owner, "hash-owner"))

      tierOf(owner) shouldBe "owner"
    }

    "never downgrades (or double-processes) an already-beta caller" in {
      cleanDb()
      val betaUser = newUser(tier = "beta")
      issueCode(betaUser, "hash-beta")

      await(repo.redeemAndUpgrade(betaUser, "hash-beta"))

      tierOf(betaUser) shouldBe "beta"
    }

    "concurrent redemption attempts of the same code result in at most one success" in {
      cleanDb()
      val user = newUser(tier = "free")
      issueCode(user, "hash-race")

      val results = await(Future.sequence(Vector.fill(10)(repo.redeemAndUpgrade(user, "hash-race"))))

      results.count(identity) shouldBe 1
      tierOf(user) shouldBe "beta"
    }

    // ── RLS (design.md D1) ──────────────────────────────────────────────────────────────────

    "RLS: a foreign user's application context cannot see another user's invite code row" in {
      cleanDb()
      val recipient = newUser(tier = "free")
      val other     = newUser(tier = "free")
      issueCode(recipient, "hash-rls")

      val rows = await(ctx.withUserContext(other.value)(
        sql"SELECT id::text FROM invite_codes WHERE code_hash = 'hash-rls'".as[String]
      ))

      rows shouldBe empty
    }

    "withSystemContext (privileged pool) sees the row regardless of the intended recipient" in {
      cleanDb()
      val recipient = newUser(tier = "free")
      issueCode(recipient, "hash-privileged-visible")

      val rows = await(ctx.withSystemContext(
        sql"SELECT user_id::text FROM invite_codes WHERE code_hash = 'hash-privileged-visible'".as[String]
      ))

      rows should contain(recipient.value)
    }
  }
}
