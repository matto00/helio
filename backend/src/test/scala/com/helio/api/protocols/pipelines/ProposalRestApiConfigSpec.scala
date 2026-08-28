package com.helio.api.protocols.pipelines

import com.helio.api.protocols.sources.RestApiConfigPayload
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-829 tasks.md 1.4 — round-trip JSON coverage for the two new,
 *  proposal-only types (design.md Decision 2), and `ProposalRestApiConfig.
 *  toRestApiConfigPayload`'s field-mapping adapter. */
class ProposalRestApiConfigSpec extends AnyWordSpec with Matchers with PipelineProposalProtocol {

  private val draft = NewConnectorDraft(
    name                   = "Stripe",
    baseUrl                = "https://api.stripe.com",
    authType               = "api_key",
    apiKeyName             = Some("Authorization"),
    apiKeyPlacement        = Some("header"),
    retrievalInstructions  = "Generate an API key at https://dashboard.stripe.com/apikeys"
  )

  "NewConnectorDraft round-trip" should {
    "preserve every field through write/read" in {
      draft.toJson.convertTo[NewConnectorDraft] shouldBe draft
    }

    "tolerate absent optional fields" in {
      val minimal = NewConnectorDraft("X", "https://x.example.com", "none", None, None, "No key required")
      minimal.toJson.convertTo[NewConnectorDraft] shouldBe minimal
    }
  }

  "ProposalRestApiConfig round-trip" should {
    "preserve a connectorId-only config" in {
      val cfg = ProposalRestApiConfig(connectorId = Some("conn-1"), endpoint = Some("/signups"), method = Some("GET"))
      cfg.toJson.convertTo[ProposalRestApiConfig] shouldBe cfg
    }

    "preserve a url-only (legacy) config" in {
      val cfg = ProposalRestApiConfig(url = Some("https://api.example.com/signups"))
      cfg.toJson.convertTo[ProposalRestApiConfig] shouldBe cfg
    }

    "preserve a newConnector draft config" in {
      val cfg = ProposalRestApiConfig(newConnector = Some(draft), endpoint = Some("/v1/charges"))
      cfg.toJson.convertTo[ProposalRestApiConfig] shouldBe cfg
    }

    "never serialize an 'auth' key — the type has no such field (design.md Decision 2)" in {
      val cfg = ProposalRestApiConfig(connectorId = Some("conn-1"))
      cfg.toJson.asJsObject.fields.keySet should not contain "auth"
    }
  }

  "ProposalRestApiConfig.toRestApiConfigPayload" should {
    "map every shared field onto RestApiConfigPayload for the connectorId-only case" in {
      val cfg = ProposalRestApiConfig(
        connectorId     = Some("conn-1"),
        endpoint        = Some("/signups"),
        method          = Some("GET"),
        queryParams     = Some(Map("limit" -> "10")),
        headers         = Some(Map("X-Custom" -> "1")),
        body            = Some("{}"),
        bodyContentType = Some("application/json"),
        rootSelector    = Some("$.data"),
        parameters      = Some(Map("p" -> "v"))
      )

      ProposalRestApiConfig.toRestApiConfigPayload(cfg) shouldBe RestApiConfigPayload(
        connectorId     = Some("conn-1"),
        url             = None,
        endpoint        = Some("/signups"),
        method          = Some("GET"),
        queryParams     = Some(Map("limit" -> "10")),
        headers         = Some(Map("X-Custom" -> "1")),
        body            = Some("{}"),
        bodyContentType = Some("application/json"),
        rootSelector    = Some("$.data"),
        auth            = None,
        parameters      = Some(Map("p" -> "v"))
      )
    }

    "map every shared field onto RestApiConfigPayload for the legacy url-only case" in {
      val cfg = ProposalRestApiConfig(url = Some("https://api.example.com/signups"), method = Some("POST"))

      ProposalRestApiConfig.toRestApiConfigPayload(cfg) shouldBe RestApiConfigPayload(
        connectorId = None,
        url         = Some("https://api.example.com/signups"),
        method      = Some("POST")
      )
    }
  }
}
