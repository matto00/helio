package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.routes._
import com.helio.domain.{AuthenticatedUser, RestApiConfig, RestApiConnector, UserId}
import com.helio.infrastructure.{
  DashboardRepository,
  DataSourceRepository,
  DataTypeRepository,
  FileSystem,
  PanelRepository,
  PipelineRepository,
  PipelineStepRepository,
  ResourcePermissionRepository,
  SlickUserSessionRepository,
  UserPreferenceRepository,
  UserRepository,
  UserSessionRepository
}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json.JsValue

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

/** Integration tests covering computed-fields API surface:
 *  - PATCH /api/types/:id with valid computedFields
 *  - PATCH /api/types/:id with invalid expression → 400
 *  - GET  /api/types/:id includes computedFields
 *  - GET  /api/types/:id/validate-expression — all branches
 */
class ComputedFieldsRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres            = _
  private var db: JdbcBackend.Database                      = _
  private var dashboardRepo: DashboardRepository            = _
  private var panelRepo: PanelRepository                    = _
  private var dataSourceRepo: DataSourceRepository          = _
  private var dataTypeRepo: DataTypeRepository              = _
  private var userRepo: UserRepository                      = _
  private var userPreferenceRepo: UserPreferenceRepository  = _
  private var permissionRepo: ResourcePermissionRepository  = _
  private var pipelineRepo: PipelineRepository              = _
  private var pipelineStepRepo: PipelineStepRepository         = _

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
    pipelineRepo       = new PipelineRepository(db)(typedSystem.executionContext)
    pipelineStepRepo   = new PipelineStepRepository(db)(typedSystem.executionContext)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE user_sessions, users, panels, dashboards, data_types, data_sources RESTART IDENTITY CASCADE"))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ('00000000-0000-0000-0000-000000000099'::uuid, 'test@helio.test', now())"""))
  }

  private val testToken  = "valid-test-token"
  private val testUserId = "00000000-0000-0000-0000-000000000099"
  private val testUser   = AuthenticatedUser(UserId(testUserId))

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (token == testToken) Some(testUser) else None)
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]  = Future.successful(())
    def read(path: String): Future[Array[Byte]]                = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                     = Future.successful(())
    def exists(path: String): Future[Boolean]                  = Future.successful(false)
    def list(prefix: String): Future[Seq[String]]              = Future.successful(Seq.empty)
  }

  private def stubConnector(resp: Either[String, JsValue]): RestApiConnector =
    new RestApiConnector(Some(_ => Future.successful(resp)))

  private def routes(connector: RestApiConnector = stubConnector(Left("no-http"))): Route = {
    import org.apache.pekko.http.scaladsl.server.Directives.mapRequest
    mapRequest { req =>
      if (req.header[Authorization].isDefined) req
      else req.withHeaders(req.headers :+ Authorization(OAuth2BearerToken(testToken)))
    } {
      new ApiRoutes(
        dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo,
        stubFileSystem, connector, userRepo, stubSessionRepo, userPreferenceRepo, pipelineRepo, pipelineStepRepo
      ).routes
    }
  }

  /** Insert a DataType directly via the repository and return it. */
  private def insertType(fields: com.helio.domain.DataField*): com.helio.domain.DataType = {
    import com.helio.domain._
    val now = Instant.now()
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = None,
      name      = "TestType",
      fields    = fields.toVector,
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = UserId(testUserId)
    )
    await(dataTypeRepo.insert(dt))
  }

  // ── Task 3.2 tests ──────────────────────────────────────────────────────────

  "PATCH /api/types/:id with valid computedFields" should {

    "persist computed fields and return them in the response" in {
      cleanDb()
      import com.helio.domain.DataField
      val dt = insertType(
        DataField("price", "Price", "float", nullable = false),
        DataField("quantity", "Quantity", "integer", nullable = false)
      )

      Patch(
        s"/api/types/${dt.id.value}",
        UpdateDataTypeRequest(
          name   = None,
          fields = None,
          computedFields = Some(Vector(
            ComputedFieldPayload("total", "Total", "price * quantity", "float")
          ))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DataTypeResponse]
        response.computedFields should have size 1
        response.computedFields.head.name       shouldBe "total"
        response.computedFields.head.expression shouldBe "price * quantity"
      }
    }

    "increment version when only computedFields change" in {
      cleanDb()
      import com.helio.domain.DataField
      val dt = insertType(DataField("x", "X", "float", nullable = false))

      Patch(
        s"/api/types/${dt.id.value}",
        UpdateDataTypeRequest(
          name           = None,
          fields         = None,
          computedFields = Some(Vector(ComputedFieldPayload("doubled", "Doubled", "x * 2", "float")))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[DataTypeResponse].version shouldBe 2
      }
    }
  }

  "PATCH /api/types/:id with invalid expression" should {

    "return 400 when the expression references an unknown field" in {
      cleanDb()
      import com.helio.domain.DataField
      val dt = insertType(DataField("revenue", "Revenue", "float", nullable = false))

      Patch(
        s"/api/types/${dt.id.value}",
        UpdateDataTypeRequest(
          name           = None,
          fields         = None,
          computedFields = Some(Vector(ComputedFieldPayload("bad", "Bad", "nonexistent_field * 2", "float")))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("nonexistent_field")
      }
    }

    "return 400 for a syntax error in the expression" in {
      cleanDb()
      import com.helio.domain.DataField
      val dt = insertType(DataField("a", "A", "float", nullable = false))

      Patch(
        s"/api/types/${dt.id.value}",
        UpdateDataTypeRequest(
          name           = None,
          fields         = None,
          computedFields = Some(Vector(ComputedFieldPayload("broken", "Broken", "a ++ b", "float")))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "return 400 when the expression exceeds the maximum length" in {
      cleanDb()
      import com.helio.domain.DataField
      val dt = insertType(DataField("x", "X", "float", nullable = false))
      val longExpr = "x + " * 200  // well over 500 chars

      Patch(
        s"/api/types/${dt.id.value}",
        UpdateDataTypeRequest(
          name           = None,
          fields         = None,
          computedFields = Some(Vector(ComputedFieldPayload("toolong", "Too Long", longExpr, "float")))
        )
      ) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }

  "GET /api/types/:id" should {

    "include computedFields in the response (empty by default)" in {
      cleanDb()
      import com.helio.domain.DataField
      val dt = insertType(DataField("col1", "Column 1", "string", nullable = false))

      Get(s"/api/types/${dt.id.value}") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DataTypeResponse]
        response.computedFields shouldBe empty
      }
    }

    "return saved computedFields after a PATCH" in {
      cleanDb()
      import com.helio.domain.DataField
      val dt = insertType(DataField("price", "Price", "float", nullable = false))

      Patch(
        s"/api/types/${dt.id.value}",
        UpdateDataTypeRequest(
          name           = None,
          fields         = None,
          computedFields = Some(Vector(ComputedFieldPayload("doubled", "Doubled", "price * 2", "float")))
        )
      ) ~> routes() ~> check { status shouldBe StatusCodes.OK }

      Get(s"/api/types/${dt.id.value}") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val response = responseAs[DataTypeResponse]
        response.computedFields should have size 1
        response.computedFields.head.name shouldBe "doubled"
      }
    }
  }

  // ── Task 3.3 tests ──────────────────────────────────────────────────────────

  "GET /api/types/:id/validate-expression" should {

    "return valid=true for a syntactically correct expression with known fields" in {
      cleanDb()
      import com.helio.domain.DataField
      val dt = insertType(DataField("price", "Price", "float", nullable = false))

      Get(s"/api/types/${dt.id.value}/validate-expression?expr=price+*+2") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[ValidateExpressionResponse]
        resp.valid shouldBe true
        resp.message shouldBe None
      }
    }

    "return 200 with valid=false for an expression with a syntax error" in {
      cleanDb()
      import com.helio.domain.DataField
      val dt = insertType(DataField("x", "X", "float", nullable = false))

      Get(s"/api/types/${dt.id.value}/validate-expression?expr=x+%2B%2B+1") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[ValidateExpressionResponse]
        resp.valid shouldBe false
        resp.message shouldBe defined
      }
    }

    "return 200 with valid=false for an expression referencing an unknown field" in {
      cleanDb()
      import com.helio.domain.DataField
      val dt = insertType(DataField("known", "Known", "float", nullable = false))

      Get(s"/api/types/${dt.id.value}/validate-expression?expr=unknown_field") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[ValidateExpressionResponse]
        resp.valid shouldBe false
        resp.message shouldBe defined
        resp.message.get should include("unknown_field")
      }
    }

    "return 404 when the DataType does not exist" in {
      Get(s"/api/types/does-not-exist/validate-expression?expr=1+%2B+1") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse] shouldBe ErrorResponse("DataType not found")
      }
    }
  }
}
