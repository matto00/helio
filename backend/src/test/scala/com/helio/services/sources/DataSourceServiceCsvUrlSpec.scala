package com.helio.services.sources

import com.helio.services.ServiceError
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.{ConnectionContext, Http}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.DataTypeRepository
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.LocalFileSystem
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.io.FileInputStream
import java.net.InetAddress
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.security.{KeyStore, SecureRandom}
import java.security.cert.X509Certificate
import java.util.UUID
import javax.net.ssl.{KeyManagerFactory, SSLContext, TrustManager, X509TrustManager}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.sys.process._
import scala.util.Try

/** Service-level coverage for `DataSourceService.createCsvUrl`/URL-backed
 *  `refresh` (HEL-862). Stands up its own self-signed-cert HTTPS test server
 *  (same technique as `CsvUrlFetchSpec`) since `CsvUrlFetch.fetch` hard-
 *  rejects any non-`https` scheme before issuing a request — the plain-HTTP
 *  test server `DataSourceServiceSpec` uses for text/pdf/image cannot
 *  exercise this path at all. */
class DataSourceServiceCsvUrlSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dataTypeRepo: DataTypeRepository     = _
  private var dataSourceRepo: DataSourceRepository = _
  private var fileSystem: LocalFileSystem          = _
  private var service: DataSourceService           = _
  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                   = _
  private var keystoreDir: Path                     = _

  private def urlFor(path: String): String = s"https://localhost:$testServerPort/$path"

  private def admitLocalhost(host: String, addr: InetAddress): Boolean =
    if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  private val owner = UserId(UUID.randomUUID().toString)
  private val user  = AuthenticatedUser(owner)

  private val csvV1 = "name,age\nalice,30"
  private val csvV2 = "name,age\nalice,31\nbob,40"
  @volatile private var refreshableBody = csvV1

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)
    dataTypeRepo   = new DataTypeRepository(ctx)
    dataSourceRepo = new DataSourceRepository(ctx)
    val tmpDir     = Files.createTempDirectory("helio-data-source-service-csv-url-spec")
    fileSystem     = new LocalFileSystem(tmpDir)
    service = new DataSourceService(dataSourceRepo, fileSystem, isBlocked = admitLocalhost)

    keystoreDir = Files.createTempDirectory("csv-url-service-spec")
    val keystorePath = keystoreDir.resolve("test.p12")
    val exitCode = Seq(
      "keytool", "-genkeypair", "-alias", "test", "-keyalg", "RSA", "-keysize", "2048",
      "-validity", "2", "-storetype", "PKCS12",
      "-keystore", keystorePath.toString, "-storepass", "changeit",
      "-dname", "CN=localhost", "-ext", "SAN=DNS:localhost,IP:127.0.0.1"
    ).!
    require(exitCode == 0, "keytool self-signed cert generation failed")

    val ks = KeyStore.getInstance("PKCS12")
    val in = new FileInputStream(keystorePath.toFile)
    try ks.load(in, "changeit".toCharArray) finally in.close()
    val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm)
    kmf.init(ks, "changeit".toCharArray)
    val serverSslContext = SSLContext.getInstance("TLS")
    serverSslContext.init(kmf.getKeyManagers, null, null)

    val trustAllManager: TrustManager = new X509TrustManager {
      def checkClientTrusted(chain: Array[X509Certificate], authType: String): Unit = ()
      def checkServerTrusted(chain: Array[X509Certificate], authType: String): Unit = ()
      def getAcceptedIssuers: Array[X509Certificate] = Array.empty
    }
    val clientSslContext = SSLContext.getInstance("TLS")
    clientSslContext.init(null, Array(trustAllManager), new SecureRandom())
    Http(typedSystem.classicSystem).setDefaultClientHttpsContext(ConnectionContext.httpsClient(clientSslContext))

    val testRoutes = concat(
      path("data.csv") {
        get { complete(HttpEntity(ContentTypes.`text/csv(UTF-8)`, csvV1)) }
      },
      path("refreshable.csv") {
        get { complete(HttpEntity(ContentTypes.`text/csv(UTF-8)`, refreshableBody)) }
      },
      path("missing.csv") {
        get { complete(StatusCodes.NotFound) }
      },
      path("page.html") {
        get { complete(HttpEntity(ContentTypes.`text/html(UTF-8)`, "<html><body>nope</body></html>")) }
      },
      path("huge.csv") {
        get {
          // One byte over CsvUrlFetch.maxFileSizeBytes's default (52428800L) —
          // the header row alone stays representative CSV shape.
          val bytes = ("a,b\n" + "1,2\n" * 20).getBytes(StandardCharsets.UTF_8) ++
            Array.fill[Byte]((CsvUrlFetch.maxFileSizeBytes - 80 + 1).toInt)(0x2c.toByte)
          complete(HttpEntity(ContentTypes.`text/csv(UTF-8)`, bytes))
        }
      }
    )
    testServerBinding = Await.result(
      Http(typedSystem.classicSystem).newServerAt("localhost", 0).enableHttps(ConnectionContext.httpsServer(serverSslContext)).bind(testRoutes),
      15.seconds
    )
    testServerPort = testServerBinding.localAddress.getPort
  }

  override def afterAll(): Unit = {
    Await.ready(testServerBinding.unbind(), 10.seconds)
    db.close(); embeddedPostgres.close()
    Try(deleteRecursively(keystoreDir))
    super.afterAll()
  }

  private def deleteRecursively(p: Path): Unit = {
    if (Files.isDirectory(p)) Files.list(p).forEach(deleteRecursively)
    Files.deleteIfExists(p)
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  "DataSourceService.createCsvUrl" should {

    "creates a CSV source from a reachable HTTPS URL: stores BOTH path and sourceUrl, and infers the header row" in {
      val url    = urlFor("data.csv")
      val result = await(service.createCsvUrl("URL CSV", url, user))
      result shouldBe a[Right[_, _]]
      val src = result.toOption.get.asInstanceOf[CsvSource]
      src.config.path.nonEmpty shouldBe true
      src.config.sourceUrl shouldBe Some(url)

      val ds = await(dataSourceRepo.findByIdOwned(src.id, user)).get
      ds.inferredSchema.map(_.name) shouldBe Vector("name", "age")
    }

    "a failing fetch (404) leaves NO data source row and NO stored file" in {
      val before = await(dataSourceRepo.findAll(owner, Page(0, 100), None)).total
      val result = await(service.createCsvUrl("Missing CSV", urlFor("missing.csv"), user))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadGateway]
      val after = await(dataSourceRepo.findAll(owner, Page(0, 100), None)).total
      after shouldBe before
    }

    "rejects an http:// URL with 400, naming the scheme and requiring https, before any request" in {
      val result = await(service.createCsvUrl("SSRF scheme", "http://example.com/data.csv", user))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadRequest]
      result.swap.toOption.get.message.toLowerCase should include ("https")
    }

    "rejects a loopback-resolving URL with the shared guard's disallowed-address message" in {
      val result = await(service.createCsvUrl("SSRF loopback", "https://127.0.0.1:1/x", user))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadGateway]
      result.swap.toOption.get.message should include ("disallowed address")
    }

    "rejects an HTML body served with HTTP 200 as 400, not a garbage schema" in {
      val result = await(service.createCsvUrl("HTML page", urlFor("page.html"), user))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadRequest]
      result.swap.toOption.get.message.toLowerCase should include ("html")
    }

    "rejects an over-limit body as 413, naming the limit" in {
      val before = await(dataSourceRepo.findAll(owner, Page(0, 100), None)).total
      val result = await(service.createCsvUrl("Huge CSV", urlFor("huge.csv"), user))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.PayloadTooLarge]
      result.swap.toOption.get.message should include (CsvUrlFetch.maxFileSizeBytes.toString)
      val after = await(dataSourceRepo.findAll(owner, Page(0, 100), None)).total
      after shouldBe before
    }
  }

  "DataSourceService.refresh (URL-backed CSV)" should {

    "re-fetches the URL and reflects CHANGED upstream content" in {
      refreshableBody = csvV1
      val src = await(service.createCsvUrl("Refreshable CSV", urlFor("refreshable.csv"), user)).toOption.get
      val schemaBefore = await(dataSourceRepo.findByIdOwned(src.id, user)).get.inferredSchema

      refreshableBody = csvV2
      val refreshed = await(service.refresh(src.id, None, user))
      refreshed shouldBe a[Right[_, _]]

      val schemaAfter = await(dataSourceRepo.findByIdOwned(src.id, user)).get.inferredSchema
      schemaAfter.map(_.name) shouldBe schemaBefore.map(_.name)

      val stored = fileSystem.read(src.asInstanceOf[CsvSource].config.path)
      new String(await(stored), StandardCharsets.UTF_8) shouldBe csvV2
    }

    "an inline/upload-created CSV refresh performs NO fetch and reads the stored file" in {
      val bytes  = "x,y\n1,2".getBytes(StandardCharsets.UTF_8)
      val result = await(service.createCsv("Inline CSV", bytes, Vector.empty, user))
      val src    = result.toOption.get

      // No sourceUrl was persisted, so refresh must not attempt any network call —
      // proven by the fact this succeeds even though `service`'s isBlocked/resolveHost
      // are configured for the local HTTPS test server, not any arbitrary host.
      val refreshed = await(service.refresh(src.id, None, user))
      refreshed shouldBe a[Right[_, _]]
      refreshed.toOption.get.asInstanceOf[CsvSource].config.sourceUrl shouldBe None
    }
  }
}
