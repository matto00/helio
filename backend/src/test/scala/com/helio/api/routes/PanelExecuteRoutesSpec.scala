package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, PanelRepository}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

class PanelExecuteRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var panelRepo: PanelRepository         = _
  private var dataTypeRepo: DataTypeRepository   = _
  private var dataSourceRepo: DataSourceRepository = _

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))
  private val ownerId   = "00000000-0000-0000-0000-000000000001"

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    panelRepo      = new PanelRepository(db)(routeEc)
    dataTypeRepo   = new DataTypeRepository(db)(routeEc)
    dataSourceRepo = new DataSourceRepository(db)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def makeRoutes(): Route = {
    implicit val ec: ExecutionContext = routeEc
    new PanelExecuteRoutes(panelRepo, dataTypeRepo, dataSourceRepo, dummyUser).routes
  }

  // ── Seed helpers ─────────────────────────────────────────────────────────────

  private def seedUser(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""
      INSERT INTO users (id, email, created_at)
      VALUES ('#$ownerId'::uuid, 'execute-test@helio.dev', now())
      ON CONFLICT DO NOTHING"""))
  }

  private def seedDashboard(): String = {
    import PostgresProfile.api._
    val dashId = java.util.UUID.randomUUID().toString
    await(db.run(sqlu"""
      INSERT INTO dashboards (id, name, owner_id, created_by, appearance, layout, created_at, last_updated)
      VALUES ($dashId, 'ExecTest', '#$ownerId'::uuid, $ownerId,
              '{"background":"transparent","gridBackground":"transparent"}',
              '{"lg":[],"md":[],"sm":[],"xs":[]}', now(), now())"""))
    dashId
  }

  /** Seed a SQL DataSource whose config points to the embedded Postgres itself. */
  private def seedSqlDataSource(): String = {
    import PostgresProfile.api._
    val dsId      = java.util.UUID.randomUUID().toString
    val jdbcUrl   = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    // Extract host/port/db from the JDBC URL for SqlSourceConfig
    // URL format: jdbc:postgresql://localhost:<port>/postgres
    val portRegex = """jdbc:postgresql://[^:]+:(\d+)/(\S+)""".r
    val (port, dbName) = jdbcUrl match {
      case portRegex(p, d) => (p.toInt, d)
      case _               => (5432, "postgres")
    }
    val config = s"""{"dialect":"postgresql","host":"localhost","port":$port,"database":"$dbName","user":"postgres","password":"","query":"SELECT 1 AS n"}"""
    await(db.run(sqlu"""
      INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'EmbeddedSQL', 'sql', $config, '#$ownerId'::uuid, now(), now())"""))
    dsId
  }

  /** Seed a SQL DataSource with a custom query (e.g. for generating rows). */
  private def seedSqlDataSourceWithQuery(query: String): String = {
    import PostgresProfile.api._
    val dsId      = java.util.UUID.randomUUID().toString
    val jdbcUrl   = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    val portRegex = """jdbc:postgresql://[^:]+:(\d+)/(\S+)""".r
    val (port, dbName) = jdbcUrl match {
      case portRegex(p, d) => (p.toInt, d)
      case _               => (5432, "postgres")
    }
    val escapedQuery = query.replace("\"", "\\\"")
    val config = s"""{"dialect":"postgresql","host":"localhost","port":$port,"database":"$dbName","user":"postgres","password":"","query":"$escapedQuery"}"""
    await(db.run(sqlu"""
      INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'EmbeddedSQL2', 'sql', $config, '#$ownerId'::uuid, now(), now())"""))
    dsId
  }

  private def seedDataType(sourceId: String): String = {
    import PostgresProfile.api._
    val dtId = java.util.UUID.randomUUID().toString
    await(db.run(sqlu"""
      INSERT INTO data_types (id, name, fields, source_id, version, owner_id, created_at, updated_at)
      VALUES ($dtId, 'ExecType', '[]', $sourceId, 1, '#$ownerId'::uuid, now(), now())"""))
    dtId
  }

  private def seedBoundPanel(dashId: String, dtId: String): String = {
    import PostgresProfile.api._
    val panelId    = java.util.UUID.randomUUID().toString
    val appearance = """{"background":"transparent","color":"inherit","transparency":0.0}"""
    await(db.run(sqlu"""
      INSERT INTO panels (id, dashboard_id, title, type, owner_id, appearance,
                          type_id, created_by, created_at, last_updated)
      VALUES ($panelId, $dashId, 'Exec Panel', 'table', '#$ownerId'::uuid, $appearance,
              $dtId, $ownerId, now(), now())"""))
    panelId
  }

  private def seedUnboundPanel(dashId: String): String = {
    import PostgresProfile.api._
    val panelId    = java.util.UUID.randomUUID().toString
    val appearance = """{"background":"transparent","color":"inherit","transparency":0.0}"""
    await(db.run(sqlu"""
      INSERT INTO panels (id, dashboard_id, title, type, owner_id, appearance,
                          created_by, created_at, last_updated)
      VALUES ($panelId, $dashId, 'Unbound Panel', 'table', '#$ownerId'::uuid, $appearance,
              $ownerId, now(), now())"""))
    panelId
  }

  // ── Tests ─────────────────────────────────────────────────────────────────────

  "GET /panels/:id/execute" should {

    "return 400 for invalid pageSize (too large)" in {
      Get("/panels/any-id/execute?pageSize=501") ~> makeRoutes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("pageSize")
      }
    }

    "return 400 for invalid pageSize (zero)" in {
      Get("/panels/any-id/execute?pageSize=0") ~> makeRoutes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("pageSize")
      }
    }

    "return 400 for negative page" in {
      Get("/panels/any-id/execute?page=-1") ~> makeRoutes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("page")
      }
    }

    "return 404 for a non-existent panel" in {
      Get("/panels/nonexistent-panel-id/execute") ~> makeRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 404 for an unbound panel" in {
      seedUser()
      val dashId  = seedDashboard()
      val panelId = seedUnboundPanel(dashId)

      Get(s"/panels/$panelId/execute") ~> makeRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse].message should include("bound")
      }
    }

    "return 200 with PaginatedQueryResult for a SQL-backed bound panel (first page)" in {
      seedUser()
      val dashId  = seedDashboard()
      val dsId    = seedSqlDataSource()
      val dtId    = seedDataType(dsId)
      val panelId = seedBoundPanel(dashId, dtId)

      Get(s"/panels/$panelId/execute?page=0&pageSize=50") ~> makeRoutes() ~> check {
        status shouldBe StatusCodes.OK
        val result = responseAs[PaginatedQueryResult]
        result.page     shouldBe 0
        result.pageSize shouldBe 50
        result.rows.length should be >= 1
      }
    }

    "return hasMore: false when all rows fit in the first page" in {
      seedUser()
      val dashId  = seedDashboard()
      // Query produces exactly 3 rows; pageSize=50 so hasMore should be false
      val query   = "SELECT n FROM generate_series(1,3) AS t(n)"
      val dsId    = seedSqlDataSourceWithQuery(query)
      val dtId    = seedDataType(dsId)
      val panelId = seedBoundPanel(dashId, dtId)

      Get(s"/panels/$panelId/execute?page=0&pageSize=50") ~> makeRoutes() ~> check {
        status shouldBe StatusCodes.OK
        val result = responseAs[PaginatedQueryResult]
        result.hasMore  shouldBe false
        result.rows.length shouldBe 3
      }
    }

    "return hasMore: true when more rows exist beyond the page" in {
      seedUser()
      val dashId  = seedDashboard()
      // Query produces 10 rows; pageSize=5 so hasMore should be true
      val query   = "SELECT n FROM generate_series(1,10) AS t(n)"
      val dsId    = seedSqlDataSourceWithQuery(query)
      val dtId    = seedDataType(dsId)
      val panelId = seedBoundPanel(dashId, dtId)

      Get(s"/panels/$panelId/execute?page=0&pageSize=5") ~> makeRoutes() ~> check {
        status shouldBe StatusCodes.OK
        val result = responseAs[PaginatedQueryResult]
        result.hasMore     shouldBe true
        result.rows.length shouldBe 5
      }
    }
  }
}
