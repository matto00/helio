package com.helio.services

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.protocols.{StaticColumnPayload, StaticDataPayload, StaticDataSourceRequest, UpdateDataSourceRequest}
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, DbContext, LocalFileSystem}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json.{JsNumber, JsString, JsValue}

import java.net.InetAddress
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Service-level coverage for `DataSourceService`, focused on the cycle-2
 *  Fix D refresh-upsert behaviour: refresh against a CSV / Static source
 *  whose linked DataType is missing must re-create the DT (instead of the
 *  pre-fix silent no-op), and a CSV refresh against a missing file must
 *  surface an actionable BadRequest. */
class DataSourceServiceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataTypeRepo: DataTypeRepository   = _
  private var dataSourceRepo: DataSourceRepository = _
  private var fileSystem: LocalFileSystem        = _
  private var service: DataSourceService         = _

  // Local test server for text-source URL-ingestion tests (HEL-215) — avoids
  // hitting real network while still exercising `ContentSourceSupport.fetchUrl`
  // end-to-end. `huge.txt` is one byte over the default 10 MB
  // `TEXT_MAX_FILE_SIZE_BYTES` limit, for the oversized-URL-fetch scenario.
  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                   = _
  private def urlFor(path: String): String = s"http://localhost:$testServerPort/$path"

  // SSRF guard (HEL-215 cycle-2 fix, DNS-rebinding TOCTOU closed in cycle 3):
  // `ContentSourceSupport.fetchUrl` rejects loopback addresses by default,
  // which `localhost` resolves to — so the real, unmodified guard would
  // block this suite's own test server. Since cycle 3, `fetchUrl` pins the
  // actual TCP connection to whatever `resolveHost` resolves, so a resolver
  // that *lies* about the resolved address (the pre-cycle-3 pattern here)
  // would break the real HTTP fetch instead of just faking past validation.
  // Real DNS (`defaultResolveHost`, used unmodified below) already resolves
  // "localhost" correctly, so the only override needed is admitting that one
  // known-safe hostname past the (hostname-keyed) `isBlocked` denylist check
  // — every other host, including any literal address a test supplies
  // directly, e.g. `127.0.0.1`/`169.254.169.254`, still goes through the
  // real, unmodified `ContentSourceSupport.isBlockedAddress`.
  private def testIsBlocked(host: String, addr: InetAddress): Boolean =
    if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  private val owner = UserId(UUID.randomUUID().toString)
  private val user  = AuthenticatedUser(owner)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)
    dataTypeRepo   = new DataTypeRepository(ctx)
    dataSourceRepo = new DataSourceRepository(ctx)
    val tmpDir     = Files.createTempDirectory("helio-data-source-service-spec")
    fileSystem     = new LocalFileSystem(tmpDir)
    service = new DataSourceService(
      dataSourceRepo, dataTypeRepo, fileSystem,
      isBlocked = testIsBlocked
    )

    val testRoutes =
      concat(
        path("notes.txt") {
          get { complete(HttpEntity(ContentTypes.`text/plain(UTF-8)`, "Hello from URL")) }
        },
        path("huge.txt") {
          get {
            val bytes = Array.fill[Byte](10485761)(0x41.toByte)
            complete(HttpEntity(ContentTypes.`text/plain(UTF-8)`, bytes))
          }
        },
        path("missing.txt") {
          get { complete(StatusCodes.NotFound) }
        }
      )
    testServerBinding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(testRoutes), 10.seconds)
    testServerPort = testServerBinding.localAddress.getPort
  }

  override def afterAll(): Unit = {
    Await.ready(testServerBinding.unbind(), 10.seconds)
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE data_types, data_sources RESTART IDENTITY CASCADE"))
  }

  private def createCsvSource(content: String, name: String = "Sales CSV"): DataSource = {
    val bytes = content.getBytes(StandardCharsets.UTF_8)
    await(service.createCsv(name, bytes, Vector.empty, user)) match {
      case Right(src) => src
      case Left(err)  => fail(s"createCsv failed: $err")
    }
  }

  "DataSourceService.refresh (CSV)" should {

    "update the linked DataType when present" in {
      cleanDb()
      val src = createCsvSource("a,b\n1,2\n3,4")

      val result = await(service.refresh(src.id, None, user))

      result.isRight shouldBe true
      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts should have size 1
      dts.head.fields.map(_.name) should contain allOf ("a", "b")
    }

    "re-create the linked DataType when missing (Fix D)" in {
      cleanDb()
      val src = createCsvSource("col1,col2\n1,2")
      // Simulate the orphan scenario: delete the DT row directly (bypassing
      // the Fix-B′ guard at the service layer).
      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts.foreach(dt => await(dataTypeRepo.delete(dt.id, user)))
      await(dataTypeRepo.findBySourceId(src.id, owner)) shouldBe empty

      val result = await(service.refresh(src.id, None, user))

      result.isRight shouldBe true
      val recreated = await(dataTypeRepo.findBySourceId(src.id, owner))
      recreated should have size 1
      recreated.head.sourceId shouldBe Some(src.id)
      recreated.head.fields.map(_.name) should contain allOf ("col1", "col2")
    }

    "return BadRequest with an actionable message when the source file is missing" in {
      cleanDb()
      val src = createCsvSource("x\n1")
      // Wipe the underlying file so the refresh read fails with NoSuchFileException.
      src match {
        case c: CsvSource => await(fileSystem.delete(c.config.path))
        case _ => fail("expected CsvSource")
      }

      val result = await(service.refresh(src.id, None, user))

      result match {
        case Left(ServiceError.BadRequest(msg)) =>
          msg should include("missing on disk")
          msg should include("re-upload")
        case other => fail(s"Expected BadRequest, got: $other")
      }
    }
  }

  "DataSourceService.refresh (Static)" should {

    "re-create the linked DataType when missing (Fix D)" in {
      cleanDb()
      val createReq = StaticDataSourceRequest(
        name    = "Lookup",
        `type`  = "static",
        columns = Vector(StaticColumnPayload("id", "integer")),
        rows    = Vector(Vector(JsNumber(1)))
      )
      val src = await(service.createStatic(createReq, user)) match {
        case Right(s) => s
        case Left(e)  => fail(s"createStatic failed: $e")
      }
      // Orphan: delete the linked DT.
      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts.foreach(dt => await(dataTypeRepo.delete(dt.id, user)))

      val refreshPayload = StaticDataPayload(
        columns = Vector(StaticColumnPayload("id", "integer"), StaticColumnPayload("label", "string")),
        rows    = Vector(Vector[JsValue](JsNumber(1), JsString("Alice")))
      )
      val result = await(service.refresh(src.id, Some(refreshPayload), user))

      result.isRight shouldBe true
      val recreated = await(dataTypeRepo.findBySourceId(src.id, owner))
      recreated should have size 1
      recreated.head.sourceId shouldBe Some(src.id)
      recreated.head.fields.map(_.name) should contain allOf ("id", "label")
    }
  }

  // ── HEL-215: text/Markdown connector ────────────────────────────────────────

  "DataSourceService.createTextUpload" should {

    "create a DataSource + DataType for a valid .txt upload" in {
      cleanDb()
      val bytes = "hello world".getBytes(StandardCharsets.UTF_8)
      val result = await(service.createTextUpload("Notes", bytes, "notes.txt", user))

      result.isRight shouldBe true
      val src = result.toOption.get
      src.kind shouldBe "text"
      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts should have size 1
      dts.head.fields.map(_.name) should contain allOf ("content", "filename", "sizeBytes")
      dts.head.fields.find(_.name == "content").map(_.dataType) shouldBe Some("string-body")
    }

    "create a DataSource for a valid .md upload" in {
      cleanDb()
      val bytes  = "# Title".getBytes(StandardCharsets.UTF_8)
      val result = await(service.createTextUpload("Readme", bytes, "README.md", user))
      result.isRight shouldBe true
      result.toOption.get.kind shouldBe "text"
    }

    "reject an unsupported extension with BadRequest" in {
      cleanDb()
      val bytes  = "col\n1".getBytes(StandardCharsets.UTF_8)
      val result = await(service.createTextUpload("Bad Ext", bytes, "data.csv", user))
      result match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("Unsupported file extension")
        case other                              => fail(s"Expected BadRequest, got: $other")
      }
    }

    "reject an oversized upload with PayloadTooLarge" in {
      cleanDb()
      val bytes  = Array.fill[Byte](10485761)(0x41.toByte)
      val result = await(service.createTextUpload("Too Big", bytes, "big.txt", user))
      result match {
        case Left(ServiceError.PayloadTooLarge(msg)) => msg should include("maximum allowed size")
        case other                                   => fail(s"Expected PayloadTooLarge, got: $other")
      }
    }

    "reject non-UTF-8 content with BadRequest" in {
      cleanDb()
      val bytes  = Array[Byte](0xff.toByte, 0xfe.toByte, 0x00.toByte)
      val result = await(service.createTextUpload("Bad Encoding", bytes, "notes.txt", user))
      result match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("UTF-8")
        case other                              => fail(s"Expected BadRequest, got: $other")
      }
    }
  }

  "DataSourceService.createTextUrl" should {

    "fetch the URL and create a DataSource + DataType with sourceUrl set" in {
      cleanDb()
      val url    = urlFor("notes.txt")
      val result = await(service.createTextUrl("URL Notes", url, user))
      result.isRight shouldBe true
      result.toOption.get match {
        case t: TextSource => t.config.sourceUrl shouldBe Some(url)
        case other         => fail(s"expected TextSource, got: $other")
      }
      val dts = await(dataTypeRepo.findBySourceId(result.toOption.get.id, owner))
      dts.head.fields.map(_.name) should contain allOf ("content", "filename", "sizeBytes")
    }

    "return BadGateway when the URL cannot be fetched" in {
      cleanDb()
      val result = await(service.createTextUrl("Missing", urlFor("missing.txt"), user))
      result match {
        case Left(ServiceError.BadGateway(_)) => succeed
        case other                            => fail(s"Expected BadGateway, got: $other")
      }
    }

    "return PayloadTooLarge when the fetched content exceeds the max size" in {
      cleanDb()
      val result = await(service.createTextUrl("Huge", urlFor("huge.txt"), user))
      result match {
        case Left(ServiceError.PayloadTooLarge(_)) => succeed
        case other                                 => fail(s"Expected PayloadTooLarge, got: $other")
      }
    }

    // HEL-215 cycle-2 SSRF fix. Even though this spec's `testIsBlocked`
    // permits the "localhost" hostname (to unblock its own test server),
    // these literal blocked addresses/schemes bypass that special-case
    // entirely (they're not the string "localhost") and fall through to the
    // real `ContentSourceSupport.isBlockedAddress` — proving the guard is
    // still live end-to-end through the service for any attacker-supplied
    // host, not just disabled wholesale by the test override.
    "reject a loopback URL (127.0.0.1) before issuing any request" in {
      cleanDb()
      val result = await(service.createTextUrl("SSRF loopback", "http://127.0.0.1:1/x", user))
      result match {
        case Left(ServiceError.BadGateway(msg)) => msg should include("disallowed address")
        case other                              => fail(s"Expected BadGateway (blocked), got: $other")
      }
    }

    "reject the GCP metadata address (169.254.169.254)" in {
      cleanDb()
      val result = await(service.createTextUrl("SSRF metadata", "http://169.254.169.254/computeMetadata/v1/", user))
      result match {
        case Left(ServiceError.BadGateway(msg)) => msg should include("disallowed address")
        case other                              => fail(s"Expected BadGateway (blocked), got: $other")
      }
    }

    "reject a non-http(s) scheme before resolving the host" in {
      cleanDb()
      val result = await(service.createTextUrl("SSRF scheme", "file:///etc/passwd", user))
      result match {
        case Left(ServiceError.BadGateway(msg)) => msg should include("scheme")
        case other                              => fail(s"Expected BadGateway (blocked), got: $other")
      }
    }
  }

  "DataSourceService.refresh (Text)" should {

    "re-read the stored file for an upload-created text source" in {
      cleanDb()
      val bytes = "v1".getBytes(StandardCharsets.UTF_8)
      val src   = await(service.createTextUpload("Refreshable", bytes, "notes.txt", user)).toOption.get

      val result = await(service.refresh(src.id, None, user))
      result.isRight shouldBe true
      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts should have size 1
    }

    "re-fetch the URL for a URL-created text source and overwrite the stored file" in {
      cleanDb()
      val src = await(service.createTextUrl("URL Refreshable", urlFor("notes.txt"), user)).toOption.get
        .asInstanceOf[TextSource]

      val result = await(service.refresh(src.id, None, user))
      result.isRight shouldBe true
      val storedBytes = await(fileSystem.read(src.config.path))
      new String(storedBytes, StandardCharsets.UTF_8) shouldBe "Hello from URL"
    }
  }

  "DataSourceService.delete (Text)" should {

    "remove the data source record and the stored file" in {
      cleanDb()
      val bytes = "to-delete".getBytes(StandardCharsets.UTF_8)
      val src   = await(service.createTextUpload("Deletable", bytes, "notes.txt", user)).toOption.get
        .asInstanceOf[TextSource]

      val result = await(service.delete(src.id, user))
      result.isRight shouldBe true
      await(fileSystem.exists(src.config.path)) shouldBe false
    }
  }

  "DataSourceService.update (Text)" should {

    "rename a text source without throwing (regression: DataSourceService.update's closed match)" in {
      cleanDb()
      val bytes = "content".getBytes(StandardCharsets.UTF_8)
      val src   = await(service.createTextUpload("Original Name", bytes, "notes.txt", user)).toOption.get

      val result = await(service.update(src.id, UpdateDataSourceRequest(Some("Renamed")), user))
      result.isRight shouldBe true
      result.toOption.get.name shouldBe "Renamed"
    }
  }
}
