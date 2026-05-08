package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import com.helio.domain._
import com.helio.infrastructure._
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

class PanelExecuteRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var dashboardRepo: DashboardRepository           = _
  private var panelRepo: PanelRepository                   = _
  private var dataSourceRepo: DataSourceRepository         = _
  private var dataTypeRepo: DataTypeRepository             = _
  private var userRepo: UserRepository                     = _
  private var userPreferenceRepo: UserPreferenceRepository = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineRepo: PipelineRepository             = _
  private var pipelineStepRepo: PipelineStepRepository     = _
  private var sessionRepo: UserSessionRepository           = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    dashboardRepo      = new DashboardRepository(db)(typedSystem.executionContext)
    panelRepo          = new PanelRepository(db)(typedSystem.executionContext)
    dataSourceRepo     = new DataSourceRepository(db)(typedSystem.executionContext)
    dataTypeRepo       = new DataTypeRepository(db)(typedSystem.executionContext)
    userRepo           = new UserRepository(db)(typedSystem.executionContext)
    userPreferenceRepo = new UserPreferenceRepository(db)(typedSystem.executionContext)
    permissionRepo     = new ResourcePermissionRepository(db)(typedSystem.executionContext)
    pipelineRepo       = new PipelineRepository(db, dataTypeRepo, dataSourceRepo)(typedSystem.executionContext)
    pipelineStepRepo   = new PipelineStepRepository(db)(typedSystem.executionContext)
    import com.helio.domain.AuthenticatedUser
    val testUser = AuthenticatedUser(UserId(testUserId))
    val otherUser = AuthenticatedUser(UserId(otherUserId))
    sessionRepo = new UserSessionRepository {
      override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
        Future.successful(token match {
          case `testToken` => Some(testUser)
          case _           => None
        })
    }
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val testUserId = "00000000-0000-0000-0000-000000000099"
  private val otherUserId = "00000000-0000-0000-0000-000000000098"
  private val testToken  = "exec-test-token"

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE resource_permissions, user_sessions, users, panels, dashboards, data_types, data_sources RESTART IDENTITY CASCADE"))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($testUserId::uuid, 'exectest@helio.test', now())"""))
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit] = Future.successful(())
    def read(path: String): Future[Array[Byte]]               = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                    = Future.successful(())
    def exists(path: String): Future[Boolean]                 = Future.successful(false)
    def list(prefix: String): Future[Seq[String]]             = Future.successful(Seq.empty)
  }

  private def routes(): Route = {
    import org.apache.pekko.http.scaladsl.server.Directives.mapRequest
    mapRequest { req =>
      if (req.header[Authorization].isDefined) req
      else req.withHeaders(req.headers :+ Authorization(OAuth2BearerToken(testToken)))
    } {
      new ApiRoutes(
        dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo, stubFileSystem,
        new com.helio.domain.RestApiConnector(Some(_ => Future.successful(Left("no http")))),
        userRepo, sessionRepo, userPreferenceRepo, pipelineRepo, pipelineStepRepo,
        new PipelineRunCache(),
        new SparkJobSubmitter("local[*]", dataSourceRepo, pipelineRepo)(typedSystem.executionContext)
      ).routes
    }
  }

  private def makeStaticDataSource(): DataSource = DataSource(
    id         = DataSourceId(UUID.randomUUID().toString),
    name       = "exec-test-source",
    sourceType = SourceType.Static,
    config     = JsObject(
      "columns" -> JsArray(
        JsObject("name" -> JsString("price"), "type" -> JsString("double")),
        JsObject("name" -> JsString("name"),  "type" -> JsString("string"))
      ),
      "rows" -> JsArray(
        JsArray(JsNumber(10.0), JsString("widget")),
        JsArray(JsNumber(20.0), JsString("gadget"))
      )
    ),
    createdAt  = Instant.now(),
    updatedAt  = Instant.now(),
    ownerId    = UserId(testUserId)
  )

  private def makeDataType(sourceId: DataSourceId): DataType = DataType(
    id             = DataTypeId(UUID.randomUUID().toString),
    sourceId       = Some(sourceId),
    name           = "ExecTestType",
    fields         = Vector(DataField("price", "Price", "double", nullable = true), DataField("name", "Name", "string", nullable = true)),
    computedFields = Vector.empty,
    version        = 1,
    createdAt      = Instant.now(),
    updatedAt      = Instant.now(),
    ownerId        = UserId(testUserId)
  )

  "POST /api/panels/:id/execute" should {

    "return 200 with rows for a bound panel with a static data source" in {
      cleanDb()

      val ds = await(dataSourceRepo.insert(makeStaticDataSource()))
      val dt = await(dataTypeRepo.insert(makeDataType(ds.id)))

      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Exec Test Dashboard"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }

      var panelId = ""
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Price Panel"), None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }

      // Bind the panel to the data type with a field mapping
      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(
          title        = None,
          appearance   = None,
          `type`       = None,
          typeId       = Some(Some(dt.id.value)),
          fieldMapping = Some(Some(JsObject("value" -> JsString("price"), "label" -> JsString("name"))))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }

      Post(s"/api/panels/$panelId/execute") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        contentType shouldBe ContentTypes.`application/json`
        val response = responseAs[PanelExecuteResponse]
        response.rows should have size 2
        // selectedFields are ["price", "name"] from fieldMapping values
        response.rows.foreach { row =>
          row.fields.keys should contain allOf ("price", "name")
        }
      }
    }

    "return 404 for a non-existent panel" in {
      Post("/api/panels/does-not-exist/execute") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("Panel not found")
      }
    }

    "return 404 for an unbound panel (no typeId)" in {
      cleanDb()

      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("Unbound Test"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }

      var panelId = ""
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("Unbound Panel"), None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }

      Post(s"/api/panels/$panelId/execute") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "return 422 for an unsupported source type (rest_api)" in {
      cleanDb()

      val restDs = DataSource(
        id         = DataSourceId(UUID.randomUUID().toString),
        name       = "rest-exec-source",
        sourceType = SourceType.RestApi,
        config     = JsObject("url" -> JsString("https://example.com"), "method" -> JsString("GET"),
                              "auth" -> JsObject("type" -> JsString("none")), "headers" -> JsObject()),
        createdAt  = Instant.now(),
        updatedAt  = Instant.now(),
        ownerId    = UserId(testUserId)
      )
      val ds = await(dataSourceRepo.insert(restDs))
      val dt = await(dataTypeRepo.insert(makeDataType(ds.id)))

      var dashboardId = ""
      Post("/api/dashboards", CreateDashboardRequest(Some("REST Test"))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        dashboardId = responseAs[DashboardResponse].id
      }

      var panelId = ""
      Post("/api/panels", CreatePanelRequest(Some(dashboardId), Some("REST Panel"), None)) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        panelId = responseAs[PanelResponse].id
      }

      Patch(
        s"/api/panels/$panelId",
        UpdatePanelRequest(
          title        = None,
          appearance   = None,
          `type`       = None,
          typeId       = Some(Some(dt.id.value)),
          fieldMapping = Some(Some(JsObject("value" -> JsString("price"))))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }

      Post(s"/api/panels/$panelId/execute") ~> routes() ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[ErrorResponse].message should include("Unsupported source type")
      }
    }
  }
}
