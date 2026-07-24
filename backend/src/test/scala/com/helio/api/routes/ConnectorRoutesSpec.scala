package com.helio.api.routes

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{ConnectorMetadataResponse, JsonProtocols}
import com.helio.domain.{AuthenticatedUser, UserId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.util.UUID

/** HEL-484 — `GET /api/connectors` HTTP-layer coverage. No DB dependency (unlike most route
 *  specs) since `ConnectorRoutes` wraps only the static `ConnectorRegistry`; the 401-unauthenticated
 *  case is covered separately in `ApiRoutesSpec`'s "Protected routes" suite, which exercises the
 *  full auth-directive stack this spec deliberately bypasses. */
class ConnectorRoutesSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with JsonProtocols {

  private val user  = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val routes = new ConnectorRoutes(user).routes

  "GET /connectors" should {

    "return 200 with exactly 7 entries, one per source kind" in {
      Get("/connectors") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val entries = responseAs[Vector[ConnectorMetadataResponse]]
        entries.map(_.kind).toSet shouldBe Set("csv", "rest_api", "sql", "static", "text", "pdf", "image")
        entries should have size 7
      }
    }

    "include non-empty requiredFields for every entry" in {
      Get("/connectors") ~> routes ~> check {
        val entries = responseAs[Vector[ConnectorMetadataResponse]]
        entries.foreach { entry =>
          entry.requiredFields shouldNot be(empty)
        }
      }
    }

    "never include a secret field value anywhere in the serialized response" in {
      // requiredFields carries name/label/secret descriptors only — assert no
      // stray "value"-shaped key and no plausible credential-looking string
      // sneaks into the payload (defense against a future accidental field add).
      Get("/connectors") ~> routes ~> check {
        val bodyStr = responseAs[JsValue].compactPrint
        bodyStr should not include "\"value\""
        bodyStr should not include "\"password\":\""
      }
    }

    "mark the sql entry's password field and no other sql field as secret" in {
      Get("/connectors") ~> routes ~> check {
        val entries = responseAs[Vector[ConnectorMetadataResponse]]
        val sql     = entries.find(_.kind == "sql").get
        sql.requiredFields.filter(_.secret).map(_.name) shouldBe Vector("password")
      }
    }

    "mark no rest_api field as secret (bearer/api-key live inside the optional auth object)" in {
      Get("/connectors") ~> routes ~> check {
        val entries  = responseAs[Vector[ConnectorMetadataResponse]]
        val restApi  = entries.find(_.kind == "rest_api").get
        restApi.requiredFields.exists(_.secret) shouldBe false
      }
    }
  }
}
