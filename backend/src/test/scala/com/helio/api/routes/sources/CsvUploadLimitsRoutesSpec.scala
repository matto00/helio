package com.helio.api.routes.sources

import com.helio.api._
import com.helio.api.http.CsvUploadGate
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.sources.{CsvLimits, DataSourceService}
import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.marshalling.Marshal
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.unmarshalling.Unmarshal
import org.apache.pekko.http.scaladsl.model.headers.`Retry-After`
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.stream.SystemMaterializer
import org.apache.pekko.stream.scaladsl.{Keep, Sink, Source}
import org.apache.pekko.util.ByteString
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json._

import java.io.{ByteArrayOutputStream, IOException}
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicBoolean
import scala.concurrent.{Await, Promise}
import scala.concurrent.duration.DurationInt

/** The CSV upload routes under the real byte/row/cell caps (HEL-1221). The oversize bodies are
 *  built in memory per test and never written to disk or committed. */
class CsvUploadLimitsRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var service: DataSourceService         = _

  private val userId = "a0000000-0000-0000-0000-0000000012a1"
  private val user   = AuthenticatedUser(UserId(userId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ec  = typedSystem.executionContext
    val ctx = new DbContext(db, db)(ec)
    import slick.jdbc.PostgresProfile.api._
    Await.result(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, 'csv-limits@test.local', now())"""), 10.seconds)
    service = new DataSourceService(new DataSourceRepository(ctx)(ec), new LocalFileSystem(newTempDir("helio-csv-limits"))(ec))
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def routesWith(gate: CsvUploadGate): Route =
    pathPrefix("api")(
      concat(
        new DataSourceRoutes(service, user, Some(gate))(typedSystem).routes,
        new DataSourcePreviewRoutes(service, user, uploadGate = Some(gate))(typedSystem).routes
      )
    )

  private def routes(): Route = routesWith(new CsvUploadGate(Int.MaxValue)(typedSystem.executionContext))

  private def csvUpload(content: Array[Byte], name: Option[String] = None): Multipart.FormData = {
    val file = Multipart.FormData.BodyPart.Strict("file", HttpEntity(ContentTypes.`text/plain(UTF-8)`, ByteString.fromArrayUnsafe(content)))
    Multipart.FormData(name.toSeq.map(n => Multipart.FormData.BodyPart.Strict("name", HttpEntity(ContentTypes.`text/plain(UTF-8)`, n))) :+ file: _*)
  }

  /** `rows` data rows of `cols` columns, each cell `cellBytes` long. */
  private def csv(rows: Int, cols: Int, cellBytes: Int, lineBreak: String = "\n"): Array[Byte] = {
    val cell = "x" * cellBytes
    val sb   = new java.lang.StringBuilder
    sb.append((0 until cols).map(i => s"c$i").mkString(",")).append(lineBreak)
    val row = Seq.fill(cols)(cell).mkString(",") + lineBreak
    var i = 0
    while (i < rows) { sb.append(row); i += 1 }
    sb.toString.getBytes("UTF-8")
  }

  /** Posts over a real socket: the global 8 MiB `max-content-length` is enforced by the Pekko
   *  server, not by `ScalatestRouteTest`, so only a real server proves the route-scoped limit. The
   *  entity is made strict so the request carries a `Content-Length`, like a browser/curl multipart
   *  upload does. */
  private def postOverHttp(route: Route, path: String, form: Multipart.FormData): (StatusCode, String) = {
    val binding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(Route.seal(route)), 10.seconds)
    try {
      val entity   = Await.result(Marshal(form).to[RequestEntity].flatMap(_.toStrict(30.seconds)), 60.seconds)
      val response = Await.result(Http(typedSystem.classicSystem).singleRequest(HttpRequest(HttpMethods.POST, s"http://localhost:${binding.localAddress.getPort}$path", entity = entity)), 60.seconds)
      (response.status, Await.result(Unmarshal(response).to[String], 30.seconds))
    } finally Await.result(binding.unbind(), 10.seconds)
  }

  /** HEL-1505 (the `Broken pipe` flake): the server rejects an over-cap body with `413` + `Connection: close` as soon
   *  as the cap is crossed, while a client is still writing the rest. `Http().singleRequest` can then see the write
   *  fail before it has processed the `413` that already arrived (a Pekko client-internal ordering race, never
   *  reproduced locally), so the 413 cases that go through a real server use this raw-socket client instead: a reader
   *  thread is started BEFORE any write and keeps the response bytes whatever happens to the writer, a write that fails
   *  because the server already closed is the expected outcome rather than an error, and the socket is closed only
   *  after the reader has finished. This relies on Linux keeping response bytes that arrived before an RST readable.
   *
   *  With `gateOnServerClose` the writer sends only the part of the body that crosses the cap, then WAITS (bounded) for
   *  the server to terminate the connection before writing the rest: the write-after-close ordering, forced without
   *  sleeps. `tolerant = false` is the naive client (write everything, then read), kept to prove the premise. */
  private def postOverHttpExpectingEarlyClose(
      route: Route,
      path: String,
      form: Multipart.FormData,
      gateOnServerClose: Boolean = false,
      tolerant: Boolean = true
  ): (StatusCode, String) = {
    val mat        = SystemMaterializer(typedSystem).materializer
    val terminated = Promise[Unit]()
    val serverFlow = Route.toFlow(Route.seal(route))(typedSystem.classicSystem)
      .watchTermination()((m, done) => { done.onComplete(_ => terminated.trySuccess(()))(typedSystem.executionContext); m })
    val (bindingF, _) = Http(typedSystem.classicSystem).newServerAt("localhost", 0).connectionSource()
      .toMat(Sink.foreach[Http.IncomingConnection](_.handleWith(serverFlow)))(Keep.both).run()(mat)
    val binding = Await.result(bindingF, 10.seconds)
    try {
      val entity = Await.result(Marshal(form).to[RequestEntity].flatMap(_.toStrict(30.seconds)), 60.seconds)
      val body   = Await.result(entity.dataBytes.runFold(ByteString.empty)(_ ++ _)(mat), 30.seconds).toArray
      val head   = s"POST $path HTTP/1.1\r\nHost: localhost:${binding.localAddress.getPort}\r\nContent-Type: ${entity.contentType}\r\n" +
        s"Content-Length: ${body.length}\r\nConnection: close\r\n\r\n"
      val socket = new Socket("localhost", binding.localAddress.getPort)
      try {
        socket.setSoTimeout(30000)
        val received = new ByteArrayOutputStream()
        val reader = new Thread(() => {
          val in  = socket.getInputStream
          val buf = new Array[Byte](65536)
          try {
            var n = in.read(buf)
            while (n >= 0) { received.synchronized(received.write(buf, 0, n)); n = in.read(buf) }
          } catch { case _: IOException => () } // reset or timeout: keep whatever arrived before it
        })
        if (tolerant) reader.start()
        val out = socket.getOutputStream
        try {
          out.write(head.getBytes(StandardCharsets.US_ASCII))
          val prefixLength = if (gateOnServerClose) math.min(body.length, (CsvLimits.entityLimitBytes + 65536).toInt) else body.length
          out.write(body, 0, prefixLength); out.flush()
          if (gateOnServerClose) {
            Await.result(terminated.future, 30.seconds) // bounded: a server that drains instead of closing fails here, not hangs
            out.write(body, prefixLength, body.length - prefixLength); out.flush()
          }
        } catch { case _: IOException if tolerant => () } // the server closed first: expected
        if (tolerant) { reader.join(35000); reader.isAlive shouldBe false }
        else reader.run()
        parseHttpResponse(received.synchronized(received.toByteArray))
      } finally socket.close()
    } finally Await.result(binding.unbind(), 10.seconds)
  }

  private def parseHttpResponse(bytes: Array[Byte]): (StatusCode, String) = {
    val text     = new String(bytes, StandardCharsets.UTF_8)
    val split    = text.indexOf("\r\n\r\n")
    withClue(s"no complete HTTP response head was received (${bytes.length} bytes): ") { split should be >= 0 }
    val statusLine = text.substring(0, text.indexOf("\r\n")).split(" ")
    (StatusCode.int2StatusCode(statusLine(1).toInt), text.substring(split + 4))
  }

  /** A 25 MiB pdf: over the largest non-CSV cap, so the server rejects it mid-body. */
  private def pdfOverCapForm(): Multipart.FormData = {
    val body = Array.fill(25 * 1024 * 1024)('a'.toByte)
    Multipart.FormData(
      Multipart.FormData.BodyPart.Strict("type", HttpEntity(ContentTypes.`text/plain(UTF-8)`, "pdf")),
      Multipart.FormData.BodyPart.Strict("name", HttpEntity(ContentTypes.`text/plain(UTF-8)`, "big-pdf")),
      Multipart.FormData.BodyPart.Strict(
        "file",
        HttpEntity(ContentType(MediaTypes.`application/pdf`), ByteString.fromArrayUnsafe(body)),
        Map("filename" -> "big.pdf")
      )
    )
  }

  private def messageOf(body: String): String = body.parseJson.asJsObject.fields("message").convertTo[String]

  private def errorMessage: String = responseAs[String].parseJson.asJsObject.fields("message").convertTo[String]

  "POST /api/data-sources/infer" should {
    "accept a 12 MiB CSV (above Pekko's 8 MiB default) within the row and cell caps" in {
      val body = csv(rows = 2600, cols = 5, cellBytes = 1000)
      body.length should be > (12 * 1024 * 1024)
      postOverHttp(routes(), "/api/data-sources/infer", csvUpload(body))._1 shouldBe StatusCodes.OK
    }

    "accept a file of exactly 8 MiB whose multipart envelope pushes the body past 8 MiB" in {
      val exact = csv(rows = 2000, cols = 4, cellBytes = 1000)
      val body  = exact ++ Array.fill(8 * 1024 * 1024 - exact.length)('y'.toByte)
      body.length shouldBe 8 * 1024 * 1024
      postOverHttp(routes(), "/api/data-sources/infer", csvUpload(body))._1 shouldBe StatusCodes.OK
    }

    "return 413 naming the limits when the entity exceeds the byte limit plus multipart margin" in {
      val tooBig = Array.fill((CsvLimits.entityLimitBytes + 1024).toInt)('a'.toByte)
      val (status, body) = postOverHttpExpectingEarlyClose(routes(), "/api/data-sources/infer", csvUpload(tooBig))
      status shouldBe StatusCodes.RequestEntityTooLarge
      messageOf(body) should (include(CsvLimits.maxBytes.toString) and include(CsvLimits.maxRows.toString) and include(CsvLimits.maxCells.toString))
    }

    "return 413 for a file over the byte limit that still fits inside the multipart margin" in {
      val overByOne = Array.fill((CsvLimits.maxBytes + 1).toInt)('a'.toByte)
      Post("/api/data-sources/infer", csvUpload(overByOne)) ~> routes() ~> check {
        status shouldBe StatusCodes.RequestEntityTooLarge
        errorMessage should include(CsvLimits.maxBytes.toString)
      }
    }

    "return 413 for a narrow file over the row cap" in {
      val narrow = csv(rows = (CsvLimits.maxRows + 1).toInt, cols = 1, cellBytes = 1)
      Post("/api/data-sources/infer", csvUpload(narrow)) ~> routes() ~> check {
        status shouldBe StatusCodes.RequestEntityTooLarge
        errorMessage should include(CsvLimits.maxRows.toString)
      }
    }

    "count bare-CR line breaks as rows when applying the row cap" in {
      val narrow = csv(rows = (CsvLimits.maxRows + 1).toInt, cols = 1, cellBytes = 1, lineBreak = "\r")
      Post("/api/data-sources/infer", csvUpload(narrow)) ~> routes() ~> check {
        status shouldBe StatusCodes.RequestEntityTooLarge
      }
    }

    "return 413 for a wide file over the cell cap while under the row cap" in {
      val wide = csv(rows = 1000, cols = 800, cellBytes = 1)
      Post("/api/data-sources/infer", csvUpload(wide)) ~> routes() ~> check {
        status shouldBe StatusCodes.RequestEntityTooLarge
        errorMessage should include(CsvLimits.maxCells.toString)
      }
    }
  }

  "POST /api/data-sources (multipart CSV)" should {
    "create a source from a 12 MiB CSV" in {
      val body = csv(rows = 2600, cols = 5, cellBytes = 1000)
      postOverHttp(routes(), "/api/data-sources", csvUpload(body, Some("big-csv")))._1 shouldBe StatusCodes.Created
    }

    "return 413 when the entity exceeds the limit, never 500" in {
      val tooBig = Array.fill((CsvLimits.entityLimitBytes + 1024).toInt)('a'.toByte)
      val (status, body) = postOverHttpExpectingEarlyClose(routes(), "/api/data-sources", csvUpload(tooBig, Some("too-big")))
      status shouldBe StatusCodes.RequestEntityTooLarge
      messageOf(body) should include(CsvLimits.maxBytes.toString)
    }

    "return 413 for a CSV over the row cap" in {
      val narrow = csv(rows = (CsvLimits.maxRows + 1).toInt, cols = 1, cellBytes = 1)
      Post("/api/data-sources", csvUpload(narrow, Some("too-many-rows"))) ~> routes() ~> check {
        status shouldBe StatusCodes.RequestEntityTooLarge
        errorMessage should include(CsvLimits.maxRows.toString)
      }
    }

    "return 413, not 500, for a pdf upload over the largest non-CSV cap without buffering the whole entity" in {
      val (status, text) = postOverHttpExpectingEarlyClose(routes(), "/api/data-sources", pdfOverCapForm())
      status shouldBe StatusCodes.RequestEntityTooLarge
      messageOf(text) should not be empty
    }

    "return 413 for the pdf over the cap even when the rest of the body is written after the server closed (forced ordering)" in {
      val (status, text) = postOverHttpExpectingEarlyClose(routes(), "/api/data-sources", pdfOverCapForm(), gateOnServerClose = true)
      status shouldBe StatusCodes.RequestEntityTooLarge
      messageOf(text) should not be empty
    }

    "premise guard: a naive write-everything-then-read client hits Broken pipe on the same pdf request" in {
      val failure = the[IOException] thrownBy
        postOverHttpExpectingEarlyClose(routes(), "/api/data-sources", pdfOverCapForm(), tolerant = false)
      failure.getMessage should include("Broken pipe")
    }

    "return 413 for an oversized metadata part instead of buffering it" in {
      val form = Multipart.FormData(
        Multipart.FormData.BodyPart.Strict("name", HttpEntity(ContentTypes.`text/plain(UTF-8)`, "x" * (2 * 1024 * 1024))),
        Multipart.FormData.BodyPart.Strict("file", HttpEntity(ContentTypes.`text/plain(UTF-8)`, "a\n1\n"))
      )
      postOverHttpExpectingEarlyClose(routes(), "/api/data-sources", form)._1 shouldBe StatusCodes.RequestEntityTooLarge
    }

    "leave JSON requests on the default entity limit and outside the upload gate" in {
      val gate = new CsvUploadGate(0)(typedSystem.executionContext)
      val json = HttpEntity(ContentTypes.`application/json`, """{"name":"s","columns":[{"name":"a","type":"string"}],"rows":[["x"]]}""")
      Post("/api/data-sources", json) ~> routesWith(gate) ~> check {
        status should not be StatusCodes.TooManyRequests
      }
    }
  }

  "GET /api/data-sources/csv-limits" should {
    "return the configured byte, row and cell limits" in {
      Get("/api/data-sources/csv-limits") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val json = responseAs[String].parseJson.asJsObject
        json.fields("maxBytes").convertTo[Long] shouldBe CsvLimits.maxBytes
        json.fields("maxRows").convertTo[Long] shouldBe CsvLimits.maxRows
        json.fields("maxCells").convertTo[Long] shouldBe CsvLimits.maxCells
      }
    }
  }

  "the CSV upload gate" should {
    val multipartRequest = () => Post("/up", csvUpload(csv(1, 1, 1)))

    def gatedRoute(gate: CsvUploadGate, held: Promise[Unit]): Route =
      path("up")(gate.csvUpload()(onSuccess(held.future)(complete("done"))))

    "return 429 with Retry-After once the in-flight cap is reached and release on completion" in {
      val gate = new CsvUploadGate(1)(typedSystem.executionContext)
      val held = Promise[Unit]()
      val route = gatedRoute(gate, held)

      val first = Route.toFunction(route)(typedSystem.classicSystem)(multipartRequest())
      gate.inFlight shouldBe 1

      multipartRequest() ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
        header[`Retry-After`] should not be empty
      }

      held.success(())
      Await.result(first, 5.seconds)
      gate.inFlight shouldBe 0
      multipartRequest() ~> route ~> check { status shouldBe StatusCodes.OK }
    }

    "release the permit when the inner route fails" in {
      val gate = new CsvUploadGate(1)(typedSystem.executionContext)
      val held = Promise[Unit]()
      val route = gatedRoute(gate, held)

      val first = Route.toFunction(route)(typedSystem.classicSystem)(multipartRequest())
      held.failure(new RuntimeException("client aborted"))
      Await.ready(first, 5.seconds)
      gate.inFlight shouldBe 0
    }

    "refuse with 429 before the request body is consumed" in {
      val gate     = new CsvUploadGate(1)(typedSystem.executionContext)
      val held     = Promise[Unit]()
      val route    = gatedRoute(gate, held)
      Route.toFunction(route)(typedSystem.classicSystem)(multipartRequest())

      val touched  = new AtomicBoolean(false)
      val lazyBody = Source.lazySource { () =>
        touched.set(true)
        Source.empty[ByteString]
      }
      val contentType = ContentType.parse("multipart/form-data; boundary=b").toOption.get
      val request     = HttpRequest(HttpMethods.POST, "/up", entity = HttpEntity.Chunked.fromData(contentType, lazyBody))

      request ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
      }
      touched.get() shouldBe false
      held.success(())
    }
  }

}
