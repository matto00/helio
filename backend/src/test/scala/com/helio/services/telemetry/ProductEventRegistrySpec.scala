package com.helio.services.telemetry

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant

class ProductEventRegistrySpec extends AnyWordSpec with Matchers {

  private val now = Instant.parse("2026-09-30T12:00:00Z")

  private def validate(json: String) = ProductEventRegistry.validateClientEvent(json.parseJson, now)
  private def rejection(json: String): String = validate(json).swap.getOrElse(fail(s"expected rejection of $json"))

  "validateClientEvent" should {

    "reject an unknown event name" in {
      validate("""{"event":"page_viewed"}""") shouldBe Left("unknown event 'page_viewed'")
    }

    "reject signup_completed, which only the server may emit" in {
      rejection("""{"event":"signup_completed"}""") should include("cannot be emitted by a client")
    }

    "reject any property on provenance_opened, which allow-lists none" in {
      rejection("""{"event":"provenance_opened","properties":{"panelId":"x"}}""") should include("unknown property 'panelId'")
    }

    "reject a known property with the wrong type" in {
      rejection("""{"event":"first_dashboard_rendered","properties":{"panelCount":"3"}}""") should include("invalid value for property 'panelCount'")
    }

    "reject an out-of-range property value" in {
      validate("""{"event":"first_dashboard_rendered","properties":{"panelCount":501}}""").isLeft shouldBe true
      validate("""{"event":"first_dashboard_rendered","properties":{"panelCount":0}}""").isLeft shouldBe true
    }

    "reject a template slug outside the slug pattern" in {
      validate("""{"event":"firstrun_template_chosen","properties":{"template":"Has Spaces"}}""").isLeft shouldBe true
      validate("""{"event":"firstrun_template_chosen","properties":{"template":"https://evil.example"}}""").isLeft shouldBe true
    }

    "reject an unknown top-level field" in {
      validate("""{"event":"provenance_opened","userId":"someone-else"}""").isLeft shouldBe true
    }

    "accept a valid event and keep only its allow-listed properties" in {
      val v = validate("""{"event":"firstrun_file_dropped","properties":{"source":"drop"}}""").getOrElse(fail("rejected"))
      v.event shouldBe "firstrun_file_dropped"
      v.properties shouldBe JsObject("source" -> JsString("drop"))
      v.occurredAt shouldBe now
    }
  }

  "clampOccurredAt" should {

    "honour a claimed time inside [now-24h, now+5min]" in {
      val claimed = now.minusSeconds(3600)
      ProductEventRegistry.clampOccurredAt(Some(claimed), now) shouldBe claimed
    }

    "fall back to server time for a claimed time older than 24h or more than 5 min ahead" in {
      ProductEventRegistry.clampOccurredAt(Some(now.minusSeconds(25 * 3600)), now) shouldBe now
      ProductEventRegistry.clampOccurredAt(Some(now.plusSeconds(6 * 60)), now) shouldBe now
    }
  }

  "the registry" should {
    "treat every once-per-user event as a known event" in {
      ProductEventRegistry.OncePerUserEvents.subsetOf(ProductEventRegistry.AllEventNames) shouldBe true
    }
  }

}
