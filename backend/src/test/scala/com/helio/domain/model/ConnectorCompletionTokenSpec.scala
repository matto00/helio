package com.helio.domain.model

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

/** Skeptic-final-1.md CR2: `ConnectorCompletionToken.isValid`'s exclusive expiry-boundary
 *  behavior, pinned as a pure unit test (no DB) mirroring
 *  `ConnectorCompletionTokenRepository.consume`'s SQL predicate (`expires_at > now`, never
 *  `>=`). */
class ConnectorCompletionTokenSpec extends AnyWordSpec with Matchers {

  private def token(expiresAt: Instant, consumedAt: Option[Instant] = None, supersededAt: Option[Instant] = None): ConnectorCompletionToken =
    ConnectorCompletionToken(
      id           = ConnectorCompletionTokenId("t-1"),
      connectorId  = ConnectorId("c-1"),
      userId       = UserId("u-1"),
      tokenHash    = "hash",
      expiresAt    = expiresAt,
      consumedAt   = consumedAt,
      supersededAt = supersededAt,
      createdAt    = Instant.EPOCH
    )

  "isValid" should {
    "be true strictly before expiry" in {
      val now = Instant.parse("2026-01-01T00:00:00Z")
      token(expiresAt = now.plusSeconds(1)).isValid(now) shouldBe true
    }

    "be false at exactly the expiry instant -- the boundary is exclusive" in {
      val now = Instant.parse("2026-01-01T00:00:00Z")
      token(expiresAt = now).isValid(now) shouldBe false
    }

    "be false strictly after expiry" in {
      val now = Instant.parse("2026-01-01T00:00:00Z")
      token(expiresAt = now.minusSeconds(1)).isValid(now) shouldBe false
    }

    "be false when consumed, even if not yet expired" in {
      val now = Instant.parse("2026-01-01T00:00:00Z")
      token(expiresAt = now.plusSeconds(60), consumedAt = Some(now.minusSeconds(1))).isValid(now) shouldBe false
    }

    "be false when superseded, even if not yet expired" in {
      val now = Instant.parse("2026-01-01T00:00:00Z")
      token(expiresAt = now.plusSeconds(60), supersededAt = Some(now.minusSeconds(1))).isValid(now) shouldBe false
    }
  }
}
