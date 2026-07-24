package com.helio.domain

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

/** `RestApiConnector`-as-`Connector[RestApiConfig]` coverage (HEL-449 tasks 4.3): `metadata`
 *  values, `testConnection` success on a non-JSON 200 body (proves the body is never parsed as
 *  JSON), and `fetch`/`inferSchema` parity with the existing `fetch`/`toRows` methods.
 *
 *  `testConnection` always performs a real request/auth/header pipeline (it does not consult
 *  `fetchOverride` — see design.md Decision 4), so these tests bind a real local HTTP server
 *  rather than mocking `fetch`, following the pattern already used by `ContentSourceSupportSpec`
 *  and `DataSourceServiceSpec`. */
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

  private def config(path: String): RestApiConfig =
    RestApiConfig(url = urlFor(path), method = "GET", auth = RestApiAuth.NoAuth, headers = Map.empty)

  private val connector: Connector[RestApiConfig] = new RestApiConnector()

  "RestApiConnector.metadata" should {
    "expose kind=rest_api, displayName=REST API, supportsIncremental=false, authKind=configurable" in {
      connector.metadata shouldBe ConnectorMetadata(
        kind = "rest_api",
        displayName = "REST API",
        supportsIncremental = false,
        authKind = "configurable"
      )
    }
  }

  "RestApiConnector.testConnection" should {

    "succeed on a non-JSON 200 response body (never parses the body as JSON)" in {
      await(connector.testConnection(config("plain-text-ok"))) shouldBe Right(())
    }

    "fail with an HTTP-status message on a non-2xx response" in {
      val result = await(connector.testConnection(config("server-error")))
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("500")
    }

    "fail with the 'Request failed' category message when the connection cannot be made" in {
      val unreachable = RestApiConfig(url = "http://localhost:1/unreachable", method = "GET")
      await(connector.testConnection(unreachable)) shouldBe Left("Request failed")
    }
  }

  "RestApiConnector.fetch(config, maxRows) via the Connector trait" should {

    "match RestApiConnector.toRows(RestApiConnector.fetch(config)) truncated to maxRows" in {
      val plain = new RestApiConnector()
      val expected = await(plain.fetch(config("json-array"))).map(json => plain.toRows(json).take(2))

      val viaTrait = await(connector.fetch(config("json-array"), maxRows = 2))
      viaTrait shouldBe expected
      viaTrait shouldBe Right(Vector(
        JsObject("id" -> JsNumber(1), "name" -> JsString("a")),
        JsObject("id" -> JsNumber(2), "name" -> JsString("b"))
      ))
    }
  }

  "RestApiConnector.inferSchema via the Connector trait" should {

    "derive fields from the same JSON payload SourceService.inferRest would infer from" in {
      val plain    = new RestApiConnector()
      val rawJson  = await(plain.fetch(config("json-array"))).getOrElse(fail("expected Right"))
      val expected = SchemaInferenceEngine.fromJson(rawJson)

      val result = await(connector.inferSchema(config("json-array")))
      result.map(_.fields.map(_.name)) shouldBe Right(expected.fields.map(_.name))
    }
  }
}
