package com.helio.domain.connectors

import com.helio.domain.connectors.ConnectorFieldDescriptor
import com.helio.domain.connectors.ConnectorMetadata
import com.helio.domain.connectors.{ConnectorDriver, RestApiConnectorDriver}
import com.helio.domain.engine.SchemaInferenceEngine
import com.helio.domain.model.{EphemeralRestConfig, RestApiConfig}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** `RestApiConnectorDriver`-as-`ConnectorDriver[RestApiConfig]` coverage (HEL-449 tasks 4.3): `metadata`
 *  values, `testConnection` success on a non-JSON 200 body (proves the body is never parsed as
 *  JSON), and `fetch`/`inferSchema` parity with the existing `fetch`/`toRows` methods.
 *
 *  HEL-822: exercised via the `EphemeralRestConfig` path (design.md Decision 1c) — no
 *  `ConnectorRepository` is wired in this spec (no DB fixture here), and the ephemeral path
 *  shares the exact same HTTP-issue/response-parsing code (`issueAndParse`/`issueTest`) as the
 *  Connector-resolving path, so this still proves the request/response pipeline end to end.
 *  Connector-resolution + auth-header-application coverage lives in
 *  `RestApiConnectorDriverConnectorResolutionSpec` (DB-backed). */
class RestApiConnectorSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                   = _
  private def urlFor(path: String): String = s"http://localhost:$testServerPort/$path"

  override def beforeAll(): Unit = {
    val testRoutes = concat(
      path("plain-text-ok") {
        get { complete(HttpEntity(ContentTypes.`text/plain(UTF-8)`, "not json at all")) }
      },
      path("json-array") {
        get {
          complete(
            HttpEntity(
              ContentTypes.`application/json`,
              JsArray(
                JsObject("id" -> JsNumber(1), "name" -> JsString("a")),
                JsObject("id" -> JsNumber(2), "name" -> JsString("b")),
                JsObject("id" -> JsNumber(3), "name" -> JsString("c"))
              ).compactPrint
            )
          )
        }
      },
      path("server-error") {
        get { complete(StatusCodes.InternalServerError -> "boom") }
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

  private def config(path: String): EphemeralRestConfig =
    EphemeralRestConfig(url = urlFor(path), method = "GET", headers = Map.empty)

  private val connector: RestApiConnectorDriver = new RestApiConnectorDriver()

  "RestApiConnectorDriver.metadata" should {
    // HEL-822 design.md Decision 10: requiredFields now advertises the primary (new) required
    // field, `connectorId` — the legacy `url` alternative is dual-supported but not also
    // listed here.
    "expose kind=rest_api, displayName=REST API, supportsIncremental=false, authKind=configurable, requiredFields=[connectorId]" in {
      val asConnector: ConnectorDriver[RestApiConfig] = connector
      asConnector.metadata shouldBe ConnectorMetadata(
        kind = "rest_api",
        displayName = "REST API",
        supportsIncremental = false,
        authKind = "configurable",
        requiredFields = Vector(ConnectorFieldDescriptor(name = "connectorId", label = "Connector", secret = false))
      )
    }
  }

  "RestApiConnectorDriver.testConnectionEphemeral" should {

    "succeed on a non-JSON 200 response body (never parses the body as JSON)" in {
      await(connector.testConnectionEphemeral(config("plain-text-ok"))) shouldBe Right(())
    }

    "fail with an HTTP-status message on a non-2xx response" in {
      val result = await(connector.testConnectionEphemeral(config("server-error")))
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("500")
    }

    "fail with the 'Request failed' category message when the connection cannot be made" in {
      val unreachable = EphemeralRestConfig(url = "http://localhost:1/unreachable", method = "GET")
      await(connector.testConnectionEphemeral(unreachable)) shouldBe Left("Request failed")
    }
  }

  "RestApiConnectorDriver.fetchEphemeral" should {

    "match RestApiConnectorDriver.toRows(RestApiConnectorDriver.fetchEphemeral(config)) truncated" in {
      val expected = await(connector.fetchEphemeral(config("json-array"))).map(json => connector.toRows(json).take(2))

      expected shouldBe Right(Vector(
        JsObject("id" -> JsNumber(1), "name" -> JsString("a")),
        JsObject("id" -> JsNumber(2), "name" -> JsString("b"))
      ))
    }
  }

  "RestApiConnectorDriver.inferSchemaEphemeral" should {

    "derive fields from the same JSON payload SourceService.inferRest would infer from" in {
      val rawJson  = await(connector.fetchEphemeral(config("json-array"))).getOrElse(fail("expected Right"))
      val expected = SchemaInferenceEngine.fromJson(rawJson)

      val result = await(connector.inferSchemaEphemeral(config("json-array")))
      result.map(_.fields.map(_.name)) shouldBe Right(expected.fields.map(_.name))
    }
  }
}
