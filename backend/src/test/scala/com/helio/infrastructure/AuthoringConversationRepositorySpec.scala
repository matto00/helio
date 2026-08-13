package com.helio.infrastructure

import com.helio.ai.{ClaudeMessage, ClaudeRole}
import com.helio.api.protocols.{AuthoringDisplayTurn, DashboardProposal}
import com.helio.domain._
import com.helio.infrastructure.AuthoringConversationRepository.AuthoringConversationRecord
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

/** HEL-397 tasks.md 6.2 — `AuthoringConversationRepository` CRUD round-trip PLUS real Postgres RLS
 *  enforcement (not the app-layer-only scoping `MetricRepositorySpec` documents, and not the
 *  privileged/BYPASSRLS pool): a second, non-superuser-role user genuinely cannot read or continue
 *  the first user's conversation. Mirrors `RlsOwnerTablesSpec`'s harness — a real
 *  `helio_app_test` role (NOT BYPASSRLS) the app pool `SET ROLE`s into, so the V77 policy is
 *  actually evaluated, not skipped by a superuser connection. */
class AuthoringConversationRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _ // postgres superuser
  private var appDb: JdbcBackend.Database         = _ // helio_app_test (non-superuser)
  private var ctx: DbContext                      = _
  private var repo: AuthoringConversationRepository = _

  private val ownerA = UserId(UUID.randomUUID().toString)
  private val ownerB = UserId(UUID.randomUUID().toString)
  private val userA  = AuthenticatedUser(ownerA)
  private val userB  = AuthenticatedUser(ownerB)

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
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

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
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx  = new DbContext(appDb, privilegedDb)
    repo = new AuthoringConversationRepository(ctx)

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

  private def cleanDb(): Unit =
    await(ctx.withSystemContext(sqlu"TRUNCATE TABLE authoring_conversations"))

  private def newRecord(owner: UserId, tokensUsed: Int = 30): AuthoringConversationRecord = {
    val now = Instant.now()
    AuthoringConversationRecord(
      id              = AuthoringConversationId(UUID.randomUUID().toString),
      ownerId         = owner,
      apiHistory      = Vector(ClaudeMessage(ClaudeRole.User, "Show total revenue"), ClaudeMessage(ClaudeRole.Assistant, """{"dashboardName":"Sales","panels":[]}""")),
      displayTurns    = Vector(AuthoringDisplayTurn("user", "Show total revenue"), AuthoringDisplayTurn("assistant", "Proposed \"Sales\" (0 panel(s))")),
      latestProposal  = Some(DashboardProposal("Sales", Vector.empty)),
      totalTokensUsed = tokensUsed,
      createdAt       = now,
      updatedAt       = now
    )
  }

  "AuthoringConversationRepository" should {

    "create then findById round-trips every field for the owner" in {
      cleanDb()
      val record = newRecord(ownerA)
      await(repo.create(record))

      val found = await(repo.findById(record.id, userA))
      found shouldBe defined
      found.get.id              shouldBe record.id
      found.get.ownerId         shouldBe ownerA
      found.get.apiHistory      shouldBe record.apiHistory
      found.get.displayTurns    shouldBe record.displayTurns
      found.get.latestProposal  shouldBe record.latestProposal
      found.get.totalTokensUsed shouldBe 30
    }

    "findById returns None for an unknown id" in {
      cleanDb()
      val result = await(repo.findById(AuthoringConversationId(UUID.randomUUID().toString), userA))
      result shouldBe None
    }

    // ── The real RLS assertions (not app-layer-only scoping) ────────────────

    "findById run as a second user CANNOT see the first user's conversation (real Postgres RLS)" in {
      cleanDb()
      val record = newRecord(ownerA)
      await(repo.create(record))

      val foundByOwner    = await(repo.findById(record.id, userA))
      val foundByNonOwner = await(repo.findById(record.id, userB))

      foundByOwner shouldBe defined
      foundByNonOwner shouldBe None
    }

    "findDisplayById run as a second user CANNOT rehydrate the first user's conversation (real Postgres RLS)" in {
      cleanDb()
      val record = newRecord(ownerA)
      await(repo.create(record))

      val ownerView    = await(repo.findDisplayById(record.id, userA))
      val nonOwnerView = await(repo.findDisplayById(record.id, userB))

      ownerView shouldBe defined
      nonOwnerView shouldBe None
    }

    "appendTurn run as a second user CANNOT continue the first user's conversation (real Postgres RLS) and leaves the row unchanged" in {
      cleanDb()
      val record = newRecord(ownerA)
      await(repo.create(record))

      val attackResult = await(repo.appendTurn(
        id              = record.id,
        user            = userB,
        apiHistory      = record.apiHistory :+ ClaudeMessage(ClaudeRole.User, "injected"),
        displayTurns    = record.displayTurns :+ AuthoringDisplayTurn("user", "injected"),
        latestProposal  = DashboardProposal("Hijacked", Vector.empty),
        totalTokensUsed = 999999,
        updatedAt       = Instant.now()
      ))

      attackResult shouldBe None

      val stillOwnedByOriginal = await(repo.findById(record.id, userA))
      stillOwnedByOriginal shouldBe defined
      stillOwnedByOriginal.get.latestProposal  shouldBe record.latestProposal
      stillOwnedByOriginal.get.totalTokensUsed shouldBe record.totalTokensUsed
    }

    "appendTurn run as the owner updates apiHistory/displayTurns/latestProposal/totalTokensUsed together" in {
      cleanDb()
      val record = newRecord(ownerA, tokensUsed = 30)
      await(repo.create(record))

      val newUserMessage = ClaudeMessage(ClaudeRole.User, "Make it a bar chart")
      val newAssistant    = ClaudeMessage(ClaudeRole.Assistant, """{"dashboardName":"Sales","panels":[{"title":"Total","type":"chart"}]}""")
      val updated = await(repo.appendTurn(
        id              = record.id,
        user            = userA,
        apiHistory      = record.apiHistory ++ Vector(newUserMessage, newAssistant),
        displayTurns    = record.displayTurns ++ Vector(AuthoringDisplayTurn("user", "Make it a bar chart"), AuthoringDisplayTurn("assistant", "Proposed \"Sales\" (1 panel(s))")),
        latestProposal  = DashboardProposal("Sales", Vector.empty),
        totalTokensUsed = 55,
        updatedAt       = Instant.now()
      ))

      updated shouldBe defined
      updated.get.apiHistory      should have size 4
      updated.get.displayTurns    should have size 4
      updated.get.totalTokensUsed shouldBe 55
    }

    "appendTurn returns None for an unknown id" in {
      cleanDb()
      val result = await(repo.appendTurn(
        id              = AuthoringConversationId(UUID.randomUUID().toString),
        user            = userA,
        apiHistory      = Vector.empty,
        displayTurns    = Vector.empty,
        latestProposal  = DashboardProposal("Ghost", Vector.empty),
        totalTokensUsed = 0,
        updatedAt       = Instant.now()
      ))
      result shouldBe None
    }

    "withSystemContext (privileged pool) sees a conversation regardless of owner" in {
      cleanDb()
      val record = newRecord(ownerA)
      await(repo.create(record))

      val rows = await(ctx.withSystemContext(sql"SELECT id FROM authoring_conversations".as[String]))
      rows should contain(record.id.value)
    }
  }
}
