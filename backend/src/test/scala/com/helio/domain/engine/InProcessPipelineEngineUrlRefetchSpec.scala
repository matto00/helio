package com.helio.domain.engine

import com.helio.domain.model.{ImageSourceConfig, PdfSourceConfig, TextSourceConfig}
import com.helio.domain.model.{ImageSource, PdfSource, TextSource, UserId}
import com.helio.domain.model.{DataSourceId}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.sources.ContentSourceSupport
import com.helio.testsupport.PdfFixtures
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.model.ContentTypes.`application/octet-stream`
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.net.InetAddress
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths}
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-881: `text`/`pdf`/`image` URL-backed sources never re-fetched on a
 *  pipeline run — HEL-862 fixed exactly this for `csv`, this closes the same
 *  gap for the other three content connectors via the shared `urlFetch` seam
 *  (design.md Decision 2).
 *
 *  Task 1.2/1.3: the FIRST test below is the probe run against a REAL local
 *  HTTP test server whose bytes change between two calls — not a stubbed
 *  fetch function returning canned values, which would prove nothing about
 *  whether the dispatch reads from storage or the network. It was run RED
 *  before any fix landed: `TextSource`'s `loadRowsWithStats` branch called
 *  `fileSystem.read(config.path)` unconditionally, so both runs returned the
 *  content stored at creation time (`"stale-stored-content"`) regardless of
 *  what the server served, and the server's hit counter stayed at 0 — proof
 *  the defect is an un-refetched storage read (mechanism (a)/(c) in
 *  design.md Decision 1), NOT a conditional-request short-circuit (mechanism
 *  (b), ruled out below since no request — conditional or otherwise — was
 *  ever issued). */
class InProcessPipelineEngineUrlRefetchSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private val ec: ExecutionContext                       = ExecutionContext.global
  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private val tmpRoot   = Files.createTempDirectory("helio-url-refetch-spec")
  private val fileSystem = new LocalFileSystem(tmpRoot)(ec)

  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                   = _
  private def urlFor(path: String): String = s"http://localhost:$testServerPort/$path"

  // Task 1.2/1.3 fixture: `/changing` serves a DIFFERENT body on each of its
  // first two hits (and counts every hit, including a HEAD/conditional one,
  // so "no request was ever issued" and "a conditional request short-circuited
  // it" are both directly observable from `changingHits.get()`).
  private val changingHits = new AtomicInteger(0)
  private val changingResponses = Vector("run-1-server-content", "run-2-server-content")

  override def beforeAll(): Unit = {
    val routes = concat(
      path("changing") {
        get {
          val i = changingHits.getAndIncrement()
          complete(HttpEntity(ContentTypes.`text/plain(UTF-8)`, changingResponses(math.min(i, changingResponses.size - 1))))
        }
      },
      path("plain-http-text") {
        get { complete(HttpEntity(ContentTypes.`text/plain(UTF-8)`, "fetched-over-plain-http")) }
      },
      path("too-large") {
        get { complete(HttpEntity(ContentTypes.`text/plain(UTF-8)`, "x" * 100000)) }
      },
      path("boom") {
        get { complete(StatusCodes.InternalServerError -> "upstream broke") }
      }
    )
    testServerBinding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(routes), 10.seconds)
    testServerPort = testServerBinding.localAddress.getPort
  }

  override def afterAll(): Unit = {
    Await.ready(testServerBinding.unbind(), 10.seconds)
    super.afterAll()
  }

  // Real network fetch (not a stub) admitting only this test's own
  // "localhost" hostname past the SSRF denylist, mirroring
  // `ContentSourceSupportSpec`'s `admitLocalhost` pattern — every other host
  // still goes through the real, unmodified `isBlockedAddress` check.
  private def admitLocalhost(host: String, addr: InetAddress): Boolean =
    if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  /** The real production seam shape (`(kind, url) => Future[Either[String, Array[Byte]]]`),
   *  wired to genuinely issue an HTTP GET against the local test server via
   *  `ContentSourceSupport.fetchUrlWithLimit` — exactly what `PipelineRunService`
   *  wires in production, minus only the `ActorSystem`-nullability plumbing
   *  that's irrelevant to this probe. */
  private def realUrlFetch(kind: String, url: String): Future[Either[String, Array[Byte]]] =
    ContentSourceSupport
      .fetchUrlWithLimit(url, maxBytes = 50000, resolveHost = ContentSourceSupport.defaultResolveHost, isBlocked = admitLocalhost)(typedSystem)

  private val realFetchEngine = new InProcessPipelineEngine(fileSystem, urlFetch = realUrlFetch)(ec)

  private def userId = UserId("00000000-0000-0000-0000-000000000001")

  "loadRowsWithStats (HEL-881 probe: task 1.2/1.3)" should {

    "a URL-backed text source re-fetches over the real network and reflects CHANGED upstream bytes across two runs, never short-circuited by a conditional request" in {
      changingHits.set(0)
      val storedPath = "probe/stale.txt"
      Await.result(fileSystem.write(storedPath, "stale-stored-content".getBytes(StandardCharsets.UTF_8)), 5.seconds)

      val ds = TextSource(
        id        = DataSourceId("ds-text-probe"),
        name      = "text-probe",
        ownerId   = userId,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = TextSourceConfig(storedPath, sourceUrl = Some(urlFor("changing")))
      )

      val firstRun  = Await.result(realFetchEngine.loadRows(ds, null), 5.seconds)
      val secondRun = Await.result(realFetchEngine.loadRows(ds, null), 5.seconds)

      // Root-cause evidence (task 1.2): the server WAS hit exactly twice
      // (once per run) — rules out mechanism (b), a conditional-request
      // header short-circuiting the fetch (that would show 0 hits, or a
      // 304 with no changed body) — and the returned rows carry the
      // server's CURRENT bytes, not the stale stored file, which rules out
      // mechanism (c)/(a): a storage read preferred over the network read.
      changingHits.get() shouldBe 2
      firstRun.head("content")  shouldBe "run-1-server-content"
      secondRun.head("content") shouldBe "run-2-server-content"
      firstRun.head("content") should not be secondRun.head("content")
    }
  }

  "loadRowsWithStats (HEL-881 task 4.1/4.2/4.4: text)" should {

    "an upload-created (sourceUrl = None) text source still reads the stored file and issues no network call" in {
      changingHits.set(0)
      val storedPath = "probe/upload-only.txt"
      Await.result(fileSystem.write(storedPath, "upload-content".getBytes(StandardCharsets.UTF_8)), 5.seconds)
      val ds = TextSource(
        id        = DataSourceId("ds-text-upload"),
        name      = "text-upload",
        ownerId   = userId,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = TextSourceConfig(storedPath, sourceUrl = None)
      )
      val rows = Await.result(realFetchEngine.loadRows(ds, null), 5.seconds)
      rows.head("content") shouldBe "upload-content"
      changingHits.get() shouldBe 0
    }

    "an http:// sourceUrl is still accepted on the run path (Decision 3 — text/pdf/image stay http-or-https, unlike CSV)" in {
      val ds = TextSource(
        id        = DataSourceId("ds-text-http"),
        name      = "text-http",
        ownerId   = userId,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = TextSourceConfig("probe/http-src.txt", sourceUrl = Some(urlFor("plain-http-text")))
      )
      val rows = Await.result(realFetchEngine.loadRows(ds, null), 5.seconds)
      rows.head("content") shouldBe "fetched-over-plain-http"
    }

    "a text source whose fetched content exceeds the configured limit fails the run rather than serving stored bytes" in {
      val ds = TextSource(
        id        = DataSourceId("ds-text-toolarge"),
        name      = "text-toolarge",
        ownerId   = userId,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = TextSourceConfig("probe/toolarge.txt", sourceUrl = Some(urlFor("too-large")))
      )
      val ex = intercept[IllegalArgumentException](Await.result(realFetchEngine.loadRows(ds, null), 5.seconds))
      ex.getMessage should include ("text-toolarge")
      ex.getMessage should include ("exceeds the maximum allowed size")
    }

    "a fetch failure (5xx upstream) fails the run with an error naming the source, never falling back to stored bytes" in {
      val storedPath = "probe/would-be-stale.txt"
      Await.result(fileSystem.write(storedPath, "should-never-be-served".getBytes(StandardCharsets.UTF_8)), 5.seconds)
      val ds = TextSource(
        id        = DataSourceId("ds-text-failing"),
        name      = "text-failing",
        ownerId   = userId,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = TextSourceConfig(storedPath, sourceUrl = Some(urlFor("boom")))
      )
      val ex = intercept[IllegalArgumentException](Await.result(realFetchEngine.loadRows(ds, null), 5.seconds))
      ex.getMessage should include ("text-failing")
    }

    "a default-seam (unconfigured) engine fails a URL-backed text run with 'not configured', rather than silently reading stored bytes" in {
      val storedPath = "probe/default-seam.txt"
      Await.result(fileSystem.write(storedPath, "should-never-be-served".getBytes(StandardCharsets.UTF_8)), 5.seconds)
      val defaultEngine = new InProcessPipelineEngine(fileSystem)(ec)
      val ds = TextSource(
        id        = DataSourceId("ds-text-default"),
        name      = "text-default",
        ownerId   = userId,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = TextSourceConfig(storedPath, sourceUrl = Some(urlFor("changing")))
      )
      val ex = intercept[IllegalArgumentException](Await.result(defaultEngine.loadRows(ds, null), 5.seconds))
      ex.getMessage should include ("not configured")
    }
  }

  "loadRowsWithStats (HEL-881 task 4.1: pdf)" should {

    "a URL-backed pdf source re-fetches and reflects CHANGED upstream page content across two runs" in {
      val pageSetA = PdfFixtures.multiPagePdf(Seq("Alpha v1"))
      val pageSetB = PdfFixtures.multiPagePdf(Seq("Alpha v2", "Beta v2"))
      var hits     = 0
      val routes = path("pdf-changing") {
        get {
          hits += 1
          val bytes = if (hits <= 1) pageSetA else pageSetB
          complete(HttpEntity(`application/octet-stream`, bytes))
        }
      }
      val binding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(routes), 10.seconds)
      try {
        val port = binding.localAddress.getPort
        val ds = PdfSource(
          id        = DataSourceId("ds-pdf-probe"),
          name      = "pdf-probe",
          ownerId   = userId,
          createdAt = Instant.now(),
          updatedAt = Instant.now(),
          config    = PdfSourceConfig("probe/pdf-stale.pdf", sourceUrl = Some(s"http://localhost:$port/pdf-changing"))
        )
        val firstRun  = Await.result(realFetchEngine.loadRows(ds, null), 5.seconds)
        val secondRun = Await.result(realFetchEngine.loadRows(ds, null), 5.seconds)
        firstRun should have size 1
        firstRun.head("content").asInstanceOf[String] should include ("Alpha v1")
        secondRun should have size 2
        secondRun.map(_("content").asInstanceOf[String].trim) should contain allOf ("Alpha v2", "Beta v2")
      } finally Await.ready(binding.unbind(), 10.seconds)
    }
  }

  "loadRowsWithStats (HEL-881 task 4.1/Decision 4: image)" should {

    def pngBytes(rgb: Int): Array[Byte] = {
      val img = new java.awt.image.BufferedImage(2, 2, java.awt.image.BufferedImage.TYPE_INT_RGB)
      val g   = img.createGraphics()
      g.setColor(new java.awt.Color(rgb))
      g.fillRect(0, 0, 2, 2)
      g.dispose()
      val baos = new java.io.ByteArrayOutputStream()
      javax.imageio.ImageIO.write(img, "png", baos)
      baos.toByteArray
    }

    "a URL-backed image source re-fetches, and the bytes reachable through storageKey change across two runs — not merely the dimensions" in {
      val redPng   = pngBytes(0xff0000)
      val greenPng = pngBytes(0x00ff00)
      var hits     = 0
      val routes = path("image-changing") {
        get {
          hits += 1
          val bytes = if (hits <= 1) redPng else greenPng
          complete(HttpEntity(`application/octet-stream`, bytes))
        }
      }
      val binding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(routes), 10.seconds)
      try {
        val port       = binding.localAddress.getPort
        val storageKey = "probe/image-refetched.png"
        // Seed the stored file with a THIRD, distinct image so the assertion can't
        // pass by coincidence if the engine failed to overwrite it.
        Await.result(fileSystem.write(storageKey, pngBytes(0x0000ff)), 5.seconds)

        val ds = ImageSource(
          id        = DataSourceId("ds-image-probe"),
          name      = "image-probe",
          ownerId   = userId,
          createdAt = Instant.now(),
          updatedAt = Instant.now(),
          config    = ImageSourceConfig(storageKey, sourceUrl = Some(s"http://localhost:$port/image-changing"))
        )
        Await.result(realFetchEngine.loadRows(ds, null), 5.seconds)
        val bytesOnDiskAfterRun1 = Await.result(fileSystem.read(storageKey), 5.seconds)
        bytesOnDiskAfterRun1 shouldBe redPng

        Await.result(realFetchEngine.loadRows(ds, null), 5.seconds)
        val bytesOnDiskAfterRun2 = Await.result(fileSystem.read(storageKey), 5.seconds)
        bytesOnDiskAfterRun2 shouldBe greenPng
        bytesOnDiskAfterRun1 should not be bytesOnDiskAfterRun2
      } finally Await.ready(binding.unbind(), 10.seconds)
    }
  }
}
