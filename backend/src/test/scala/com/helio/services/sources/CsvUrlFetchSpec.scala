package com.helio.services.sources

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.{ConnectionContext, Http}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.{ByteArrayOutputStream, FileInputStream}
import java.net.InetAddress
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.security.{KeyStore, SecureRandom}
import java.security.cert.X509Certificate
import javax.net.ssl.{KeyManagerFactory, SSLContext, TrustManager, X509TrustManager}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}
import scala.sys.process._
import scala.util.{Failure, Success, Try}

/** Unit tests for the [[CsvUrlFetch]] shared ingestion helper (HEL-862,
 *  design.md Decision 2) — the single implementation all three call sites
 *  (create, refresh, engine) delegate to.
 *
 *  A real, self-signed-cert HTTPS test server is stood up (via the JDK's own
 *  `keytool`, generating a throwaway PKCS12 keystore under a temp dir) so
 *  the https-only-and-successful-fetch tests exercise the REAL network path
 *  end to end, not a stub — `CsvUrlFetch.fetch` hard-rejects any non-`https`
 *  scheme before issuing a request, so a plain-HTTP test server (the pattern
 *  `ContentSourceSupportSpec` uses for text/pdf/image) cannot exercise this
 *  helper's success path at all. The client side installs a trust-all
 *  `SSLContext` as Pekko's default client HTTPS context so the self-signed
 *  cert is accepted without needing a CA-signed certificate in CI. */
class CsvUrlFetchSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                   = _
  private var keystoreDir: Path                     = _
  private def urlFor(path: String): String = s"https://localhost:$testServerPort/$path"

  private val normalCsv    = "a,b\n1,2\n3,4"
  private val bom          = "﻿"
  private val htmlBody     = "<!DOCTYPE html><html><body>rate limited</body></html>"
  private val oversizeBody = "a,b\n" + ("1,2\n" * 20_000_000) // comfortably over any reasonable test limit

  override def beforeAll(): Unit = {
    keystoreDir = Files.createTempDirectory("csv-url-fetch-spec")
    val keystorePath = keystoreDir.resolve("test.p12")
    val genCmd = Seq(
      "keytool", "-genkeypair", "-alias", "test", "-keyalg", "RSA", "-keysize", "2048",
      "-validity", "2", "-storetype", "PKCS12",
      "-keystore", keystorePath.toString, "-storepass", "changeit",
      "-dname", "CN=localhost", "-ext", "SAN=DNS:localhost,IP:127.0.0.1"
    )
    val exitCode = genCmd.!
    require(exitCode == 0, "keytool self-signed cert generation failed")

    val ks = KeyStore.getInstance("PKCS12")
    val in = new FileInputStream(keystorePath.toFile)
    try ks.load(in, "changeit".toCharArray) finally in.close()

    val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm)
    kmf.init(ks, "changeit".toCharArray)
    val serverSslContext = SSLContext.getInstance("TLS")
    serverSslContext.init(kmf.getKeyManagers, null, null)

    // Trust-all client context — acceptable ONLY for this throwaway test
    // keystore/server pair; installed as Pekko's default *client* HTTPS
    // context so `ContentSourceSupport.fetchUrl` (which builds no HTTPS
    // context of its own) can complete a TLS handshake against the
    // self-signed cert above without a CA-signed certificate in CI.
    val trustAllManager: TrustManager = new X509TrustManager {
      def checkClientTrusted(chain: Array[X509Certificate], authType: String): Unit = ()
      def checkServerTrusted(chain: Array[X509Certificate], authType: String): Unit = ()
      def getAcceptedIssuers: Array[X509Certificate] = Array.empty
    }
    val clientSslContext = SSLContext.getInstance("TLS")
    clientSslContext.init(null, Array(trustAllManager), new SecureRandom())
    Http(typedSystem.classicSystem).setDefaultClientHttpsContext(ConnectionContext.httpsClient(clientSslContext))

    val testRoutes = concat(
      path("csv") {
        get { complete(HttpEntity(ContentTypes.`text/csv(UTF-8)`, normalCsv)) }
      },
      path("csv-bom") {
        get { complete(HttpEntity(ContentTypes.`text/csv(UTF-8)`, bom + normalCsv)) }
      },
      path("html") {
        get { complete(HttpEntity(ContentTypes.`text/html(UTF-8)`, htmlBody)) }
      },
      path("html-bom") {
        get { complete(HttpEntity(ContentTypes.`text/html(UTF-8)`, bom + htmlBody)) }
      },
      path("oversize") {
        get { complete(HttpEntity(ContentTypes.`text/csv(UTF-8)`, oversizeBody)) }
      },
      path("not-found") {
        get { complete(StatusCodes.NotFound) }
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
    Try(deleteRecursively(keystoreDir))
    super.afterAll()
  }

  private def deleteRecursively(p: Path): Unit = {
    if (Files.isDirectory(p)) Files.list(p).forEach(deleteRecursively)
    Files.deleteIfExists(p)
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def admitLocalhost(host: String, addr: InetAddress): Boolean =
    if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  "CsvUrlFetch.fetch — https-only scheme gate" should {

    "reject an http:// URL before any request is issued, naming the scheme and requiring https" in {
      var resolveCalled = false
      val recordingResolver: String => Try[Array[InetAddress]] = host => {
        resolveCalled = true; ContentSourceSupport.defaultResolveHost(host)
      }
      val result = await(CsvUrlFetch.fetch("http://example.com/data.csv", 1000L, recordingResolver))
      result should matchPattern {
        case Left(CsvUrlFetchError.InvalidScheme(msg)) if msg.contains("http") && msg.toLowerCase.contains("https") =>
      }
      resolveCalled shouldBe false
    }

    "reject a file:// URL" in {
      val result = await(CsvUrlFetch.fetch("file:///etc/passwd", 1000L))
      result should matchPattern { case Left(CsvUrlFetchError.InvalidScheme(msg)) if msg.contains("file") => }
    }

    "reject an ftp:// URL" in {
      val result = await(CsvUrlFetch.fetch("ftp://example.com/data.csv", 1000L))
      result should matchPattern { case Left(CsvUrlFetchError.InvalidScheme(msg)) if msg.contains("ftp") => }
    }

    "reject a gopher:// URL" in {
      val result = await(CsvUrlFetch.fetch("gopher://example.com/data.csv", 1000L))
      result should matchPattern { case Left(CsvUrlFetchError.InvalidScheme(msg)) if msg.contains("gopher") => }
    }

    "reject a schemeless string" in {
      val result = await(CsvUrlFetch.fetch("not-a-url", 1000L))
      result should matchPattern { case Left(CsvUrlFetchError.InvalidScheme(_)) => }
    }

    "accept an https:// URL, exercising the real HTTPS network path" in {
      val result = await(CsvUrlFetch.fetch(urlFor("csv"), 1000000L, isBlocked = admitLocalhost))
      result.map(new String(_, StandardCharsets.UTF_8)) shouldBe Right(normalCsv)
    }
  }

  "CsvUrlFetch.fetch — address denylist reuse" should {

    "reject a loopback-resolving host" in {
      val resolver: String => Try[Array[InetAddress]] = _ => Success(Array(InetAddress.getByName("127.0.0.1")))
      val result = await(CsvUrlFetch.fetch("https://sneaky.example/data.csv", 1000L, resolver))
      result should matchPattern { case Left(CsvUrlFetchError.Upstream(msg)) if msg.contains("disallowed address") => }
    }

    "reject the cloud-metadata link-local address 169.254.169.254" in {
      val resolver: String => Try[Array[InetAddress]] = _ => Success(Array(InetAddress.getByName("169.254.169.254")))
      val result = await(CsvUrlFetch.fetch("https://sneaky.example/data.csv", 1000L, resolver))
      result should matchPattern { case Left(CsvUrlFetchError.Upstream(msg)) if msg.contains("disallowed address") => }
    }

    "reject an RFC1918 private address" in {
      val resolver: String => Try[Array[InetAddress]] = _ => Success(Array(InetAddress.getByName("10.0.0.5")))
      val result = await(CsvUrlFetch.fetch("https://sneaky.example/data.csv", 1000L, resolver))
      result should matchPattern { case Left(CsvUrlFetchError.Upstream(msg)) if msg.contains("disallowed address") => }
    }

    "reject an IPv6 unique-local address" in {
      val resolver: String => Try[Array[InetAddress]] = _ => Success(Array(InetAddress.getByName("fd12:3456::1")))
      val result = await(CsvUrlFetch.fetch("https://sneaky.example/data.csv", 1000L, resolver))
      result should matchPattern { case Left(CsvUrlFetchError.Upstream(msg)) if msg.contains("disallowed address") => }
    }

    "reject an any-local address" in {
      val resolver: String => Try[Array[InetAddress]] = _ => Success(Array(InetAddress.getByName("0.0.0.0")))
      val result = await(CsvUrlFetch.fetch("https://sneaky.example/data.csv", 1000L, resolver))
      result should matchPattern { case Left(CsvUrlFetchError.Upstream(msg)) if msg.contains("disallowed address") => }
    }

    "reject a multicast address" in {
      val resolver: String => Try[Array[InetAddress]] = _ => Success(Array(InetAddress.getByName("224.0.0.1")))
      val result = await(CsvUrlFetch.fetch("https://sneaky.example/data.csv", 1000L, resolver))
      result should matchPattern { case Left(CsvUrlFetchError.Upstream(msg)) if msg.contains("disallowed address") => }
    }
  }

  "CsvUrlFetch.fetch — size limit" should {

    "reject a body over the configured limit with TooLarge naming the limit" in {
      val result = await(CsvUrlFetch.fetch(urlFor("oversize"), 100L, isBlocked = admitLocalhost))
      result should matchPattern { case Left(CsvUrlFetchError.TooLarge(msg)) if msg.contains("100") => }
    }

    "accept a body within the limit" in {
      val result = await(CsvUrlFetch.fetch(urlFor("csv"), 1000000L, isBlocked = admitLocalhost))
      result shouldBe a[Right[_, _]]
    }
  }

  "CsvUrlFetch.fetch — non-CSV body gate" should {

    "reject an HTML body served with HTTP 200, naming the URL and stating HTML/XML was returned" in {
      val url    = urlFor("html")
      val result = await(CsvUrlFetch.fetch(url, 1000000L, isBlocked = admitLocalhost))
      result should matchPattern {
        case Left(CsvUrlFetchError.NotCsv(msg)) if msg.contains(url) && msg.toLowerCase.contains("html") =>
      }
    }

    "reject a BOM-prefixed HTML body — the BOM must not smuggle it past the gate" in {
      val result = await(CsvUrlFetch.fetch(urlFor("html-bom"), 1000000L, isBlocked = admitLocalhost))
      result should matchPattern { case Left(CsvUrlFetchError.NotCsv(_)) => }
    }

    "accept a normal CSV body" in {
      val result = await(CsvUrlFetch.fetch(urlFor("csv"), 1000000L, isBlocked = admitLocalhost))
      result.map(new String(_, StandardCharsets.UTF_8)) shouldBe Right(normalCsv)
    }

    "accept a BOM-prefixed normal CSV body" in {
      val result = await(CsvUrlFetch.fetch(urlFor("csv-bom"), 1000000L, isBlocked = admitLocalhost))
      result.map(new String(_, StandardCharsets.UTF_8)) shouldBe Right(bom + normalCsv)
    }
  }

  "CsvUrlFetch.fetch — upstream errors" should {

    "wrap a non-2xx upstream response as Upstream, preserving the underlying message" in {
      val result = await(CsvUrlFetch.fetch(urlFor("not-found"), 1000000L, isBlocked = admitLocalhost))
      result should matchPattern { case Left(CsvUrlFetchError.Upstream(msg)) if msg.contains("404") => }
    }
  }

  "CsvUrlFetch.maxFileSizeBytes" should {
    "default to 50 MiB (52428800 bytes) when CSV_MAX_FILE_SIZE_BYTES is unset" in {
      // This assertion only holds when the env var truly is unset in the
      // test environment, matching the pre-existing route-layer default.
      if (sys.env.get("CSV_MAX_FILE_SIZE_BYTES").isEmpty)
        CsvUrlFetch.maxFileSizeBytes shouldBe 52428800L
    }
  }
}
