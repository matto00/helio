package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{NewConnectorDraft, ProposalRestApiConfig}
import com.helio.services.ServiceError
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.concurrent.ExecutionContext

/** HEL-829 tasks.md 1.4 — `PipelineProposalService.validateRestConfig`'s
 *  exactly-one-of-`connectorId`/`url`/`newConnector` guard (design.md
 *  Decision 2). `resolveRestSource`'s adapter itself is covered directly by
 *  `ProposalRestApiConfigSpec`'s `toRestApiConfigPayload` tests, since that
 *  adapter function is the entirety of what changed in `resolveRestSource`. */
class PipelineProposalServiceRestConfigSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val service = new PipelineProposalService(null, null, null, null, null, null)

  private val draft = NewConnectorDraft("Stripe", "https://api.stripe.com", "api_key", Some("Authorization"), Some("header"), "Get it from the dashboard")

  "PipelineProposalService.validateRestConfig" should {
    "accept a config with only connectorId set" in {
      service.validateRestConfig(ProposalRestApiConfig(connectorId = Some("conn-1"))) shouldBe Right(())
    }

    "accept a config with only url set (legacy path)" in {
      service.validateRestConfig(ProposalRestApiConfig(url = Some("https://api.example.com"))) shouldBe Right(())
    }

    "accept a config with only newConnector set" in {
      service.validateRestConfig(ProposalRestApiConfig(newConnector = Some(draft))) shouldBe Right(())
    }

    "reject a config with none of the three set" in {
      val result = service.validateRestConfig(ProposalRestApiConfig())
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadRequest]
    }

    "reject a config with both connectorId and url set" in {
      val result = service.validateRestConfig(ProposalRestApiConfig(connectorId = Some("conn-1"), url = Some("https://api.example.com")))
      result shouldBe a[Left[_, _]]
    }

    "reject a config with both connectorId and newConnector set" in {
      val result = service.validateRestConfig(ProposalRestApiConfig(connectorId = Some("conn-1"), newConnector = Some(draft)))
      result shouldBe a[Left[_, _]]
    }

    "reject a config with all three set" in {
      val result = service.validateRestConfig(
        ProposalRestApiConfig(connectorId = Some("conn-1"), url = Some("https://api.example.com"), newConnector = Some(draft))
      )
      result shouldBe a[Left[_, _]]
    }
  }
}
