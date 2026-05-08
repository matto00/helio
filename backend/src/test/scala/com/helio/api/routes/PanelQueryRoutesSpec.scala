package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{AclDirective, ErrorResponse, JsonProtocols}
import com.helio.domain._
import com.helio.infrastructure.{
  DashboardRepository,
  DataTypeRepository,
  PanelRepository,
  ResourcePermissionRepository
}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

class PanelQueryRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var panelRepo: PanelRepository                   = _
  private var dashboardRepo: DashboardRepository           = _
  private var dataTypeRepo: DataTypeRepository             = _
  private var permissionRepo: ResourcePermissionRepository = _

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db            = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    panelRepo     = new PanelRepository(db)(routeEc)
    dashboardRepo = new DashboardRepository(db)(routeEc)
    dataTypeRepo  = new DataTypeRepository(db)(routeEc)
    permissionRepo = new ResourcePermissionRepository(db)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def makeRoutes(): Route = {
    implicit val ec: ExecutionContext = routeEc
    val registry   = new com.helio.api.ResourceTypeRegistry()
    val aclDir     = new AclDirective(permissionRepo, registry)
    new PanelRoutes(panelRepo, dashboardRepo, dataTypeRepo, permissionRepo, aclDir, dummyUser).routes
  }

  private val ownerId = "00000000-0000-0000-0000-000000000001"

  private def seedUser(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""
      INSERT INTO users (id, email, created_at)
      VALUES ('#$ownerId'::uuid, 'test@helio.dev', now())
      ON CONFLICT DO NOTHING"""))
  }

  private def seedDashboard(): String = {
    import PostgresProfile.api._
    val dashId = java.util.UUID.randomUUID().toString
    await(db.run(sqlu"""
      INSERT INTO dashboards (id, name, owner_id, created_by, appearance, layout, created_at, last_updated)
      VALUES ($dashId, 'Test', '#$ownerId'::uuid, $ownerId,
              '{"background":"transparent","gridBackground":"transparent"}',
              '{"lg":[],"md":[],"sm":[],"xs":[]}', now(), now())"""))
    dashId
  }

  private def seedDataType(): String = {
    import PostgresProfile.api._
    val dtId = java.util.UUID.randomUUID().toString
    await(db.run(sqlu"""
      INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
      VALUES ($dtId, 'SalesData', '[]', 1, '#$ownerId'::uuid, now(), now())"""))
    dtId
  }

  private def seedBoundPanel(dashId: String, dtId: String): String = {
    import PostgresProfile.api._
    val panelId      = java.util.UUID.randomUUID().toString
    val appearance   = """{"background":"transparent","color":"inherit","transparency":0.0}"""
    val fieldMapping = """{"value":"price","label":"name"}"""
    await(db.run(sqlu"""
      INSERT INTO panels (id, dashboard_id, title, type, owner_id, appearance,
                          type_id, field_mapping, created_by, created_at, last_updated)
      VALUES ($panelId, $dashId, 'Bound Panel', 'metric', '#$ownerId'::uuid, $appearance,
              $dtId, $fieldMapping, $ownerId, now(), now())"""))
    panelId
  }

  private def seedUnboundPanel(dashId: String): String = {
    import PostgresProfile.api._
    val panelId    = java.util.UUID.randomUUID().toString
    val appearance = """{"background":"transparent","color":"inherit","transparency":0.0}"""
    await(db.run(sqlu"""
      INSERT INTO panels (id, dashboard_id, title, type, owner_id, appearance,
                          created_by, created_at, last_updated)
      VALUES ($panelId, $dashId, 'Unbound Panel', 'metric', '#$ownerId'::uuid, $appearance,
              $ownerId, now(), now())"""))
    panelId
  }

  "GET /panels/:id/query" should {

    "return 200 with PanelQuery JSON for a bound panel" in {
      seedUser()
      val dashId  = seedDashboard()
      val dtId    = seedDataType()
      val panelId = seedBoundPanel(dashId, dtId)

      Get(s"/panels/$panelId/query") ~> makeRoutes() ~> check {
        status shouldBe StatusCodes.OK
        val query = responseAs[PanelQuery]
        query.selectedFields should contain theSameElementsAs List("price", "name")
        query.filters shouldBe Nil
        query.sort    shouldBe None
        query.limit   shouldBe None
      }
    }

    "return 404 for an unbound panel" in {
      seedUser()
      val dashId  = seedDashboard()
      val panelId = seedUnboundPanel(dashId)

      Get(s"/panels/$panelId/query") ~> makeRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 for a non-existent panel" in {
      Get(s"/panels/nonexistent-id/query") ~> makeRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
