package com.helio.api

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import com.helio.domain.{AuthenticatedUser, RestApiConnector, UserId}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.infrastructure.{
  DashboardRepository,
  DataSourceRepository,
  DataTypeRepository,
  DbContext,
  ImageUploadRepository,
  LocalFileSystem,
  PanelRepository,
  PipelineRepository,
  PipelineStepRepository,
  ResourcePermissionRepository,
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

import java.nio.file.Files
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

/** Route-level coverage for HEL-246: `POST /api/uploads/image` (authenticated)
 *  and `GET /api/uploads/image/:id` (unauthenticated) — mirrors
 *  `DataSourceRoutesSpec`'s multipart-upload test pattern. */
class UploadRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var dataSourceRepo: DataSourceRepository         = _
  private var dataTypeRepo: DataTypeRepository             = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var imageUploadRepo: ImageUploadRepository       = _
  private var fileSystem: LocalFileSystem                  = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))

    val ec  = typedSystem.executionContext
    val ctx = new DbContext(db, db)(ec)
    dataSourceRepo  = new DataSourceRepository(ctx)(ec)
    dataTypeRepo    = new DataTypeRepository(ctx)(ec)
    permissionRepo  = new ResourcePermissionRepository(ctx)(ec)
    imageUploadRepo = new ImageUploadRepository(ctx)(ec)

    val tmpDir = Files.createTempDirectory("helio-upload-test")
    fileSystem = new LocalFileSystem(tmpDir)(ec)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE image_uploads RESTART IDENTITY CASCADE"))
  }

  private val stubConnector: RestApiConnector =
    new RestApiConnector(Some(_ => Future.successful(Left("no real HTTP in tests"))))

  private val testToken  = "upload-spec-test-token"
  private val testUserId = "b0000000-0000-0000-0000-000000000001"
  private val testUser   = AuthenticatedUser(UserId(testUserId))

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (token == testToken) Some(testUser) else None)
  }

  /** Authenticated routes (default: attaches the test session cookie + CSRF
   *  header unless the request already carries a `helio_session` cookie —
   *  used by the "unauthenticated" scenarios below to send a request with
   *  neither. HEL-287: session auth moved from an `Authorization` bearer
   *  header to a cookie. */
  private def routes(): Route = {
    val ec                 = typedSystem.executionContext
    val ctx                = new DbContext(db, db)(ec)
    val dashboardRepo      = new DashboardRepository(ctx)(ec)
    val panelRepo          = new PanelRepository(ctx)(ec)
    val userRepo           = new UserRepository(db)(ec)
    val userPreferenceRepo = new UserPreferenceRepository(db)(ec)
    val pipelineRepo       = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(ec)
    val pipelineStepRepo   = new PipelineStepRepository(ctx)(ec)
    mapRequest { req =>
      val withCookie =
        if (req.header[Cookie].exists(_.cookies.exists(_.name == SessionCookies.Name))) req
        else req.withHeaders(req.headers :+ Cookie(SessionCookies.Name -> testToken))
      if (withCookie.headers.exists(_.is(AuthDirectives.CsrfHeaderName.toLowerCase))) withCookie
      else withCookie.withHeaders(withCookie.headers :+ RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue))
    } {
      new ApiRoutes(
        dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo, fileSystem, stubConnector, userRepo,
        stubSessionRepo, userPreferenceRepo, pipelineRepo, pipelineStepRepo, new PipelineRunCache(),
        new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext),
        imageUploadRepo = imageUploadRepo
      ).routes
    }
  }

  /** Route request with no `Authorization` header at all — bypasses the
   *  `mapRequest` default-token injection above so unauthenticated scenarios
   *  are exercised for real. */
  private def unauthenticatedRoutes(): Route = {
    val ec                 = typedSystem.executionContext
    val ctx                = new DbContext(db, db)(ec)
    val dashboardRepo      = new DashboardRepository(ctx)(ec)
    val panelRepo          = new PanelRepository(ctx)(ec)
    val userRepo           = new UserRepository(db)(ec)
    val userPreferenceRepo = new UserPreferenceRepository(db)(ec)
    val pipelineRepo       = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(ec)
    val pipelineStepRepo   = new PipelineStepRepository(ctx)(ec)
    new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, dataTypeRepo, permissionRepo, fileSystem, stubConnector, userRepo,
      stubSessionRepo, userPreferenceRepo, pipelineRepo, pipelineStepRepo, new PipelineRunCache(),
      new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext),
      imageUploadRepo = imageUploadRepo
    ).routes
  }

  private def imageBytes(marker: Byte = 0x41): Array[Byte] = Array.fill(64)(marker)

  private def imageUpload(bytes: Array[Byte], filename: String): Multipart.FormData =
    Multipart.FormData(
      Multipart.FormData.BodyPart.Strict(
        "file",
        HttpEntity(ContentTypes.`application/octet-stream`, bytes),
        Map("filename" -> filename)
      )
    )

  "POST /api/uploads/image" should {

    for (ext <- Seq("png", "jpg", "jpeg", "gif", "webp")) {
      s"return 201 with an id and url for a valid .$ext upload" in {
        cleanDb()
        Post("/api/uploads/image", imageUpload(imageBytes(), s"photo.$ext")) ~> routes() ~> check {
          status shouldBe StatusCodes.Created
          val body = responseAs[ImageUploadResponse]
          body.id should not be empty
          body.url shouldBe s"/api/uploads/image/${body.id}"
        }
      }
    }

    "return 400 when the file part is missing" in {
      cleanDb()
      val noFile = Multipart.FormData(
        Multipart.FormData.BodyPart.Strict("other", HttpEntity(ContentTypes.`text/plain(UTF-8)`, "x"))
      )
      Post("/api/uploads/image", noFile) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("file is required")
      }
    }

    "return 400 for an unsupported extension" in {
      cleanDb()
      Post("/api/uploads/image", imageUpload(imageBytes(), "document.pdf")) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("Unsupported file extension")
      }
    }

    "return 413 when the file exceeds the default size limit" in {
      cleanDb()
      val oversized = Array.fill[Byte](10485761)(0x41.toByte) // one byte over the 10 MB default
      Post("/api/uploads/image", imageUpload(oversized, "big.png")) ~> routes() ~> check {
        status shouldBe StatusCodes.RequestEntityTooLarge
      }
    }

    "return 201 for a file exactly at the default size limit" in {
      cleanDb()
      val atLimit = Array.fill[Byte](10485760)(0x41.toByte)
      Post("/api/uploads/image", imageUpload(atLimit, "exact.png")) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
      }
    }

    "return 401 when no Authorization header is present" in {
      cleanDb()
      Post("/api/uploads/image", imageUpload(imageBytes(), "photo.png")) ~> unauthenticatedRoutes() ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }
  }

  "GET /api/uploads/image/:id" should {

    "serve the original bytes and recorded Content-Type for a valid id, with no Authorization header" in {
      cleanDb()
      var uploadId = ""
      val bytes    = imageBytes(0x42)
      Post("/api/uploads/image", imageUpload(bytes, "photo.png")) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        uploadId = responseAs[ImageUploadResponse].id
      }

      Get(s"/api/uploads/image/$uploadId") ~> unauthenticatedRoutes() ~> check {
        status shouldBe StatusCodes.OK
        contentType.mediaType shouldBe MediaTypes.`image/png`
        // `responseAs[Array[Byte]]` resolves to a spray-json-backed unmarshaller
        // here (this suite mixes in `JsonProtocols`/`SprayJsonSupport`), which
        // rejects a non-JSON Content-Type — read the already-strict entity's
        // bytes directly instead of going through implicit unmarshalling.
        response.entity.asInstanceOf[HttpEntity.Strict].data.toArray shouldBe bytes
      }
    }

    "return 404 for an id that was never uploaded" in {
      cleanDb()
      Get("/api/uploads/image/does-not-exist") ~> unauthenticatedRoutes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
