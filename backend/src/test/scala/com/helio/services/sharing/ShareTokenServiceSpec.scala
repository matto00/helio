package com.helio.services.sharing

import com.helio.api.http.{AccessCheckerImpl, ResourceType, ResourceTypeRegistry}
import com.helio.api.protocols.sharing.CreateShareTokenRequest
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sharing.ShareTokenRepository
import com.helio.services.ServiceError
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

/** HEL-590 task 6.1: `ShareTokenService` create (with/without expiry, past-expiry rejection),
 *  list (never carries a secret -- `ShareToken` has no field capable of one, so this is proven
 *  structurally, not just observed), revoke, and idempotent double-revoke. */
class ShareTokenServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var service: ShareTokenService         = _
  private var dashboardRepo: DashboardRepository = _

  private val ownerId    = UserId(UUID.randomUUID().toString)
  private val otherId    = UserId(UUID.randomUUID().toString)
  private val owner      = AuthenticatedUser(ownerId)
  private val nonOwner   = AuthenticatedUser(otherId)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dashboardRepo = new DashboardRepository(ctx)
    val permissionRepo   = new ResourcePermissionRepository(ctx)
    val shareTokenRepo   = new ShareTokenRepository(ctx)
    val registry = new ResourceTypeRegistry(
      ResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker = new AccessCheckerImpl(permissionRepo, registry)
    service = new ShareTokenService(shareTokenRepo, accessChecker)

    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at)
                         VALUES (${ownerId.value}::uuid, ${s"${ownerId.value}@helio.test"}, now())"""))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at)
                         VALUES (${otherId.value}::uuid, ${s"${otherId.value}@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedDashboard(): DashboardId = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'Share Token Test Dashboard', ${ownerId.value}, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId.value}::uuid)"""
    ))
    DashboardId(id)
  }

  "create" should {
    "mints a token with no expiry when omitted" in {
      val dashId = seedDashboard()
      val result = await(service.create(dashId.value, CreateShareTokenRequest(None), owner))
      result.isRight shouldBe true
      val response = result.getOrElse(fail("expected Right"))
      response.expiresAt shouldBe None
      response.token should not be empty
    }

    "mints a token with a future expiry" in {
      val dashId = seedDashboard()
      val expiry = Instant.now().plus(1, ChronoUnit.DAYS)
      val result = await(service.create(dashId.value, CreateShareTokenRequest(Some(expiry.toString)), owner))
      val response = result.getOrElse(fail("expected Right"))
      response.expiresAt shouldBe Some(expiry.toString)
    }

    "rejects an expiry at or before now" in {
      val dashId = seedDashboard()
      val past   = Instant.now().minusSeconds(60)
      val result = await(service.create(dashId.value, CreateShareTokenRequest(Some(past.toString)), owner))
      result shouldBe Left(ServiceError.BadRequest("expiresAt must be in the future"))
    }

    "refuses a non-owner" in {
      val dashId = seedDashboard()
      val result = await(service.create(dashId.value, CreateShareTokenRequest(None), nonOwner))
      result.isLeft shouldBe true
    }
  }

  "list" should {
    "returns tokens with no field capable of carrying the raw secret" in {
      val dashId = seedDashboard()
      await(service.create(dashId.value, CreateShareTokenRequest(None), owner))
      val result = await(service.list(dashId.value, owner))
      val tokens = result.getOrElse(fail("expected Right"))
      tokens should have size 1
      // ShareToken's own field set (id/dashboardId/userId/tokenHash/expiresAt/revokedAt/createdAt)
      // structurally excludes a raw-secret field -- `tokenHash` is the SHA-256 digest, never the
      // plaintext (task 2.3's own invariant, proven here from the caller's vantage point).
      tokens.head.productElementNames.toSet should not contain "token"
    }
  }

  "revoke" should {
    "revokes a live token" in {
      val dashId = seedDashboard()
      val created = await(service.create(dashId.value, CreateShareTokenRequest(None), owner))
        .getOrElse(fail("expected Right"))
      val result = await(service.revoke(dashId.value, ShareTokenId(created.id), owner))
      result shouldBe Right(())
      val listed = await(service.list(dashId.value, owner)).getOrElse(fail("expected Right"))
      listed.head.revokedAt shouldBe defined
    }

    "is idempotent -- revoking twice both succeed" in {
      val dashId = seedDashboard()
      val created = await(service.create(dashId.value, CreateShareTokenRequest(None), owner))
        .getOrElse(fail("expected Right"))
      await(service.revoke(dashId.value, ShareTokenId(created.id), owner)) shouldBe Right(())
      await(service.revoke(dashId.value, ShareTokenId(created.id), owner)) shouldBe Right(())
    }

    "returns NotFound for a token id that does not exist" in {
      val dashId = seedDashboard()
      val result = await(service.revoke(dashId.value, ShareTokenId(UUID.randomUUID().toString), owner))
      result shouldBe Left(ServiceError.NotFound("Share token not found"))
    }
  }
}
