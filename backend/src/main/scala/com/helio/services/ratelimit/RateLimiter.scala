package com.helio.services.ratelimit

/** Outcome of a [[RateLimiter.tryAcquire]] call. `Exceeded` carries the number of
 *  seconds until the caller may retry, mirroring the `Retry-After` header value
 *  [[com.helio.api.http.RateLimitDirective]] sends back to the client. */
sealed trait RateLimitResult

object RateLimitResult {
  case object Allowed extends RateLimitResult
  final case class Exceeded(retryAfterSeconds: Long) extends RateLimitResult
}

/** Storage/counting abstraction for request rate limiting (HEL-495 design.md D2). Deliberately
 *  opaque to authentication -- callers (namely [[com.helio.api.http.RateLimitDirective]]) resolve
 *  the bucket key; this trait only counts requests against it. Kept behind a trait so the shipped
 *  in-process implementation can later be swapped for a distributed/shared backend (e.g. Redis)
 *  without touching any call site -- see design.md's per-instance caveat: Cloud Run runs up to
 *  `max-instances=3`, so [[InMemoryRateLimiter]] enforces the configured limit independently per
 *  instance, meaning the effective limit is roughly N x configured under N concurrently running
 *  instances. */
trait RateLimiter {

  /** Records one request against `key` and reports whether it may proceed. `limit` and
   *  `windowSeconds` are supplied per-call (not baked into the limiter) so a single limiter
   *  instance can serve both the global default and any route-specific tighter limit. */
  def tryAcquire(key: String, limit: Int, windowSeconds: Int): RateLimitResult
}
