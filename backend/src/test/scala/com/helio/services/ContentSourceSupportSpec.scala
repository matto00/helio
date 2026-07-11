package com.helio.services

import com.helio.domain.DataFieldType
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.headers.Location
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.net.{InetAddress, UnknownHostException}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}
import scala.util.{Failure, Success, Try}

/** Unit tests for the [[ContentSourceSupport]] seam (HEL-215): the
 *  metadata-field builder future content connectors (HEL-214/HEL-216) reuse,
 *  plus the extension-validation and URL-filename helpers, and (cycle-2
 *  fix) the SSRF guard `fetchUrl`/`validateUrl` enforce. */
class ContentSourceSupportSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  // Local test server for the fetchUrl-level SSRF tests below — its
  // hostname ("localhost") resolves to loopback via *real*, unmodified DNS
  // (see `admitLocalhost` below), so these tests exercise the real
  // `defaultResolveHost` and only override the (hostname-keyed) `isBlocked`
  // denylist check to admit this one known-safe test hostname, rather than
  // lying about what address it resolves to (see HEL-215 cycle-3 fix — a
  // resolver that lies about the resolved address is exactly the decoupling
  // the DNS-rebinding TOCTOU exploited, and no longer works now that
  // `fetchUrl` pins the real connection to whatever `resolveHost` returns).
  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                   = _
  private def urlFor(path: String): String = s"http://localhost:$testServerPort/$path"

  override def beforeAll(): Unit = {
    val testRoutes = concat(
      path("ok.txt") {
        get { complete(HttpEntity(ContentTypes.`text/plain(UTF-8)`, "hello")) }
      },
      path("redirect-to-metadata") {
        get {
          redirect("http://169.254.169.254/computeMetadata/v1/", StatusCodes.Found)
        }
      },
      path("secret-error") {
        get { complete(StatusCodes.InternalServerError -> "super-secret-upstream-body") }
      }
    )
    testServerBinding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(testRoutes), 10.seconds)
    testServerPort = testServerBinding.localAddress.getPort
  }

  override def afterAll(): Unit = {
    Await.ready(testServerBinding.unbind(), 10.seconds)
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  // Admits the real address "localhost" resolves to (via `defaultResolveHost`
  // — no override needed, no lie) past the denylist for exactly this
  // hostname; every other host still goes through the real, unmodified
  // `ContentSourceSupport.isBlockedAddress` check. This is the seam that
  // replaced the pre-cycle-3 "permissiveResolver" pattern, which lied about
  // the resolved address (mapping "localhost" to a fake public IP) purely to
  // pass the old address-only guard — a lie that only worked because
  // `fetchUrl` never pinned the real connection to what it validated. Now
  // that it does, validation and connection always agree on the exact same
  // resolved address, so the only thing left to override for tests is
  // whether that address is treated as blocked.
  private def admitLocalhost(host: String, addr: InetAddress): Boolean =
    if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  "ContentSourceSupport.metadataFields" should {

    "build the {content, filename, sizeBytes} triple with StringBodyType for the text connector" in {
      val fields = ContentSourceSupport.metadataFields(DataFieldType.StringBodyType, "notes.txt", 42L)
      fields.map(_.name) shouldBe Vector("content", "filename", "sizeBytes")
      fields.find(_.name == "content").map(_.dataType)   shouldBe Some("string-body")
      fields.find(_.name == "filename").map(_.dataType)  shouldBe Some("string")
      fields.find(_.name == "sizeBytes").map(_.dataType) shouldBe Some("integer")
    }

    "vary only the content field's type when parameterized with BinaryRefType (future PDF/image seam)" in {
      val fields = ContentSourceSupport.metadataFields(DataFieldType.BinaryRefType, "scan.pdf", 1024L)
      fields.find(_.name == "content").map(_.dataType)   shouldBe Some("binary-ref")
      fields.find(_.name == "filename").map(_.dataType)  shouldBe Some("string")
      fields.find(_.name == "sizeBytes").map(_.dataType) shouldBe Some("integer")
    }
  }

  "ContentSourceSupport.validateExtension" should {

    "accept a filename with an allowed extension (case-insensitive)" in {
      ContentSourceSupport.validateExtension("notes.TXT", ContentSourceSupport.TextExtensions) shouldBe Right("txt")
      ContentSourceSupport.validateExtension("README.md", ContentSourceSupport.TextExtensions) shouldBe Right("md")
    }

    "reject a filename with an unsupported extension" in {
      ContentSourceSupport.validateExtension("data.csv", ContentSourceSupport.TextExtensions) should matchPattern {
        case Left(_) =>
      }
    }

    "reject a filename with no extension" in {
      ContentSourceSupport.validateExtension("noext", ContentSourceSupport.TextExtensions) should matchPattern {
        case Left(_) =>
      }
    }
  }

  "ContentSourceSupport.filenameFromUrl" should {

    "extract the last path segment" in {
      ContentSourceSupport.filenameFromUrl("https://example.com/docs/notes.txt") shouldBe "notes.txt"
    }

    "ignore query string and fragment" in {
      ContentSourceSupport.filenameFromUrl("https://example.com/readme.md?x=1#frag") shouldBe "readme.md"
    }

    "fall back to 'downloaded' when the URL has no path segments" in {
      ContentSourceSupport.filenameFromUrl("https://example.com") shouldBe "downloaded"
      ContentSourceSupport.filenameFromUrl("https://example.com/") shouldBe "downloaded"
    }
  }

  // ── SSRF guard (HEL-215 cycle-2 fix) ───────────────────────────────────────

  "ContentSourceSupport.isBlockedAddress" should {

    "block loopback addresses (IPv4 and IPv6)" in {
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("127.0.0.1")) shouldBe true
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("::1")) shouldBe true
    }

    "block the GCP/AWS cloud metadata address and the wider link-local range" in {
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("169.254.169.254")) shouldBe true
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("169.254.1.1")) shouldBe true
    }

    "block RFC1918 private IPv4 ranges" in {
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("10.0.0.5")) shouldBe true
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("172.16.0.5")) shouldBe true
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("192.168.1.1")) shouldBe true
    }

    "block unique-local IPv6 (fc00::/7)" in {
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("fc00::1")) shouldBe true
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("fd12:3456::1")) shouldBe true
    }

    "block any-local and multicast addresses" in {
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("0.0.0.0")) shouldBe true
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("224.0.0.1")) shouldBe true
    }

    "not block a normal public-style address" in {
      ContentSourceSupport.isBlockedAddress(InetAddress.getByName("93.184.216.34")) shouldBe false
    }
  }

  "ContentSourceSupport.validateUrl" should {

    "reject non-http(s) schemes before ever attempting to resolve a host" in {
      var resolveCalled = false
      val resolver: String => Try[Array[InetAddress]] = host => {
        resolveCalled = true; ContentSourceSupport.defaultResolveHost(host)
      }
      ContentSourceSupport.validateUrl("file:///etc/passwd", resolver) should matchPattern {
        case Left(msg: String) if msg.contains("scheme") =>
      }
      resolveCalled shouldBe false
    }

    "reject a URL with no host" in {
      ContentSourceSupport.validateUrl("http://") should matchPattern { case Left(_) => }
    }

    "reject when DNS resolution fails" in {
      val failingResolver: String => Try[Array[InetAddress]] =
        _ => Failure(new UnknownHostException("simulated resolution failure"))
      ContentSourceSupport.validateUrl("https://this-host-does-not-resolve.example", failingResolver) should matchPattern {
        case Left(msg: String) if msg.contains("resolve") =>
      }
    }

    "reject a host that resolves to a blocked address" in {
      val blockedResolver: String => Try[Array[InetAddress]] =
        _ => Success(Array(InetAddress.getByName("127.0.0.1")))
      ContentSourceSupport.validateUrl("https://sneaky.example", blockedResolver) should matchPattern {
        case Left(msg: String) if msg.contains("disallowed address") =>
      }
    }

    "accept a host that resolves to a permitted address" in {
      val allowedResolver: String => Try[Array[InetAddress]] =
        _ => Success(Array(InetAddress.getByName("93.184.216.34")))
      ContentSourceSupport.validateUrl("https://example.com", allowedResolver) shouldBe Right(())
    }
  }

  "ContentSourceSupport.fetchUrl" should {

    "reject a loopback URL before issuing any request (default resolver)" in {
      val result = await(ContentSourceSupport.fetchUrl(urlFor("ok.txt")))
      result should matchPattern { case Left(msg: String) if msg.contains("disallowed address") => }
    }

    "succeed against a permitted (test-admitted) host, exercising the real HTTP path" in {
      val result = await(ContentSourceSupport.fetchUrl(urlFor("ok.txt"), isBlocked = admitLocalhost))
      result.map(new String(_, "UTF-8")) shouldBe Right("hello")
    }

    "not follow a redirect to an internal address, and not echo the upstream body on error" in {
      // Root cause (probe-confirmed, see ContentSourceSupport.fetchUrl):
      // Pekko HTTP's low-level client never auto-follows 3xx responses (a
      // real network request to the internal Location is never made), but
      // `StatusCode.isSuccess` is `true` for 3xx too — this test guards
      // against re-introducing that misclassification, which would silently
      // treat the redirect stub page as successfully-fetched content.
      val result = await(ContentSourceSupport.fetchUrl(urlFor("redirect-to-metadata"), isBlocked = admitLocalhost))
      result match {
        case Left(msg) =>
          msg should include("302")
          msg should not include "169.254.169.254"
        case Right(_) => fail("Expected the redirect to NOT be followed")
      }
    }

    "return a generic error message on a non-success response, without echoing the response body" in {
      val result = await(ContentSourceSupport.fetchUrl(urlFor("secret-error"), isBlocked = admitLocalhost))
      result match {
        case Left(msg) =>
          msg should include("500")
          msg should not include "super-secret-upstream-body"
        case Right(_) => fail("Expected a non-success response")
      }
    }

    // ── DNS-rebinding TOCTOU regression (HEL-215 cycle-3 fix) ────────────────
    //
    // Skeptic final-gate round 1 (`skeptic-final-1.md`) REFUTEd cycle 2's SSRF
    // guard because `validateUrl` resolved+checked a hostname but then
    // `fetchUrl` re-issued the request against the *hostname string*, letting
    // Pekko HTTP re-resolve it independently when opening the TCP connection.
    // A caller who controls DNS for a hostname (first answer: permitted;
    // second, independent answer moments later: 169.254.169.254/loopback/
    // RFC1918) could pass validation and still land the real connection on a
    // disallowed address.
    //
    // This test proves the fix closes that gap with a scenario that has
    // discriminating power (would FAIL before the fix, per the systematic-
    // debugging law): `rebindHost` below is not a real, resolvable DNS name.
    // If `fetchUrl` still let Pekko HTTP re-resolve it independently at
    // connect time (the pre-fix behavior), that second resolution would
    // raise `UnknownHostException` — this hostname genuinely does not exist
    // — and the request would fail. The *only* way this request can succeed
    // is if the actual TCP connection is pinned to the exact `InetAddress`
    // `resolveHost` already resolved and validated (this suite's real local
    // test server's loopback address), never re-resolving `rebindHost` at
    // all. `resolveCallCount` additionally confirms `resolveHost` itself is
    // invoked exactly once for the whole fetch (validation and pinning share
    // the single resolution — there is no second, independent lookup for
    // fetchUrl's own resolveHost call site to disagree with, and Pekko's
    // connection-layer lookup is bypassed entirely by the pinned transport).
    "pin the real TCP connection to the resolved address, closing the DNS-rebinding TOCTOU" in {
      val rebindHost = "rebind-test.invalid" // not a real, resolvable DNS name
      var resolveCallCount = 0
      val rebindingResolver: String => Try[Array[InetAddress]] = host => {
        resolveCallCount += 1
        if (host == rebindHost) Success(Array(InetAddress.getByName("localhost")))
        else ContentSourceSupport.defaultResolveHost(host)
      }
      val admitRebindHost: (String, InetAddress) => Boolean =
        (host, addr) => if (host == rebindHost) false else ContentSourceSupport.isBlockedAddress(addr)

      val result = await(
        ContentSourceSupport.fetchUrl(s"http://$rebindHost:$testServerPort/ok.txt", rebindingResolver, admitRebindHost)
      )

      result.map(new String(_, "UTF-8")) shouldBe Right("hello")
      resolveCallCount shouldBe 1
    }
  }
}
