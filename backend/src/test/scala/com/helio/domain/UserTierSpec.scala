package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-703 tasks.md 6.1 — `UserTier.fromString`/`asString` parse round-trip. */
class UserTierSpec extends AnyWordSpec with Matchers {

  "UserTier.fromString" should {
    "parse \"free\" as Free" in {
      UserTier.fromString("free") shouldBe Right(UserTier.Free)
    }

    "parse \"beta\" as Beta" in {
      UserTier.fromString("beta") shouldBe Right(UserTier.Beta)
    }

    "parse \"owner\" as Owner" in {
      UserTier.fromString("owner") shouldBe Right(UserTier.Owner)
    }

    "return Left for an unknown tier" in {
      UserTier.fromString("admin").isLeft shouldBe true
    }
  }

  "UserTier.asString" should {
    "serialise Free as \"free\"" in {
      UserTier.asString(UserTier.Free) shouldBe "free"
    }

    "serialise Beta as \"beta\"" in {
      UserTier.asString(UserTier.Beta) shouldBe "beta"
    }

    "serialise Owner as \"owner\"" in {
      UserTier.asString(UserTier.Owner) shouldBe "owner"
    }

    "round-trip all tiers" in {
      Seq(UserTier.Free, UserTier.Beta, UserTier.Owner).foreach { tier =>
        UserTier.fromString(UserTier.asString(tier)) shouldBe Right(tier)
      }
    }
  }
}
