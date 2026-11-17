package com.helio.services.ratelimit

import com.helio.domain.model.AuthenticatedUser
import com.helio.services.ServiceError

/** HEL-1638 (C12): charges one live source fetch to the per-principal source-fetch budget
 *  (`SOURCE_FETCH_RATE_LIMIT_PER_WINDOW`). The `limiter` is the SAME instance `sourceFetchRateLimitDirective` uses, and the
 *  key is the one `RateLimitDirective` builds for the principal (`user:<id>` for a session caller, `pat:<tokenId>` for a PAT
 *  caller, which `AuthenticatedUser.tokenId` identifies), so a propose-time fetch and an HTTP preview/infer draw from one bucket.
 *  Exhaustion is a 429-class [[ServiceError.TooManyRequests]]; the caller must not fetch. */
final class SourceFetchBudget(limiter: RateLimiter, limit: Int, windowSeconds: Int) {

  private def principalKey(user: AuthenticatedUser): String =
    user.tokenId.fold(s"user:${user.id.value}")(t => s"pat:${t.value}")

  def charge(user: AuthenticatedUser): Either[ServiceError, Unit] =
    limiter.tryAcquire(principalKey(user), limit, windowSeconds) match {
      case RateLimitResult.Allowed => Right(())
      case RateLimitResult.Exceeded(retryAfter) =>
        Left(ServiceError.TooManyRequests(
          retryAfter,
          "Source fetch rate limit exceeded: this proposal needs a live fetch to check an inline rest/sql source, and the budget for " +
            s"source fetches is used up; retry in $retryAfter seconds"
        ))
    }
}

object SourceFetchBudget {
  /** The documented default (`SOURCE_FETCH_RATE_LIMIT_PER_WINDOW` 30 per 60 s) over a private limiter: for tests, and for the
   *  never-charging apply context. No production service takes it as a default: production wires the shared limiter in `ApiRoutes`. */
  def default(): SourceFetchBudget = new SourceFetchBudget(new InMemoryRateLimiter(), 30, 60)
}
