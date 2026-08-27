package com.helio.api.protocols.sources

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-826 task 2.2 — `RestApiConfigPayload.toDomain` decode-is-total coverage
 *  (design.md Decision 3): proves `toDomain` never rejects on `body`/`bodyContentType`/
 *  `rootSelector` semantics, and that the pre-existing validations it DOES perform
 *  (auth rejection, connectorId/url exclusivity, reserved-sentinel rejection) are
 *  unchanged by this ticket. */
class RestApiConfigPayloadToDomainSpec extends AnyWordSpec with Matchers {

  "RestApiConfigPayload.toDomain" should {

    "decode a GET+body payload successfully (no method/body validation in toDomain)" in {
      val payload = RestApiConfigPayload(
        connectorId = Some("conn-1"),
        method      = Some("GET"),
        body        = Some("""{"a":1}""")
      )
      val result = RestApiConfigPayload.toDomain(payload)
      result.isRight shouldBe true
      result.map(_.body) shouldBe Right(Some("""{"a":1}"""))
    }

    "decode a payload with an unparseable bodyContentType successfully (no content-type validation in toDomain)" in {
      val payload = RestApiConfigPayload(
        connectorId     = Some("conn-1"),
        bodyContentType = Some("not a content type;;;")
      )
      val result = RestApiConfigPayload.toDomain(payload)
      result.isRight shouldBe true
      result.map(_.bodyContentType) shouldBe Right(Some("not a content type;;;"))
    }

    "still rejects a payload carrying auth (pre-existing, unchanged)" in {
      import spray.json._
      val payload = RestApiConfigPayload(connectorId = Some("conn-1"), auth = Some(JsObject("type" -> JsString("bearer"))))
      RestApiConfigPayload.toDomain(payload).isLeft shouldBe true
    }

    "still rejects connectorId+url both present (pre-existing, unchanged)" in {
      val payload = RestApiConfigPayload(connectorId = Some("conn-1"), url = Some("http://example.com"))
      RestApiConfigPayload.toDomain(payload).isLeft shouldBe true
    }

    "still rejects a reserved-sentinel connectorId (pre-existing, unchanged)" in {
      val payload = RestApiConfigPayload(connectorId = Some("__malformed__"))
      RestApiConfigPayload.toDomain(payload).isLeft shouldBe true
    }
  }
}
