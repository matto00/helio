package com.helio.infrastructure

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/** Shared hashing primitive for every credential kind stored at rest
 *  (`api_tokens.token_hash`, `user_sessions.token_hash`). Extracted from
 *  `ApiTokenService.sha256Hex` (HEL-148 Phase 1) so both credential kinds use
 *  one implementation (HEL-288). Lives in `com.helio.infrastructure` — the
 *  services layer (`ApiTokenService`) depends on infrastructure, never the
 *  reverse. */
object TokenHashing {

  /** SHA-256 hex digest of the raw credential value. */
  def sha256Hex(raw: String): String =
    MessageDigest
      .getInstance("SHA-256")
      .digest(raw.getBytes(StandardCharsets.UTF_8))
      .map("%02x".format(_))
      .mkString
}
