package com.helio.domain.model

import java.time.Instant

/** TOTP MFA state for a user (HEL-702 `totp-mfa-enrollment` spec). One row
 *  per user; `enabled` gates whether login requires a second factor.
 *  `lastUsedStep` is the RFC 6238 replay guard (`mfa-login-gate` spec "TOTP
 *  codes cannot be replayed") — only steps strictly greater than this value
 *  are ever accepted, and the check applies wherever a TOTP code is
 *  verified (login verification, enrollment confirmation, re-auth). */
final case class UserMfa(
    userId: UserId,
    totpSecret: String,
    enabled: Boolean,
    lastUsedStep: Long,
    createdAt: Instant,
    verifiedAt: Option[Instant]
)

/** A pending post-primary-auth MFA challenge (HEL-702 `mfa-login-gate`
 *  spec). `token` carries the RAW challenge value only in-process, from
 *  [[com.helio.infrastructure.MfaRepository]] back up to the caller that
 *  hands it to the client — mirrors [[UserSession]]'s token/tokenHash split
 *  (HEL-288); only the SHA-256 hash is ever persisted. */
final case class MfaLoginChallenge(
    userId: UserId,
    token: String,
    attempts: Int,
    createdAt: Instant,
    expiresAt: Instant
)
