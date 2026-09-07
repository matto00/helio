package com.helio.domain.model

import java.time.Instant

final case class ConnectorCompletionTokenId(value: String) extends AnyVal

/** A single-use, short-lived token authorizing an out-of-band human to bind a credential to a
 *  pending [[Connector]] (HEL-955 design.md D2/D3/D9) -- the hand-off half of "an agent creates
 *  a Connector shape, a human supplies the secret".
 *
 *  Mirrors `ShareToken`'s shape almost exactly, with two deliberate divergences: `expiresAt` is
 *  never optional (never an unbounded slot), and single-use consumption replaces revocation.
 *
 *  Two distinct invalidation columns for two distinct events (design.md D9): `consumedAt` means
 *  this token was successfully used to bind a credential; `supersededAt` means a newer token was
 *  minted for the same Connector (re-mint), with no bind and no submission. A token is valid only
 *  when both are `None` and it has not expired -- see `isValid`.
 *
 *  Skeptic-final-1.md CR2 correction: `isValid` is NOT display-only -- it is the live validity
 *  check `ConnectorCompletionService.resolveValidToken` performs on the row it just read
 *  (`findByHash`), gating whether `complete`/`describePending` proceed at all. It is exclusive at
 *  the expiry boundary (`now.isBefore(expiresAt)`, never `<=`), matching
 *  `ConnectorCompletionTokenRepository.consume`'s own `expiresAt > now` SQL predicate. That
 *  predicate -- not this method -- is what actually closes the concurrent supersede/expire-vs-
 *  consume race (D3/D9): `isValid` can read a token as live one moment before a concurrent
 *  re-mint or expiry invalidates it, so `consume`'s conditional `UPDATE` is the sole atomic
 *  enforcement point; `isValid` alone would allow that stale read to still bind. */
final case class ConnectorCompletionToken(
    id: ConnectorCompletionTokenId,
    connectorId: ConnectorId,
    userId: UserId,
    tokenHash: String,
    expiresAt: Instant,
    consumedAt: Option[Instant],
    supersededAt: Option[Instant],
    createdAt: Instant
) {
  def isValid(now: Instant): Boolean =
    consumedAt.isEmpty && supersededAt.isEmpty && now.isBefore(expiresAt)
}
