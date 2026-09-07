package com.helio.services.sources

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Duration

/** Skeptic-final-1.md CR2: `ConnectorCompletionService.clampExpiry` (design.md D9's 24-hour
 *  ceiling -- the value the entire residual-risk paragraph in design.md's Risks section is
 *  argued against) had zero test coverage. Pure function, no DB. */
class ConnectorCompletionServiceClampExpirySpec extends AnyWordSpec with Matchers {

  "clampExpiry" should {
    "clamp an over-ceiling configured value down to the 24-hour ceiling" in {
      ConnectorCompletionService.clampExpiry(Some("2000")) shouldBe Duration.ofHours(24)
    }

    "pass through a configured value at exactly the ceiling" in {
      ConnectorCompletionService.clampExpiry(Some("1440")) shouldBe Duration.ofHours(24)
    }

    "pass through a configured value under the ceiling, in either direction from the 60-minute default" in {
      ConnectorCompletionService.clampExpiry(Some("15")) shouldBe Duration.ofMinutes(15)
      ConnectorCompletionService.clampExpiry(Some("120")) shouldBe Duration.ofMinutes(120)
    }

    "fall back to the 60-minute default for zero" in {
      ConnectorCompletionService.clampExpiry(Some("0")) shouldBe Duration.ofMinutes(60)
    }

    "fall back to the 60-minute default for a negative value" in {
      ConnectorCompletionService.clampExpiry(Some("-30")) shouldBe Duration.ofMinutes(60)
    }

    "fall back to the 60-minute default for an unparseable value" in {
      ConnectorCompletionService.clampExpiry(Some("not-a-number")) shouldBe Duration.ofMinutes(60)
    }

    "fall back to the 60-minute default when absent (unconfigured)" in {
      ConnectorCompletionService.clampExpiry(None) shouldBe Duration.ofMinutes(60)
    }

    "tolerate surrounding whitespace in a configured value" in {
      ConnectorCompletionService.clampExpiry(Some("  90  ")) shouldBe Duration.ofMinutes(90)
    }
  }
}
