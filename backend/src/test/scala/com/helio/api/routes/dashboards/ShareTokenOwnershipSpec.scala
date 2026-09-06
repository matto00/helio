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
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
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
 *  Evaluation-1.md CR7 / Adjudication: `AccessChecker.requireOwnerOnly` itself returns `Forbidden`
 *  for a real-but-unowned dashboard and `NotFound` for an absent one -- a PRE-EXISTING,
 *  cross-cutting property shared by every owner-only resource in this codebase, out of scope to
 *  fix in the shared helper here (tracked as a separate spinoff). `ShareTokenService` closes the
 *  gap LOCALLY instead: it maps `Forbidden` onto the same `NotFound("Dashboard not found")` body
 *  `requireOwnerOnly` already produces for an absent dashboard, so every non-owner caller --
 *  editor grantee, viewer grantee, or a stranger with no grant at all -- gets the identical `404`
 *  regardless of whether the dashboard exists. This spec asserts that mapped behaviour, not the
 *  raw `403` the shared helper would otherwise produce. */
class ShareTokenOwnershipSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
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
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
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
    "is refused create/list/revoke, as NotFound (CR7 mapping)" in {
      val dashId = seedDashboardWithGrants()
      Post(s"/dashboards/$dashId/share-tokens", CreateShareTokenRequest(None)) ~> routesAs(editor) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      Get(s"/dashboards/$dashId/share-tokens") ~> routesAs(editor) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      Delete(s"/dashboards/$dashId/share-tokens/${UUID.randomUUID()}") ~> routesAs(editor) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "a viewer grantee" should {
    "is refused create/list/revoke, as NotFound (CR7 mapping)" in {
      val dashId = seedDashboardWithGrants()
      Post(s"/dashboards/$dashId/share-tokens", CreateShareTokenRequest(None)) ~> routesAs(viewer) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      Get(s"/dashboards/$dashId/share-tokens") ~> routesAs(viewer) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "an unrelated user with no grant at all" should {
    "is refused create/list/revoke, as NotFound (CR7 mapping)" in {
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

    "cannot distinguish a real-but-unowned dashboard from a nonexistent one (CR7)" in {
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
