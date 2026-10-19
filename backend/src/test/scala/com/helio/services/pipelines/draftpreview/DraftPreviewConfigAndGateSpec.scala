package com.helio.services.pipelines.draftpreview

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1630 D5: env parsing of the draft-preview limits, and the in-flight gate's accounting. */
class DraftPreviewConfigAndGateSpec extends AnyWordSpec with Matchers {

  private def cfg(env: Map[String, String]) = DraftPreviewConfig.fromLookup(env.get)

  "DraftPreviewConfig" should {
    "default to 120 requests per window and the documented in-flight bound" in {
      val c = cfg(Map.empty)
      c.requestsPerWindow shouldBe 120
      c.maxInFlight shouldBe DraftPreviewConfig.DefaultMaxInFlight
      c.maxInFlightPerPrincipal shouldBe 2
    }

    "read DRAFT_PREVIEW_RATE_LIMIT_PER_WINDOW and DRAFT_PREVIEW_MAX_IN_FLIGHT, falling back for non-numeric or < 1" in {
      cfg(Map("DRAFT_PREVIEW_RATE_LIMIT_PER_WINDOW" -> "5", "DRAFT_PREVIEW_MAX_IN_FLIGHT" -> "3")).requestsPerWindow shouldBe 5
      cfg(Map("DRAFT_PREVIEW_MAX_IN_FLIGHT" -> "3")).maxInFlight shouldBe 3
      cfg(Map("DRAFT_PREVIEW_MAX_IN_FLIGHT" -> "3")).maxInFlightPerPrincipal shouldBe 2
      cfg(Map("DRAFT_PREVIEW_RATE_LIMIT_PER_WINDOW" -> "abc")).requestsPerWindow shouldBe 120
      cfg(Map("DRAFT_PREVIEW_RATE_LIMIT_PER_WINDOW" -> "0")).requestsPerWindow shouldBe 120
      cfg(Map("DRAFT_PREVIEW_MAX_IN_FLIGHT" -> "-2")).maxInFlight shouldBe DraftPreviewConfig.DefaultMaxInFlight
    }
  }

  "DraftPreviewGate" should {
    "refuse a principal's third slot and the reading slots past the bound, and free them on release" in {
      val gate = new DraftPreviewGate(maxInFlight = 3, maxPerPrincipal = 2, maxReading = 3)
      val a1   = gate.tryAcquire("a").get
      val a2   = gate.tryAcquire("a").get
      gate.tryAcquire("a") shouldBe None
      val b1 = gate.tryAcquire("b").get
      gate.tryAcquire("c") shouldBe None
      gate.inReading shouldBe 3
      a1.release()
      gate.tryAcquire("a") should not be empty
      a2.release(); b1.release()
    }

    "let a slow reader hold only a reading slot: running slots stay free for others" in {
      val gate = new DraftPreviewGate(maxInFlight = 1, maxPerPrincipal = 2, maxReading = 4)
      val slow = gate.tryAcquire("slow").get
      val fast = gate.tryAcquire("fast").get
      fast.startRunning() shouldBe true
      gate.inFlight shouldBe 1
      slow.release()
      gate.inFlight shouldBe 1
    }

    "refuse startRunning past maxInFlight, keep the permit usable, and give slots back on release" in {
      val gate = new DraftPreviewGate(maxInFlight = 1, maxPerPrincipal = 2, maxReading = 4)
      val p1   = gate.tryAcquire("a").get
      val p2   = gate.tryAcquire("b").get
      p1.startRunning() shouldBe true
      p2.startRunning() shouldBe false
      gate.inReading shouldBe 1
      p1.release()
      p2.startRunning() shouldBe true
      p2.release(); p2.release()
      gate.inFlight shouldBe 0
      gate.inReading shouldBe 0
      gate.tryAcquire("a") should not be empty
    }
  }
}
