package com.helio.api.routes.audit

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.JsonProtocols
import com.helio.api.protocols.audit.AuditEventResponse
import com.helio.domain.model._
import com.helio.domain.model.AuditEvent.NewAuditEvent
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HTTP-layer coverage for `GET /api/audit-events` (HEL-488 tasks.md 2.4).
 *  Uses a single embedded-Postgres role for both the app and privileged
 *  pool (mirrors `MetricRoutesSpec`'s shape) — the genuine, RLS-enforced
 *  tenant-isolation assertion lives in `AuditEventRepositorySpec`'s
 *  non-BYPASSRLS `helio_app_test` harness (task 1.3); this suite covers the
 *  route's own contract: two-user cross-visibility, pagination, and each
 *  filter individually. The unauthenticated-401 case is covered in
 *  `ApiRoutesSpec` (that behavior comes from `AuthDirectives.authenticate`
 *  wrapping the mount site, not from this route class in isolation). */
class AuditEventRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var auditEventRepo: AuditEventRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)
    auditEventRepo = new AuditEventRepository(ctx)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUser(): UserId = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    UserId(id)
  }

  private def seedEvent(
      actor: UserId,
      action: String = "dashboard.create",
      resourceType: String = "dashboard",
      resourceId: Option[String] = None,
      source: AuditSource = AuditSource.Ui
  ): AuditEventId =
    await(auditEventRepo.append(NewAuditEvent(
      actorUserId  = Some(actor),
      actorTokenId = None,
      source       = source,
      action       = action,
      resourceType = resourceType,
      resourceId   = resourceId,
      metadata     = JsObject.empty
    )))

  private def routesFor(user: AuthenticatedUser): Route =
    new AuditEventRoutes(auditEventRepo, user).routes

  "GET /api/audit-events" should {
    "return only the calling user's events, never another user's" in {
      val userA = AuthenticatedUser(seedUser())
      val userB = AuthenticatedUser(seedUser())
      val idA = seedEvent(userA.id)
      val idB = seedEvent(userB.id)

      Get("/audit-events") ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[PagedResult[AuditEventResponse]]
        body.items.map(_.id) should contain(idA.value)
        body.items.map(_.id) should not contain idB.value
      }
    }

    "paginate with a deterministic total" in {
      val user = AuthenticatedUser(seedUser())
      (1 to 3).foreach(_ => seedEvent(user.id))

      Get("/audit-events?offset=0&limit=2") ~> routesFor(user) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[PagedResult[AuditEventResponse]]
        body.items should have size 2
        body.total shouldBe 3
        body.offset shouldBe 0
        body.limit shouldBe 2
      }

      Get("/audit-events?offset=2&limit=2") ~> routesFor(user) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[PagedResult[AuditEventResponse]]
        body.items should have size 1
        body.total shouldBe 3
      }
    }

    "filter by resourceType and resourceId" in {
      val user = AuthenticatedUser(seedUser())
      val resourceId = UUID.randomUUID().toString
      val idMatch = seedEvent(user.id, resourceType = "dashboard", resourceId = Some(resourceId))
      seedEvent(user.id, resourceType = "panel", resourceId = Some(resourceId))
      seedEvent(user.id, resourceType = "dashboard", resourceId = Some(UUID.randomUUID().toString))

      Get(s"/audit-events?resourceType=dashboard&resourceId=$resourceId") ~> routesFor(user) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[PagedResult[AuditEventResponse]]
        body.items.map(_.id) shouldBe Seq(idMatch.value)
      }
    }

    "filter by action" in {
      val user = AuthenticatedUser(seedUser())
      val idMatch = seedEvent(user.id, action = "dashboard.delete")
      seedEvent(user.id, action = "dashboard.create")

      Get("/audit-events?action=dashboard.delete") ~> routesFor(user) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[PagedResult[AuditEventResponse]]
        body.items.map(_.id) shouldBe Seq(idMatch.value)
      }
    }

    "filter by source" in {
      val user = AuthenticatedUser(seedUser())
      val idMatch = seedEvent(user.id, source = AuditSource.Pat)
      seedEvent(user.id, source = AuditSource.Ui)

      Get("/audit-events?source=pat") ~> routesFor(user) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[PagedResult[AuditEventResponse]]
        body.items.map(_.id) shouldBe Seq(idMatch.value)
      }
    }

    "filter by time range (from/to)" in {
      val user = AuthenticatedUser(seedUser())
      val before = java.time.Instant.now().minusSeconds(3600)
      val idMatch = seedEvent(user.id)
      val after = java.time.Instant.now().plusSeconds(3600)

      Get(s"/audit-events?from=$before&to=$after") ~> routesFor(user) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[PagedResult[AuditEventResponse]]
        body.items.map(_.id) should contain(idMatch.value)
      }

      val farFuture = java.time.Instant.now().plusSeconds(7200)
      Get(s"/audit-events?from=$farFuture") ~> routesFor(user) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[PagedResult[AuditEventResponse]]
        body.items.map(_.id) should not contain idMatch.value
      }
    }

    "reject a malformed 'from' timestamp with 400" in {
      val user = AuthenticatedUser(seedUser())
      Get("/audit-events?from=not-a-timestamp") ~> routesFor(user) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject an unrecognized source with 400" in {
      val user = AuthenticatedUser(seedUser())
      Get("/audit-events?source=bogus") ~> routesFor(user) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "clamp a limit above the maximum rather than erroring" in {
      val user = AuthenticatedUser(seedUser())
      seedEvent(user.id)
      Get(s"/audit-events?limit=${Page.MaxLimit + 100}") ~> routesFor(user) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[PagedResult[AuditEventResponse]]
        body.limit shouldBe Page.MaxLimit
      }
    }

    "reject a negative offset with 400" in {
      val user = AuthenticatedUser(seedUser())
      Get("/audit-events?offset=-1") ~> routesFor(user) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }
}
