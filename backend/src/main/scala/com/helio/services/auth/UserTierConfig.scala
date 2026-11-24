package com.helio.services.auth

import com.helio.domain.util.EmailNormalizer

/** Env-sourced configuration for account-tier assignment (owner-email allowlist) and the beta-tier
 *  daily chat cap (HEL-703, design.md D4/D6). Constructed once via [[UserTierConfig.fromEnv]] and
 *  threaded explicitly into `AuthService` (`completeOAuth`'s verified-email owner eligibility, HEL-1852) and
 *  `ChatAccessService` (beta cap enforcement) -- mirrors `ClaudeConfig`/`CookieConfig`'s
 *  fromEnv-once-inject-explicitly convention. Specs construct their own values directly (never via
 *  `fromEnv()`), so allowlist/cap behavior is testable without mutating process env vars. */
final case class UserTierConfig(ownerEmails: Set[String], betaDailyMessageLimit: Int) {

  /** Case-insensitive, whitespace-tolerant membership check. Normalizes BOTH sides -- `ownerEmails`
   *  is already lowercased/trimmed when built via [[fromEnv]], but design.md D4 deliberately has
   *  specs construct `UserTierConfig` directly (never via `fromEnv()`), so this can't assume the
   *  set was pre-normalized by that one caller; a case-mixed literal like `Set("Owner@Example.com")`
   *  must still match `"owner@example.com"`. */
  def isOwnerEmail(email: String): Boolean = {
    val candidate = EmailNormalizer.normalize(email)
    ownerEmails.exists(EmailNormalizer.normalize(_) == candidate)
  }
}

object UserTierConfig {
  val DefaultBetaDailyMessageLimit: Int = 50

  /** Reads `HELIO_OWNER_EMAILS` (comma-separated, trimmed, lowercased, empties dropped -- mirrors
   *  `Main.scala`'s `CORS_ALLOWED_ORIGINS` split) and `HELIO_BETA_DAILY_MESSAGE_LIMIT` (int,
   *  default [[DefaultBetaDailyMessageLimit]]; a non-numeric override falls back to the default,
   *  and a value below 1 is clamped to 0 -- "always capped" -- never negative or unbounded). */
  def fromEnv(): UserTierConfig =
    UserTierConfig(
      ownerEmails = sys.env
        .getOrElse("HELIO_OWNER_EMAILS", "")
        .split(",")
        .map(EmailNormalizer.normalize)
        .filter(_.nonEmpty)
        .toSet,
      betaDailyMessageLimit = sys.env
        .get("HELIO_BETA_DAILY_MESSAGE_LIMIT")
        .flatMap(_.toIntOption)
        .map(math.max(0, _))
        .getOrElse(DefaultBetaDailyMessageLimit)
    )
}
