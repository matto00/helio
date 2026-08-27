package com.helio.domain.connectors

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Regression coverage for a root-caused bug found during HEL-822 cycle-2 verification: a bare
 *  `jsonFormat5`-derived format treats every field as required on read, ignoring Scala default
 *  values for `defaultHeaders`/`implicit` — every pre-HEL-822 `connectors.config` row (written
 *  before `implicit` existed) would silently parse-fail and fall back to `authType = "none"`
 *  with an EMPTY `defaultHeaders`, discarding a real Connector's stored auth shape without any
 *  signal. `ConnectorAuthShape.format` is hand-rolled specifically to avoid this. */
class ConnectorAuthShapeSpec extends AnyWordSpec with Matchers {

  "ConnectorAuthShape.parse" should {

    "defaults `implicit` to false and preserves authType/defaultHeaders for a pre-HEL-822 blob missing the `implicit` key" in {
      val preHel822Blob = """{"authType":"bearer","defaultHeaders":{"X-Env":"prod"}}"""
      val parsed = ConnectorAuthShape.parse(preHel822Blob)
      parsed.authType shouldBe "bearer"
      parsed.defaultHeaders shouldBe Map("X-Env" -> "prod")
      parsed.`implicit` shouldBe false
    }

    "defaults `defaultHeaders` to empty and `implicit` to false when both are absent" in {
      val parsed = ConnectorAuthShape.parse("""{"authType":"none"}""")
      parsed.authType shouldBe "none"
      parsed.defaultHeaders shouldBe Map.empty
      parsed.`implicit` shouldBe false
    }

    "round-trips authType/apiKeyName/apiKeyPlacement/defaultHeaders/implicit through encode -> parse" in {
      val shape = ConnectorAuthShape(
        authType        = "api_key",
        apiKeyName      = Some("X-Api-Key"),
        apiKeyPlacement = Some("header"),
        defaultHeaders  = Map("Accept" -> "application/xml"),
        `implicit`      = true
      )
      ConnectorAuthShape.parse(ConnectorAuthShape.encode(shape)) shouldBe shape
    }

    "falls back to authType = \"none\" for genuinely non-JSON input, never throwing" in {
      ConnectorAuthShape.parse("not json at all").authType shouldBe "none"
    }

    "falls back to authType = \"none\" for a JSON array (not an object)" in {
      ConnectorAuthShape.parse("[1,2,3]").authType shouldBe "none"
    }
  }
}
