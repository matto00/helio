package com.helio.services

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-703 — `UserTierConfig.isOwnerEmail`'s case-insensitivity. Regression coverage for a real
 *  defect `AuthServiceSpec`/`GoogleOAuthRoutesSpec` caught: a directly-constructed config (design.md
 *  D4 -- "specs inject their own", never `fromEnv()`) with a case-mixed `ownerEmails` entry failed
 *  to match a lowercase candidate, because the original implementation only normalized the
 *  CANDIDATE side, silently relying on `fromEnv()` having pre-lowercased the set -- an invariant
 *  that direct construction never guaranteed. */
class UserTierConfigSpec extends AnyWordSpec with Matchers {

  "UserTierConfig.isOwnerEmail" should {

    "matches an exact, already-lowercase entry" in {
      UserTierConfig(Set("owner@example.com"), 50).isOwnerEmail("owner@example.com") shouldBe true
    }

    "matches when the STORED entry is mixed-case (the actual regression)" in {
      UserTierConfig(Set("Owner@Example.com"), 50).isOwnerEmail("owner@example.com") shouldBe true
    }

    "matches when the CANDIDATE is mixed-case" in {
      UserTierConfig(Set("owner@example.com"), 50).isOwnerEmail("Owner@Example.COM") shouldBe true
    }

    "matches when both sides are mixed-case, in different casings" in {
      UserTierConfig(Set("Owner@Example.com"), 50).isOwnerEmail("OWNER@example.COM") shouldBe true
    }

    "tolerates surrounding whitespace on the candidate" in {
      UserTierConfig(Set("owner@example.com"), 50).isOwnerEmail("  owner@example.com  ") shouldBe true
    }

    "does not match a non-member email" in {
      UserTierConfig(Set("owner@example.com"), 50).isOwnerEmail("someone-else@example.com") shouldBe false
    }

    "an empty allowlist matches nothing" in {
      UserTierConfig(Set.empty, 50).isOwnerEmail("owner@example.com") shouldBe false
    }
  }
}
