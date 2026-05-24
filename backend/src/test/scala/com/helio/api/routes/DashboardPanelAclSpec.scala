package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.mapRequest
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{ApiRoutes, JsonProtocols}
import com.helio.domain._
import com.helio.infrastructure.{DashboardRepository, DataSourceRepository, DataTypeRepository, LocalFileSystem, PanelRepository, PipelineRepository, PipelineStepRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-265 CS4 — sharing-matrix ACL coverage for Dashboard + Panel endpoints.
 *
 *  Seeded scenario:
 *  - userA owns a dashboard with one panel
 *  - userB has no access by default
 *  - Specific tests grant userB an editor or viewer role on the dashboard
 *  - Anonymous callers hit PublicDashboardRoutes (no auth header)
 *
 *  403 vs 404 decision:
 *  - `GET /dashboards/:id/panels` uses AclDirective.authorizeResourceWithSharing:
 *    authenticated user with no grant → 403; anonymous with no public grant → 404
 *  - Dashboard CRUD (delete/duplicate/update/export) goes through DashboardService:
 *    no-grant caller → 404 (no existence leak); grantee trying owner-only → 403
 *  - Viewer trying to mutate → 403 (resource visible, mutation blocked)
 *
 *  Holes closed:
 *  - /api/panels/:id/query: any authenticated user could query any panel (now: 404 for non-grantee)
 *  - /api/dashboards/:id cross-user GET/PATCH/DELETE: leaks before service guard (now: 404)
 *  - POST /api/dashboards/:id/duplicate: cross-user 404
 */
class DashboardPanelAclSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var dashboardRepo: DashboardRepository           = _
  private var panelRepo: PanelRepository                   = _
  private var dataTypeRepo: DataTypeRepository             = _
  private var dataSourceRepo: DataSourceRepository         = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var userRepo: UserRepository                     = _
  private var userPrefRepo: UserPreferenceRepository       = _

  // Two distinct users — userA owns resources; userB is the cross-user probe.
  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))

  private val tokenA = "token-user-a"
  private val tokenB = "token-user-b"

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(token match {
        case `tokenA` => Some(userA)
        case `tokenB` => Some(userB)
        case _        => None
      })
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    dashboardRepo  = new DashboardRepository(db)(routeEc)
    panelRepo      = new PanelRepository(db)(routeEc)
    dataTypeRepo   = new DataTypeRepository(db)(routeEc)
    dataSourceRepo = new DataSourceRepository(db)(routeEc)
    permissionRepo = new ResourcePermissionRepository(db)(routeEc)
    userRepo       = new UserRepository(db)(routeEc)
    userPrefRepo   = new UserPreferenceRepository(db)(routeEc)
    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  // ── DB helpers ─────────────────────────────────────────────────────────────

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
               VALUES ($userAId::uuid, ${s"user-a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at)
               VALUES ($userBId::uuid, ${s"user-b-$userBId@helio.test"}, now())"""
    )))
  }

  private def seedDashboard(ownerId: String): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($id, 'Test Dashboard', $ownerId, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}',
                       '{"lg":[],"md":[],"sm":[],"xs":[]}',
                       ${ownerId}::uuid)"""
    ))
    id
  }

  private def seedPanel(dashId: String, ownerId: String): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, owner_id)
               VALUES ($id, $dashId, 'Test Panel', $ownerId, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}',
                       'metric', ${ownerId}::uuid)"""
    ))
    id
  }

  private def grantRole(dashId: String, granteeId: String, role: String): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('dashboard', $dashId, ${granteeId}::uuid, $role, now())
               ON CONFLICT (resource_type, resource_id, grantee_id) DO UPDATE SET role = EXCLUDED.role"""
    ))
  }

  private def grantPublicViewer(dashId: String): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('dashboard', $dashId, NULL, 'viewer', now())
               ON CONFLICT DO NOTHING"""
    ))
  }

  private def removeGrant(dashId: String, granteeId: String): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""DELETE FROM resource_permissions
               WHERE resource_type = 'dashboard'
                 AND resource_id = $dashId
                 AND grantee_id = ${granteeId}::uuid"""
    ))
  }

  private def removePublicGrant(dashId: String): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""DELETE FROM resource_permissions
               WHERE resource_type = 'dashboard' AND resource_id = $dashId AND grantee_id IS NULL"""
    ))
  }

  // ── Route fixtures ─────────────────────────────────────────────────────────

  private def mkPipelineRepo =
    new PipelineRepository(db, dataTypeRepo, dataSourceRepo)(routeEc)
  private def mkPipelineStepRepo = new PipelineStepRepository(db)(routeEc)

  private def stubFileSystem = {
    val tmpDir = Files.createTempDirectory("helio-acl-spec")
    new LocalFileSystem(tmpDir)
  }

  private def buildRoutes(): ApiRoutes =
    new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo,
      stubFileSystem,
      new RestApiConnector(Some(_ => Future.successful(Left("no HTTP in tests")))),
      userRepo, stubSessionRepo, userPrefRepo,
      mkPipelineRepo, mkPipelineStepRepo,
      new PipelineRunCache(),
      new SparkJobSubmitter("local", dataSourceRepo, mkPipelineRepo)(routeEc)
    )

  private def fullRoutes(token: String): Route =
    mapRequest { req =>
      if (req.header[Authorization].isDefined) req
      else req.withHeaders(req.headers :+ Authorization(OAuth2BearerToken(token)))
    } {
      buildRoutes().routes
    }

  /** Unauthenticated routes (no Authorization header injected). */
  private def anonRoutes(): Route = buildRoutes().routes

  private def routesA() = fullRoutes(tokenA)
  private def routesB() = fullRoutes(tokenB)

  // ── Repository-level ACL tests ─────────────────────────────────────────────

  "DashboardRepository.findById(id, callerOpt)" should {
    "return Some for the owner" in {
      val dashId = seedDashboard(userAId)
      await(dashboardRepo.findById(DashboardId(dashId), Some(userA))) shouldBe defined
    }
    "return None for cross-user caller with no grant" in {
      val dashId = seedDashboard(userAId)
      await(dashboardRepo.findById(DashboardId(dashId), Some(userB))) shouldBe None
    }
    "return Some for a grantee (editor)" in {
      val dashId = seedDashboard(userAId)
      grantRole(dashId, userBId, "editor")
      await(dashboardRepo.findById(DashboardId(dashId), Some(userB))) shouldBe defined
      removeGrant(dashId, userBId)
    }
    "return Some for a grantee (viewer)" in {
      val dashId = seedDashboard(userAId)
      grantRole(dashId, userBId, "viewer")
      await(dashboardRepo.findById(DashboardId(dashId), Some(userB))) shouldBe defined
      removeGrant(dashId, userBId)
    }
    "return Some for anonymous caller when public-viewer grant exists" in {
      val dashId = seedDashboard(userAId)
      grantPublicViewer(dashId)
      await(dashboardRepo.findById(DashboardId(dashId), None)) shouldBe defined
      removePublicGrant(dashId)
    }
    "return None for anonymous caller without public-viewer grant" in {
      val dashId = seedDashboard(userAId)
      await(dashboardRepo.findById(DashboardId(dashId), None)) shouldBe None
    }
  }

  "DashboardRepository.findByIdOwned" should {
    "return Some for the owner" in {
      val dashId = seedDashboard(userAId)
      await(dashboardRepo.findByIdOwned(DashboardId(dashId), userA)) shouldBe defined
    }
    "return None for cross-user caller even with a grant" in {
      val dashId = seedDashboard(userAId)
      grantRole(dashId, userBId, "editor")
      await(dashboardRepo.findByIdOwned(DashboardId(dashId), userB)) shouldBe None
      removeGrant(dashId, userBId)
    }
  }

  "DashboardRepository.findAllVisible" should {
    "include owned dashboards" in {
      val dashId = seedDashboard(userAId)
      val visible = await(dashboardRepo.findAllVisible(userA))
      visible.map(_.id.value) should contain(dashId)
    }
    "include granted dashboards for grantee" in {
      val dashId = seedDashboard(userAId)
      grantRole(dashId, userBId, "viewer")
      val visible = await(dashboardRepo.findAllVisible(userB))
      visible.map(_.id.value) should contain(dashId)
      removeGrant(dashId, userBId)
    }
    "not include ungranted dashboards for non-owner" in {
      val dashId = seedDashboard(userAId)
      val visible = await(dashboardRepo.findAllVisible(userB))
      visible.map(_.id.value) should not contain dashId
    }
  }

  "PanelRepository.findById(id, callerOpt)" should {
    "return Some for the dashboard owner" in {
      val dashId  = seedDashboard(userAId)
      val panelId = seedPanel(dashId, userAId)
      await(panelRepo.findById(PanelId(panelId), Some(userA))) shouldBe defined
    }
    "return None for cross-user caller with no grant" in {
      val dashId  = seedDashboard(userAId)
      val panelId = seedPanel(dashId, userAId)
      await(panelRepo.findById(PanelId(panelId), Some(userB))) shouldBe None
    }
    "return Some for a grantee" in {
      val dashId  = seedDashboard(userAId)
      val panelId = seedPanel(dashId, userAId)
      grantRole(dashId, userBId, "viewer")
      await(panelRepo.findById(PanelId(panelId), Some(userB))) shouldBe defined
      removeGrant(dashId, userBId)
    }
    "return Some for anonymous caller when public-viewer grant exists" in {
      val dashId  = seedDashboard(userAId)
      val panelId = seedPanel(dashId, userAId)
      grantPublicViewer(dashId)
      await(panelRepo.findById(PanelId(panelId), None)) shouldBe defined
      removePublicGrant(dashId)
    }
    "return None for anonymous caller without public-viewer grant" in {
      val dashId  = seedDashboard(userAId)
      val panelId = seedPanel(dashId, userAId)
      await(panelRepo.findById(PanelId(panelId), None)) shouldBe None
    }
  }

  "PanelRepository.findAllByDashboardId" should {
    "return panels for the owner" in {
      val dashId  = seedDashboard(userAId)
      seedPanel(dashId, userAId)
      await(panelRepo.findAllByDashboardId(DashboardId(dashId), Some(userA))) should not be empty
    }
    "return empty for cross-user caller with no grant" in {
      val dashId  = seedDashboard(userAId)
      seedPanel(dashId, userAId)
      await(panelRepo.findAllByDashboardId(DashboardId(dashId), Some(userB))) shouldBe empty
    }
    "return panels for a grantee" in {
      val dashId  = seedDashboard(userAId)
      seedPanel(dashId, userAId)
      grantRole(dashId, userBId, "viewer")
      await(panelRepo.findAllByDashboardId(DashboardId(dashId), Some(userB))) should not be empty
      removeGrant(dashId, userBId)
    }
    "return panels for anonymous caller when public grant exists" in {
      val dashId  = seedDashboard(userAId)
      seedPanel(dashId, userAId)
      grantPublicViewer(dashId)
      await(panelRepo.findAllByDashboardId(DashboardId(dashId), None)) should not be empty
      removePublicGrant(dashId)
    }
  }

  // ── HTTP route ACL tests — owner regression ────────────────────────────────

  "GET /api/dashboards/:id/panels (owner)" should {
    "return 200 for the dashboard owner" in {
      val dashId = seedDashboard(userAId)
      seedPanel(dashId, userAId)
      Get(s"/api/dashboards/$dashId/panels") ~> routesA() ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  "DELETE /api/dashboards/:id (owner)" should {
    "return 204 for the owner" in {
      val dashId = seedDashboard(userAId)
      Delete(s"/api/dashboards/$dashId") ~> routesA() ~> check {
        status shouldBe StatusCodes.NoContent
      }
    }
  }

  "PATCH /api/dashboards/:id (owner)" should {
    "return 200 for the owner" in {
      val dashId = seedDashboard(userAId)
      val body   = JsObject("name" -> JsString("Renamed by owner"))
      Patch(s"/api/dashboards/$dashId", body) ~> routesA() ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  "POST /api/dashboards/:id/duplicate (owner)" should {
    "return 201 for the owner" in {
      val dashId = seedDashboard(userAId)
      Post(s"/api/dashboards/$dashId/duplicate") ~> routesA() ~> check {
        status shouldBe StatusCodes.Created
      }
    }
  }

  // ── HTTP route ACL tests — cross-user with NO grant ────────────────────────
  // Note: GET /dashboards/:id/panels goes through AclDirective.authorizeResourceWithSharing
  // which returns 403 for authenticated users with no grant (not 404). The dashboard
  // CRUD paths (delete/duplicate/update/export) use DashboardService.findById(sharing-aware)
  // and return 404 for no-grant callers (no existence leak at service layer).

  "GET /api/dashboards/:id/panels (cross-user, no grant)" should {
    "return 403 (AclDirective hides existence for authenticated user, not service layer)" in {
      val dashId = seedDashboard(userAId)
      Get(s"/api/dashboards/$dashId/panels") ~> routesB() ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }
  }

  "DELETE /api/dashboards/:id (cross-user, no grant)" should {
    "return 404 — no existence leak (was: leaks via findById then service-layer guard)" in {
      val dashId = seedDashboard(userAId)
      Delete(s"/api/dashboards/$dashId") ~> routesB() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "PATCH /api/dashboards/:id (cross-user, no grant)" should {
    "return 404 — no existence leak" in {
      val dashId = seedDashboard(userAId)
      val body   = JsObject("name" -> JsString("hijack"))
      Patch(s"/api/dashboards/$dashId", body) ~> routesB() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "POST /api/dashboards/:id/duplicate (cross-user, no grant)" should {
    "return 404 — no existence leak" in {
      val dashId = seedDashboard(userAId)
      Post(s"/api/dashboards/$dashId/duplicate") ~> routesB() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "GET /api/dashboards/:id/export (cross-user, no grant)" should {
    "return 404 — no existence leak" in {
      val dashId = seedDashboard(userAId)
      Get(s"/api/dashboards/$dashId/export") ~> routesB() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "GET /api/panels/:id/query (cross-user, no grant)" should {
    "return 404 (was: open hole — any authenticated user could query any panel)" in {
      val dashId  = seedDashboard(userAId)
      val panelId = seedPanel(dashId, userAId)
      Get(s"/api/panels/$panelId/query") ~> routesB() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  // ── Editor grant ───────────────────────────────────────────────────────────

  "Editor grant on dashboard" should {
    "allow GET /api/dashboards/:id/panels" in {
      val dashId = seedDashboard(userAId)
      seedPanel(dashId, userAId)
      grantRole(dashId, userBId, "editor")
      Get(s"/api/dashboards/$dashId/panels") ~> routesB() ~> check {
        status shouldBe StatusCodes.OK
      }
      removeGrant(dashId, userBId)
    }

    "allow PATCH /api/dashboards/:id (update layout)" in {
      val dashId = seedDashboard(userAId)
      grantRole(dashId, userBId, "editor")
      val body = JsObject("name" -> JsString("Editor renamed"))
      Patch(s"/api/dashboards/$dashId", body) ~> routesB() ~> check {
        status shouldBe StatusCodes.OK
      }
      removeGrant(dashId, userBId)
    }

    "return 403 when editor (non-owner) attempts to delete (owner-only operation)" in {
      val dashId = seedDashboard(userAId)
      grantRole(dashId, userBId, "editor")
      // Editor can SEE the resource (grantee), but cannot delete (owner-only) → 403
      Delete(s"/api/dashboards/$dashId") ~> routesB() ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      removeGrant(dashId, userBId)
    }

    "return 403 when editor (non-owner) attempts to duplicate (owner-only operation)" in {
      val dashId = seedDashboard(userAId)
      grantRole(dashId, userBId, "editor")
      Post(s"/api/dashboards/$dashId/duplicate") ~> routesB() ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      removeGrant(dashId, userBId)
    }
  }

  // ── Viewer grant — can read, NOT mutate (403 not 404) ─────────────────────

  "Viewer grant on dashboard" should {
    "allow GET /api/dashboards/:id/panels (200 not 404/403)" in {
      val dashId = seedDashboard(userAId)
      seedPanel(dashId, userAId)
      grantRole(dashId, userBId, "viewer")
      Get(s"/api/dashboards/$dashId/panels") ~> routesB() ~> check {
        status shouldBe StatusCodes.OK
      }
      removeGrant(dashId, userBId)
    }

    "return 403 on DELETE (viewer is a grantee — existence visible, mutation blocked)" in {
      val dashId = seedDashboard(userAId)
      grantRole(dashId, userBId, "viewer")
      // findById(sharing-aware) returns Some (viewer can see) → not owner → 403
      Delete(s"/api/dashboards/$dashId") ~> routesB() ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      removeGrant(dashId, userBId)
    }

    "return 403 on PATCH (viewer can see but not mutate)" in {
      val dashId = seedDashboard(userAId)
      grantRole(dashId, userBId, "viewer")
      val body = JsObject("name" -> JsString("viewer hijack"))
      Patch(s"/api/dashboards/$dashId", body) ~> routesB() ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      removeGrant(dashId, userBId)
    }
  }

  // ── Public-viewer fallback ─────────────────────────────────────────────────

  "Public-viewer grant" should {
    "allow anonymous GET /api/dashboards/:id/panels" in {
      val dashId = seedDashboard(userAId)
      seedPanel(dashId, userAId)
      grantPublicViewer(dashId)
      Get(s"/api/dashboards/$dashId/panels") ~> anonRoutes() ~> check {
        status shouldBe StatusCodes.OK
      }
      removePublicGrant(dashId)
    }

    "return 404 when no public grant (anonymous user, private dashboard)" in {
      val dashId = seedDashboard(userAId)
      seedPanel(dashId, userAId)
      Get(s"/api/dashboards/$dashId/panels") ~> anonRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
