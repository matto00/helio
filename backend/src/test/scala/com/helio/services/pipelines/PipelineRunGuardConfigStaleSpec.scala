package com.helio.services.pipelines

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1511 3.1 -- `PIPELINE_RUN_STALE_AFTER_SECONDS`: default 600, floor 90 (three 30 s heartbeats), WARN fallback. */
class PipelineRunGuardConfigStaleSpec extends AnyWordSpec with Matchers {

  "PipelineRunGuardConfig.parseStaleRunAfterSeconds" should {
    "default to 600 when unset" in {
      PipelineRunGuardConfig.parseStaleRunAfterSeconds(None) shouldBe 600L
      PipelineRunGuardConfig(1, 1, 1, 1, 1).staleRunAfterSeconds shouldBe 600L
    }
    "accept a value at or above the 90 s floor" in {
      PipelineRunGuardConfig.parseStaleRunAfterSeconds(Some("90")) shouldBe 90L
      PipelineRunGuardConfig.parseStaleRunAfterSeconds(Some("1800")) shouldBe 1800L
    }
    "fall back to the default for a value below the floor or not numeric" in {
      PipelineRunGuardConfig.parseStaleRunAfterSeconds(Some("89")) shouldBe 600L
      PipelineRunGuardConfig.parseStaleRunAfterSeconds(Some("0")) shouldBe 600L
      PipelineRunGuardConfig.parseStaleRunAfterSeconds(Some("-5")) shouldBe 600L
      PipelineRunGuardConfig.parseStaleRunAfterSeconds(Some("ten minutes")) shouldBe 600L
      PipelineRunGuardConfig.parseStaleRunAfterSeconds(Some("")) shouldBe 600L
    }
  }
}
