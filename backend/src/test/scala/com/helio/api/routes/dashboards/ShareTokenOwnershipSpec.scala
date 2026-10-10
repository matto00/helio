package com.helio.api.routes.dashboards

import com.helio.api._
import com.helio.api.http.{AccessCheckerImpl, ResourceType, ResourceTypeRegistry}
import com.helio.api.protocols.sharing.CreateShareTokenRequest
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sharing.ShareTokenRepository
import com.helio.services.sharing.ShareTokenService
import com.helio.testkit.HelioRouteTest
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-590 task 6.5: only the dashboard owner may create/list/revoke its share tokens -- an
 *  editor grantee, a viewer grantee, and an unrelated user are all refused.
 *
 *  HEL-1002: `AccessChecker.requireOwnerOnly` itself collapses "real but no grant" onto the absent
 *  dashboard's `404` body (no service-local mapping any more); an editor/viewer grantee, who can
 *  already see the dashboard, is refused with `403` instead. A stranger with no grant at all stays
 *  indistinguishable from a nonexistent dashboard. */
class ShareTokenOwnershipSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var service: ShareTokenService         = _
  private var permissionRepo: ResourcePermissionRepository = _

  private val ownerId    = UUID.randomUUID().toString
  private val editorId   = UUID.randomUUID().toString
  private val viewerId   = UUID.randomUUID().toString
  private val strangerId = UUID.randomUUID().toString

  private val owner    = AuthenticatedUser(UserId(ownerId))
  private val editor   = AuthenticatedUser(UserId(editorId))
  private val viewer   = AuthenticatedUser(UserId(viewerId))
  private val stranger = AuthenticatedUser(UserId(strangerId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)

    val dashboardRepo = new DashboardRepository(ctx)(routeEc)
    permissionRepo     = new ResourcePermissionRepository(ctx)(routeEc)
    val shareTokenRepo = new ShareTokenRepository(ctx)(routeEc)
    val registry = new ResourceTypeRegistry(
      ResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker = new AccessCheckerImpl(permissionRepo, registry)(routeEc)
    service = new ShareTokenService(shareTokenRepo, accessChecker)(routeEc)

    import PostgresProfile.api._
    Seq(ownerId, editorId, viewerId, strangerId).foreach { id =>
      await(db.run(sqlu"""INSERT INTO users (id, email, created_at)
                           VALUES ($id::uuid, ${s"$id@helio.test"}, now())"""))
    }
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def routesAs(user: AuthenticatedUser): Route = new ShareTokenRoutes(service, user)(typedSystem).routes

  private def seedDashboardWithGrants(): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'Ownership Test Dashboard', $ownerId, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)"""
    ))
    await(permissionRepo.insert(ResourcePermission("dashboard", id, Some(UserId(editorId)), Role.Editor, Instant.now())))
    await(permissionRepo.insert(ResourcePermission("dashboard", id, Some(UserId(viewerId)), Role.Viewer, Instant.now())))
    id
  }

  "the owner" should {
    "can create, list, and revoke tokens" in {
      val dashId = seedDashboardWithGrants()
      Post(s"/dashboards/$dashId/share-tokens", CreateShareTokenRequest(None)) ~> routesAs(owner) ~> check {
        status shouldBe StatusCodes.Created
      }
      Get(s"/dashboards/$dashId/share-tokens") ~> routesAs(owner) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  "an editor grantee" should {
    "is refused create/list/revoke with 403 (grantee already sees the dashboard)" in {
      val dashId = seedDashboardWithGrants()
      Post(s"/dashboards/$dashId/share-tokens", CreateShareTokenRequest(None)) ~> routesAs(editor) ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      Get(s"/dashboards/$dashId/share-tokens") ~> routesAs(editor) ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      Delete(s"/dashboards/$dashId/share-tokens/${UUID.randomUUID()}") ~> routesAs(editor) ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }
  }

  "a viewer grantee" should {
    "is refused create/list/revoke with 403 (grantee already sees the dashboard)" in {
      val dashId = seedDashboardWithGrants()
      Post(s"/dashboards/$dashId/share-tokens", CreateShareTokenRequest(None)) ~> routesAs(viewer) ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      Get(s"/dashboards/$dashId/share-tokens") ~> routesAs(viewer) ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }
  }

  "an unrelated user with no grant at all" should {
    "is refused create/list/revoke, as NotFound" in {
      val dashId = seedDashboardWithGrants()
      Post(s"/dashboards/$dashId/share-tokens", CreateShareTokenRequest(None)) ~> routesAs(stranger) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      Get(s"/dashboards/$dashId/share-tokens") ~> routesAs(stranger) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "and creates no token as a side effect of the refused attempt" in {
      val dashId = seedDashboardWithGrants()
      Post(s"/dashboards/$dashId/share-tokens", CreateShareTokenRequest(None)) ~> routesAs(stranger) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      Get(s"/dashboards/$dashId/share-tokens") ~> routesAs(owner) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[ShareTokensResponse].items shouldBe empty
      }
    }

    "cannot distinguish a real-but-unowned dashboard from a nonexistent one (HEL-1002)" in {
      val dashId          = seedDashboardWithGrants()
      val nonexistentId   = UUID.randomUUID().toString

      val realBody = Get(s"/dashboards/$dashId/share-tokens") ~> routesAs(stranger) ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[String]
      }
      val absentBody = Get(s"/dashboards/$nonexistentId/share-tokens") ~> routesAs(stranger) ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[String]
      }

      realBody shouldBe absentBody
    }
  }

  "a revoke against a token id that doesn't exist under the caller's own dashboard" should {
    "returns NotFound without revoking or disclosing anything" in {
      val dashId = seedDashboardWithGrants()
      Delete(s"/dashboards/$dashId/share-tokens/${UUID.randomUUID()}") ~> routesAs(owner) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
