package com.helio.domain.connectors

import com.helio.domain.model.EphemeralRestConfig
import com.helio.services.sources.ContentSourceSupport
import com.helio.testkit.{HelioRouteTest, RemoteErrorBodyStub}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.net.InetAddress
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.util.{Failure, Success}
import spray.json.{JsArray, JsNumber}
import java.util.UUID

/** HEL-1841: the REAL driver caps the remote error text it builds (`issueAndParse` for fetches, `issueTest` for
 *  connection tests) against a local server answering 500 with an oversized body. */
class RestApiConnectorDriverErrorCapSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var binding: Http.ServerBinding = _
  private var port: Int                   = _
  private def cfg(path: String)           = EphemeralRestConfig(url = s"http://localhost:$port/$path", method = "GET")

  private val admitLocalhost: (String, InetAddress) => Boolean =
    (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)
  private lazy val driver = new RestApiConnectorDriver(isBlocked = admitLocalhost)

  override def beforeAll(): Unit = {
    binding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(RemoteErrorBodyStub.route), 10.seconds)
    port = binding.localAddress.getPort
  }

  override def afterAll(): Unit = {
    Await.ready(binding.unbind(), 10.seconds)
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  "RestApiConnectorDriver non-2xx error text" should {
    "cap an oversized body on the fetch path (issueAndParse)" in {
      await(driver.fetchEphemeral(cfg("big"))) shouldBe Left(RemoteErrorBodyStub.ExpectedBig)
    }
    "cap an oversized body on the connection-test path (issueTest)" in {
      await(driver.testConnectionEphemeral(cfg("big"))) shouldBe Left(RemoteErrorBodyStub.ExpectedBig)
    }
    "not split a surrogate pair at the cut on the fetch path" in {
      await(driver.fetchEphemeral(cfg("surrogate"))) shouldBe Left(RemoteErrorBodyStub.ExpectedSurrogate)
    }
    "not split a surrogate pair at the cut on the connection-test path" in {
      await(driver.testConnectionEphemeral(cfg("surrogate"))) shouldBe Left(RemoteErrorBodyStub.ExpectedSurrogate)
    }
    "leave a short error unchanged on both paths" in {
      await(driver.fetchEphemeral(cfg("short"))) shouldBe Left(RemoteErrorBodyStub.ExpectedShort)
      await(driver.testConnectionEphemeral(cfg("short"))) shouldBe Left(RemoteErrorBodyStub.ExpectedShort)
    }

    // HEL-1877 GUARDs (failable by mutation): the capped text is the one the full body would have produced. The
    // expected values for /multibyte and /malformed are computed from the full body; the literal /big and /surrogate
    // cases above still pin `cap` itself.
    "equal the capped full body for a multibyte body cut inside a character, on both paths" in {
      await(driver.fetchEphemeral(cfg("multibyte"))) shouldBe Left(RemoteErrorBodyStub.ExpectedMultibyte)
      await(driver.testConnectionEphemeral(cfg("multibyte"))) shouldBe Left(RemoteErrorBodyStub.ExpectedMultibyte)
    }
    "equal the capped full body for malformed UTF-8 in the head, on both paths" in {
      await(driver.fetchEphemeral(cfg("malformed"))) shouldBe Left(RemoteErrorBodyStub.ExpectedMalformed)
      await(driver.testConnectionEphemeral(cfg("malformed"))) shouldBe Left(RemoteErrorBodyStub.ExpectedMalformed)
    }
  }

  // The driver future's completion callback reads the server-side counter into a Promise: an assertion thrown inside
  // `onComplete` would be swallowed, so the assertion runs on the awaited value.
  private def emittedAtCompletion[T](id: String)(run: => Future[T]): (T, Long) = {
    val p = Promise[(T, Long)]()
    run.onComplete {
      case Success(v) => p.success((v, RemoteErrorBodyStub.emittedBytes(id)))
      case Failure(e) => p.failure(e)
    }(ExecutionContext.global)
    await(p.future)
  }

  private val ByteBound = 4096 + 4 * RemoteErrorBodyStub.ChunkBytes

  "RestApiConnectorDriver error body read bound (HEL-1877)" should {
    "stop reading a never-ending error body at the byte bound on the fetch path" in {
      val id = UUID.randomUUID().toString
      val (result, emitted) = emittedAtCompletion(id)(driver.fetchEphemeral(cfg(s"endless?id=$id")))
      info(s"/endless emitted bytes at completion: $emitted")
      result shouldBe Left(RemoteErrorBodyStub.ExpectedBig)
      emitted should be <= ByteBound.toLong
    }
    "stop reading a never-ending error body at the byte bound on the connection-test path" in {
      val id = UUID.randomUUID().toString
      val (result, emitted) = emittedAtCompletion(id)(driver.testConnectionEphemeral(cfg(s"endless?id=$id")))
      info(s"/endless emitted bytes at completion: $emitted")
      result shouldBe Left(RemoteErrorBodyStub.ExpectedBig)
      emitted should be <= ByteBound.toLong
    }
    "not read a 64 MiB error body past the old 8 MiB ceiling on the fetch path" in {
      val id = UUID.randomUUID().toString
      val (result, emitted) = emittedAtCompletion(id)(driver.fetchEphemeral(cfg(s"huge?id=$id")))
      info(s"/huge fetch emitted bytes at completion: $emitted")
      result shouldBe Left(RemoteErrorBodyStub.ExpectedBig)
      emitted should be < 8388608L
    }
    "not read a 64 MiB error body past the old 8 MiB ceiling on the connection-test path" in {
      val id = UUID.randomUUID().toString
      val (result, emitted) = emittedAtCompletion(id)(driver.testConnectionEphemeral(cfg(s"huge?id=$id")))
      info(s"/huge test emitted bytes at completion: $emitted")
      result shouldBe Left(RemoteErrorBodyStub.ExpectedBig)
      emitted should be < 8388608L
    }
  }

  // Success-path GUARDs, two-sided around the literal 8388608 (never the production accessor).
  "RestApiConnectorDriver 2xx size ceiling (HEL-1877)" should {
    val Ok = Right(JsArray(JsNumber(1)))
    "accept a body of exactly 8388608 bytes, chunked and with Content-Length, on fetch" in {
      await(driver.fetchEphemeral(cfg("exact-chunked"))) shouldBe Ok
      await(driver.fetchEphemeral(cfg("exact-length"))) shouldBe Ok
    }
    "accept a body of exactly 8388608 bytes, chunked and with Content-Length, on the connection test" in {
      await(driver.testConnectionEphemeral(cfg("exact-chunked"))) shouldBe Right(())
      await(driver.testConnectionEphemeral(cfg("exact-length"))) shouldBe Right(())
    }
    "report Request failed for 8388609 bytes, chunked and with Content-Length, on fetch" in {
      await(driver.fetchEphemeral(cfg("over-chunked"))) shouldBe Left("Request failed")
      await(driver.fetchEphemeral(cfg("over-length"))) shouldBe Left("Request failed")
    }
    "report Request failed for 8388609 bytes, chunked and with Content-Length, on the connection test" in {
      await(driver.testConnectionEphemeral(cfg("over-chunked"))) shouldBe Left("Request failed")
      await(driver.testConnectionEphemeral(cfg("over-length"))) shouldBe Left("Request failed")
    }
  }

  "ContentSourceSupport.fetchUrl non-2xx (HEL-1877)" should {
    "stop reading a never-ending non-2xx body and report the status" in {
      val id = UUID.randomUUID().toString
      val (result, emitted) = emittedAtCompletion(id)(
        ContentSourceSupport.fetchUrl(s"http://localhost:$port/endless?id=$id", isBlocked = admitLocalhost)
      )
      info(s"fetchUrl /endless emitted bytes at completion: $emitted")
      result shouldBe Left("Upstream returned HTTP 500")
      emitted should be <= ByteBound.toLong
    }
  }
}
