package com.helio.services.sources

import com.google.cloud.storage.{BlobId, BlobInfo, Storage}
import com.helio.api.routes.sources.DataSourceRoutes
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.{FileSystem, GcsFileSystem, ListPage, LocalFileSystem}
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import com.helio.testsupport.{PdfFixtures, UserSeeding}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.{ConnectionContext, Http}
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, times, verify, verifyNoMoreInteractions}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.awt.image.BufferedImage
import java.io.{ByteArrayOutputStream, FileInputStream}
import java.net.InetAddress
import java.nio.charset.StandardCharsets
import java.security.cert.X509Certificate
import java.security.{KeyStore, SecureRandom}
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import javax.imageio.ImageIO
import javax.net.ssl.{KeyManagerFactory, SSLContext, TrustManager, X509TrustManager}
import scala.collection.mutable
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}
import scala.sys.process._

/** HEL-1494: every `DataSourceService` create path that writes a file and then inserts a row (csv upload/URL,
 *  text, pdf, image upload/URL) used to leave the stored file behind when the row insert failed, and the row AND
 *  the file behind when the post-insert schema write failed. Each path is driven through `POST /data-sources`
 *  with a fault-injected repository; rows are counted by the exact owner id (a fresh user per case) and stored
 *  files are compared by exact path against the temp root's listing.
 *
 *  Each route case first makes one SUCCESSFUL create (the GUARD: its row and file must survive the later failed
 *  create), then fails the next one and asserts nothing of the failed request remains. */
class DataSourceCreateFailureCleanupSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private final class FaultyDataSourceRepository(ctx: DbContext) extends DataSourceRepository(ctx) {
    @volatile var failInsert       = false
    @volatile var failUpsertSchema = false
    @volatile var failDelete       = false
    val deleteCalls                = new AtomicInteger(0)
    override def insert(source: DataSource, user: AuthenticatedUser): Future[DataSource] =
      if (failInsert) Future.failed(new IllegalStateException("boom: insert")) else super.insert(source, user)
    override def upsertInferredSchema(id: DataSourceId, schema: Vector[SchemaField], updatedAt: Instant, user: AuthenticatedUser): Future[Option[DataSource]] =
      if (failUpsertSchema) Future.failed(new IllegalStateException("boom: upsertInferredSchema")) else super.upsertInferredSchema(id, schema, updatedAt, user)
    override def delete(id: DataSourceId, user: AuthenticatedUser): Future[Boolean] = {
      deleteCalls.incrementAndGet()
      if (failDelete) throw new IllegalStateException("boom: repo delete") else super.delete(id, user)
    }
  }

  private final class FlakyFileSystem(delegate: FileSystem) extends FileSystem {
    @volatile var failDelete = false
    val deleted              = mutable.Buffer.empty[String]
    def write(path: String, bytes: Array[Byte]): Future[Unit]                                 = delegate.write(path, bytes)
    def read(path: String): Future[Array[Byte]]                                               = delegate.read(path)
    def exists(path: String): Future[Boolean]                                                 = delegate.exists(path)
    def list(prefix: String, cursor: Option[String], pageSize: Int): Future[ListPage]         = delegate.list(prefix, cursor, pageSize)
    def delete(path: String): Future[Unit] = {
      deleted.synchronized(deleted += path)
      if (failDelete) throw new IllegalStateException("boom: file delete") else delegate.delete(path)
    }
  }

  private var embeddedPostgres: EmbeddedPostgres         = _
  private var db: JdbcBackend.Database                   = _
  private var repo: FaultyDataSourceRepository           = _
  private var fs: FlakyFileSystem                        = _
  private var service: DataSourceService                 = _
  private var httpBinding: Http.ServerBinding            = _
  private var httpsBinding: Http.ServerBinding           = _

  private def admitLocalhost(host: String, addr: InetAddress): Boolean =
    if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  private def pngBytes: Array[Byte] = {
    val out = new ByteArrayOutputStream()
    ImageIO.write(new BufferedImage(4, 3, BufferedImage.TYPE_INT_RGB), "png", out)
    out.toByteArray
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new FaultyDataSourceRepository(new DbContext(db, db))
    fs   = new FlakyFileSystem(new LocalFileSystem(newTempDir("helio-hel1494-uploads")))
    service = new DataSourceService(repo, fs, isBlocked = admitLocalhost)

    val plainRoutes = concat(
      path("notes.txt")(get(complete(HttpEntity(ContentTypes.`text/plain(UTF-8)`, "hello")))),
      path("report.pdf")(get(complete(HttpEntity(ContentType(MediaTypes.`application/pdf`), PdfFixtures.multiPagePdf(Seq("Hello")))))),
      path("photo.png")(get(complete(HttpEntity(ContentTypes.`application/octet-stream`, pngBytes))))
    )
    httpBinding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(plainRoutes), 10.seconds)

    val keystorePath = newTempDir("helio-hel1494-keystore").resolve("test.p12")
    val exitCode = Seq(
      "keytool", "-genkeypair", "-alias", "test", "-keyalg", "RSA", "-keysize", "2048",
      "-validity", "2", "-storetype", "PKCS12", "-keystore", keystorePath.toString, "-storepass", "changeit",
      "-dname", "CN=localhost", "-ext", "SAN=DNS:localhost,IP:127.0.0.1"
    ).!
    require(exitCode == 0, "keytool self-signed cert generation failed")
    val ks = KeyStore.getInstance("PKCS12")
    val in = new FileInputStream(keystorePath.toFile)
    try ks.load(in, "changeit".toCharArray) finally in.close()
    val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm)
    kmf.init(ks, "changeit".toCharArray)
    val serverSsl = SSLContext.getInstance("TLS")
    serverSsl.init(kmf.getKeyManagers, null, null)
    val trustAll: TrustManager = new X509TrustManager {
      def checkClientTrusted(chain: Array[X509Certificate], authType: String): Unit = ()
      def checkServerTrusted(chain: Array[X509Certificate], authType: String): Unit = ()
      def getAcceptedIssuers: Array[X509Certificate]                                = Array.empty
    }
    val clientSsl = SSLContext.getInstance("TLS")
    clientSsl.init(null, Array(trustAll), new SecureRandom())
    Http(typedSystem.classicSystem).setDefaultClientHttpsContext(ConnectionContext.httpsClient(clientSsl))
    val csvRoutes = path("data.csv")(get(complete(HttpEntity(ContentTypes.`text/csv(UTF-8)`, "a,b\n1,2\n"))))
    httpsBinding = Await.result(
      Http(typedSystem.classicSystem).newServerAt("localhost", 0).enableHttps(ConnectionContext.httpsServer(serverSsl)).bind(csvRoutes), 15.seconds
    )
  }

  override def afterAll(): Unit = {
    Option(httpBinding).foreach(b => Await.ready(b.unbind(), 10.seconds))
    Option(httpsBinding).foreach(b => Await.ready(b.unbind(), 10.seconds))
    Option(db).foreach(_.close()); Option(embeddedPostgres).foreach(_.close())
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def freshUser(): AuthenticatedUser = {
    val id = UserId(UUID.randomUUID().toString)
    UserSeeding.seedUsers(db, id)
    AuthenticatedUser(id)
  }

  private def rowCount(user: AuthenticatedUser): Int = {
    import PostgresProfile.api._
    val owner = user.id.value
    await(db.run(sql"SELECT count(*) FROM data_sources WHERE owner_id = $owner::uuid".as[Int])).head
  }

  private def files(prefix: String): Set[String] = await(fs.list(prefix)).names.toSet

  private def withFault[T](set: Boolean => Unit)(body: => T): T = {
    set(true)
    try body finally set(false)
  }

  private def withFaults[T](first: Boolean => Unit, second: Boolean => Unit)(body: => T): T =
    withFault(first)(withFault(second)(body))

  private def multipart(parts: Multipart.FormData.BodyPart.Strict*): HttpRequest =
    Post("/data-sources", Multipart.FormData(parts: _*))

  private def field(name: String, value: String) =
    Multipart.FormData.BodyPart.Strict(name, HttpEntity(ContentTypes.`text/plain(UTF-8)`, value))

  private def filePart(entity: HttpEntity.Strict, filename: String) =
    Multipart.FormData.BodyPart.Strict("file", entity, Map("filename" -> filename))

  private def urlBody(kind: String, name: String, url: String): HttpRequest =
    Post("/data-sources", HttpEntity(ContentTypes.`application/json`, s"""{"type":"$kind","name":"$name","config":{"url":"$url"}}"""))

  private def httpUrl(p: String)  = s"http://localhost:${httpBinding.localAddress.getPort}/$p"
  private def httpsUrl(p: String) = s"https://localhost:${httpsBinding.localAddress.getPort}/$p"

  /** (label, stored-file prefix, request builder taking a unique source name). */
  private val cases: Seq[(String, String, String => HttpRequest)] = Seq(
    ("csv upload", "csv", n => multipart(field("name", n), filePart(HttpEntity(ContentTypes.`text/plain(UTF-8)`, "a,b\n1,2\n"), "d.csv"))),
    ("csv URL", "csv", n => urlBody("csv", n, httpsUrl("data.csv"))),
    ("text upload", "text", n => multipart(field("type", "text"), field("name", n), filePart(HttpEntity(ContentTypes.`text/plain(UTF-8)`, "hello"), "notes.txt"))),
    ("text URL", "text", n => urlBody("text", n, httpUrl("notes.txt"))),
    ("pdf upload", "pdf", n => multipart(field("type", "pdf"), field("name", n), filePart(HttpEntity(ContentType(MediaTypes.`application/pdf`), PdfFixtures.multiPagePdf(Seq("Hi"))), "r.pdf"))),
    ("pdf URL", "pdf", n => urlBody("pdf", n, httpUrl("report.pdf"))),
    ("image upload", "image", n => multipart(field("type", "image"), field("name", n), filePart(HttpEntity(ContentTypes.`application/octet-stream`, pngBytes), "p.png"))),
    ("image URL", "image", n => urlBody("image", n, httpUrl("photo.png")))
  )

  private val faults: Seq[(String, (FaultyDataSourceRepository, Boolean) => Unit)] = Seq(
    ("the row insert failing", (r, b) => r.failInsert = b),
    ("the post-insert schema write failing", (r, b) => r.failUpsertSchema = b)
  )

  for ((label, prefix, request) <- cases; (faultLabel, setFault) <- faults) {
    s"POST /data-sources ($label) with $faultLabel" should {
      "leave no row and no file from the failed request, keep the earlier success, and answer 500" in {
        val user  = freshUser()
        val route = Route.seal(new DataSourceRoutes(service, user).routes)
        request(s"ok-${UUID.randomUUID()}") ~> route ~> check { status shouldBe StatusCodes.Created }
        val rowsAfterSuccess  = rowCount(user)
        val filesAfterSuccess = files(prefix)
        rowsAfterSuccess shouldBe 1

        withFault(setFault(repo, _)) {
          request(s"fail-${UUID.randomUUID()}") ~> route ~> check { status shouldBe StatusCodes.InternalServerError }
        }
        val rowsAfter  = rowCount(user)
        val filesAfter = files(prefix)
        // Evidence line for red-evidence.md (exact owner id, exact leaked paths).
        println(s"[HEL-1494-evidence] path='$label' fault='$faultLabel' owner=${user.id.value} rows=$rowsAfter(expected 1) leakedFiles=${(filesAfter -- filesAfterSuccess).mkString(",")}")
        rowsAfter shouldBe rowsAfterSuccess
        filesAfter shouldBe filesAfterSuccess
      }
    }
  }

  "DataSourceService.createTextUpload when a cleanup step itself fails (HEL-1494)" should {
    "surface the original schema-write failure and keep the file when the row delete throws" in {
      val user   = freshUser()
      val before = files("text")
      repo.deleteCalls.set(0)
      val thrown = withFaults(repo.failUpsertSchema = _, repo.failDelete = _) {
        intercept[IllegalStateException](await(service.createTextUpload("n", "hello".getBytes(StandardCharsets.UTF_8), "notes.txt", user)))
      }
      thrown.getMessage shouldBe "boom: upsertInferredSchema"
      repo.deleteCalls.get shouldBe 1 // the throwing row delete was reached
      // The row could not be removed, so the file it points at is kept (consistent, not half-deleted).
      (files("text") -- before).size shouldBe 1
    }

    "surface the original insert failure when the file delete throws, having reached that delete for the request's own path" in {
      val user   = freshUser()
      val before = files("text")
      fs.deleted.synchronized(fs.deleted.clear())
      val thrown = withFaults(repo.failInsert = _, fs.failDelete = _) {
        intercept[IllegalStateException](await(service.createTextUpload("n", "hello".getBytes(StandardCharsets.UTF_8), "notes.txt", user)))
      }
      thrown.getMessage shouldBe "boom: insert"
      val attempted = fs.deleted.synchronized(fs.deleted.toList)
      attempted should have size 1
      attempted.head should startWith("text/")
      before should not contain attempted.head
      (files("text") -- before) shouldBe Set(attempted.head) // the throwing delete left the request's own file in place
      rowCount(user) shouldBe 0
    }
  }

  "DataSourceService over GcsFileSystem when the schema write fails after the insert (HEL-1494)" should {
    "issue exactly one blob delete, for the exact path it just wrote, and surface the original failure" in {
      val user    = freshUser()
      val storage = mock(classOf[Storage])
      val gcsService = new DataSourceService(repo, new GcsFileSystem("test-bucket", storage), isBlocked = admitLocalhost)
      val thrown = withFault(repo.failUpsertSchema = _) {
        intercept[IllegalStateException](await(gcsService.createTextUpload("n", "hello".getBytes(StandardCharsets.UTF_8), "notes.txt", user)))
      }
      thrown.getMessage shouldBe "boom: upsertInferredSchema"
      val created = ArgumentCaptor.forClass(classOf[BlobInfo])
      verify(storage).create(created.capture(), any(classOf[Array[Byte]]))
      val deleted = ArgumentCaptor.forClass(classOf[BlobId])
      verify(storage, times(1)).delete(deleted.capture())
      verifyNoMoreInteractions(storage)
      deleted.getValue.getBucket shouldBe "test-bucket"
      deleted.getValue.getName shouldBe created.getValue.getName
      deleted.getValue.getName should startWith("text/")
      rowCount(user) shouldBe 0
    }
  }
}
