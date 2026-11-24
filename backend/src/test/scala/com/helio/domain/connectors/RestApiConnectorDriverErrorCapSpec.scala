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
import scala.concurrent.{Await, Future}

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
  }
}
