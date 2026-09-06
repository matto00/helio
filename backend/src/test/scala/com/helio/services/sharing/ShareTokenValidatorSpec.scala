package com.helio.services.sharing

import com.helio.domain.model._
import com.helio.infrastructure.crypto.TokenHashing
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sharing.ShareTokenRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-590 task 6.2: a valid token authorizes, and unknown/revoked/expired/wrong-resource tokens
 *  each return the same negative result (`false`) from the same `authorizes` call -- design.md
 *  D4's single-predicate, single-exit property, tested one level below the HTTP directive. */
class ShareTokenValidatorSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: ShareTokenRepository         = _
  private var validator: ShareTokenValidator     = _

  private val ownerId = UserId(UUID.randomUUID().toString)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    repo = new ShareTokenRepository(ctx)
    validator = new ShareTokenValidatorImpl(Some(repo))

    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at)
                         VALUES (${ownerId.value}::uuid, ${s"${ownerId.value}@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedDashboard(): DashboardId = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'Validator Test Dashboard', ${ownerId.value}, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId.value}::uuid)"""
    ))
    DashboardId(id)
  }

  private def seedToken(
      dashboardId: DashboardId,
      rawToken: String,
      expiresAt: Option[Instant] = None,
      revokedAt: Option[Instant] = None
  ): Unit = {
    await(repo.insert(
      ShareToken(
        id          = ShareTokenId(UUID.randomUUID().toString),
        dashboardId = dashboardId,
        userId      = ownerId,
        tokenHash   = TokenHashing.sha256Hex(rawToken),
        expiresAt   = expiresAt,
        revokedAt   = revokedAt,
        createdAt   = Instant.now()
      )
    ))
  }

  "authorizes" should {

    "returns true for a valid, unexpired, unrevoked token bound to the requested resource" in {
      val dashId = seedDashboard()
      val raw    = "valid-token-" + UUID.randomUUID()
      seedToken(dashId, raw)

      await(validator.authorizes("dashboard", dashId.value, raw)) shouldBe true
    }

    "returns false for an unknown (nonexistent) token" in {
      await(validator.authorizes("dashboard", UUID.randomUUID().toString, "never-existed")) shouldBe false
    }

    "returns false for a revoked token" in {
      val dashId = seedDashboard()
      val raw    = "revoked-token-" + UUID.randomUUID()
      seedToken(dashId, raw, revokedAt = Some(Instant.now()))

      await(validator.authorizes("dashboard", dashId.value, raw)) shouldBe false
    }

    "returns false for an expired token" in {
      val dashId = seedDashboard()
      val raw    = "expired-token-" + UUID.randomUUID()
      seedToken(dashId, raw, expiresAt = Some(Instant.now().minus(1, ChronoUnit.HOURS)))

      await(validator.authorizes("dashboard", dashId.value, raw)) shouldBe false
    }

    "returns false for a token valid for a DIFFERENT resource" in {
      val dashId      = seedDashboard()
      val otherDashId = seedDashboard()
      val raw         = "wrong-resource-token-" + UUID.randomUUID()
      seedToken(dashId, raw)

      await(validator.authorizes("dashboard", otherDashId.value, raw)) shouldBe false
    }

    "returns true for a token with a future expiry" in {
      val dashId = seedDashboard()
      val raw    = "not-yet-expired-" + UUID.randomUUID()
      seedToken(dashId, raw, expiresAt = Some(Instant.now().plus(1, ChronoUnit.HOURS)))

      await(validator.authorizes("dashboard", dashId.value, raw)) shouldBe true
    }
  }
}
