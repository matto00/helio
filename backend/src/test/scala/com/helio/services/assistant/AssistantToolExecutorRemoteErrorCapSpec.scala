package com.helio.services.assistant

import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.services.sources.{ContentSourceSupport, SourceService}
import com.helio.testkit.{HelioRouteTest, RemoteErrorBodyStub}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.net.InetAddress
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.Await

/** HEL-1841: the `test_connection` tool result, through a REAL `SourceService` and the REAL driver against a local
 *  server answering 500 with an oversized body, carries the capped error text. */
class AssistantToolExecutorRemoteErrorCapSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var binding: Http.ServerBinding = _
  private var port: Int                   = _

  private val admitLocalhost: (String, InetAddress) => Boolean =
    (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  private lazy val toolExecutor: AssistantToolExecutor = {
    val driver = new RestApiConnectorDriver(isBlocked = admitLocalhost)
    new AssistantToolExecutor(null, null, null, null, null, null, new SourceService(null, driver), AuthenticatedUser(UserId(UUID.randomUUID().toString)))
  }

  override def beforeAll(): Unit = {
    binding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(RemoteErrorBodyStub.route), 10.seconds)
    port = binding.localAddress.getPort
  }

  override def afterAll(): Unit = {
    Await.ready(binding.unbind(), 10.seconds)
    super.afterAll()
  }

  private def errorFor(path: String): (Boolean, String) = {
    val input = JsObject(
      "type"   -> JsString("rest_api"),
      "config" -> JsObject("url" -> JsString(s"http://localhost:$port/$path"), "method" -> JsString("GET"))
    )
    val result = Await.result(toolExecutor.execute("test_connection", input), 15.seconds)
    val json   = result.toOption.getOrElse(fail(s"expected a Right tool result, got $result")).parseJson.asJsObject
    (json.fields("ok") == JsBoolean(true), json.fields("error").asInstanceOf[JsString].value)
  }

  "execute(\"test_connection\") against a failing remote" should {
    "cap an oversized error body in the tool result" in {
      errorFor("big") shouldBe (false -> RemoteErrorBodyStub.ExpectedBig)
    }
    "not split a surrogate pair at the cut" in {
      errorFor("surrogate") shouldBe (false -> RemoteErrorBodyStub.ExpectedSurrogate)
    }
    "leave a short error unchanged" in {
      errorFor("short") shouldBe (false -> RemoteErrorBodyStub.ExpectedShort)
    }
  }
}
