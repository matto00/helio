package com.helio.services.ratelimit

/** Env-sourced configuration for the default rate limit (HEL-495 design.md D6). Constructed once
 *  via [[RateLimitConfig.fromEnv]] and threaded explicitly into `ApiRoutes`'s
 *  `RateLimitDirective` wiring -- mirrors `UserTierConfig`/`ClaudeConfig`'s
 *  fromEnv-once-inject-explicitly convention. Specs construct their own values directly (never via
 *  `fromEnv()`). */
final case class RateLimitConfig(requestsPerWindow: Int, windowSeconds: Int)

object RateLimitConfig {
  val DefaultRequestsPerWindow: Int = 120
  val DefaultWindowSeconds: Int = 60

  /** Reads `RATE_LIMIT_REQUESTS_PER_WINDOW` and `RATE_LIMIT_WINDOW_SECONDS` (both ints, falling
   *  back to the documented defaults when unset or non-numeric). */
  def fromEnv(): RateLimitConfig =
    RateLimitConfig(
      requestsPerWindow = sys.env.get("RATE_LIMIT_REQUESTS_PER_WINDOW").flatMap(_.toIntOption).getOrElse(DefaultRequestsPerWindow),
      windowSeconds = sys.env.get("RATE_LIMIT_WINDOW_SECONDS").flatMap(_.toIntOption).getOrElse(DefaultWindowSeconds)
    )
}
