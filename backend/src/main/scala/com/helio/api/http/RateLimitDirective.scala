package com.helio.api.http

import com.helio.api.ErrorResponse
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken, `Retry-After`}
import org.apache.pekko.http.scaladsl.server.{Directive0, Directive1}
import org.apache.pekko.http.scaladsl.server.Directives._
import com.helio.api.protocols.ResourceProtocol
import com.helio.infrastructure.persistence.auth.{ApiTokenRepository, UserSessionRepository}
import com.helio.services.auth.ApiTokenService
import com.helio.services.ratelimit.{RateLimitResult, RateLimiter}

import scala.concurrent.ExecutionContext
import scala.util.Success

/** Reusable per-principal request rate-limiting directive (HEL-495 design.md D3/D4). Follows the
 *  `AuthDirectives`/`AclDirective` style: resolves its own bucket key by inspecting the request
 *  directly, independent of `AuthDirectives`'s identity directives, so it can compose ahead
 *  of/around `optionalAuthenticate` and `authenticate` alike rather than only after one of them
 *  has already run.
 *
 *  Key priority (design.md D3), matching `AuthDirectives.resolveIdentity`'s own
 *  session-over-header precedence exactly:
 *   1. `helio_session` cookie present -> resolve via [[UserSessionRepository.findValidSession]].
 *      Resolves -> `"user:<userId>"`. Does not resolve -> **do not fall through to the header**
 *      (mirrors `resolveIdentity`'s own short-circuit) -> the request is NOT rate-limited (see
 *      below).
 *   2. No cookie, `Authorization: Bearer helio_pat_...` present -> resolve via
 *      [[ApiTokenRepository.findPrincipalByTokenHash]]. Resolves -> `"pat:<tokenId>"` (regardless
 *      of whether the token is scoped -- scoping is orthogonal to rate-limit keying). Does not
 *      resolve -> the request is NOT rate-limited.
 *   3. Neither credential present, or either resolved to invalid per above -> **no key; the
 *      request passes through unthrottled by this directive.**
 *
 *  **Deliberate, documented scope reduction (HEL-495 delivery, split from an original design that
 *  also keyed unauthenticated/invalid-credential requests by client IP):** across four delivery
 *  cycles and three final-gate REFUTEs, IP-based keying accumulated six distinct real defects
 *  (header spoofing, port-inclusive keys, multiple caller-vs-proxy trust-order subtleties) with no
 *  sign the rate of new findings was decreasing, while the authenticated (session/PAT) keying path
 *  above had zero findings across every round. Trusted client-IP-behind-a-proxy extraction is a
 *  well-known hard problem; shipping it correctly deserves a dedicated design pass rather than a
 *  fourth patch under this ticket's delivery pressure. See HEL-837 ("IP-based rate-limit keying:
 *  trusted client-IP extraction behind Cloud Run's proxy") for the full deferred scope, including
 *  the working (not yet final-gate-confirmed) implementation and all six findings, preserved at
 *  `openspec/changes/core-rate-limiting-directive/ip-keying-followup-for-hel837.md` on this
 *  change's branch.
 *
 *  **Practical consequence:** unauthenticated requests, and requests carrying an invalid/expired
 *  session cookie or an unresolvable PAT bearer token, are NOT currently rate-limited by this
 *  directive at all. This is a deliberate, tracked gap (see the `RATE_LIMIT_REQUESTS_PER_WINDOW`
 *  row in `CLAUDE.md`'s prod env var table), not an oversight -- HEL-837 is expected to close it. */
class RateLimitDirective(
    limiter: RateLimiter,
    userSessionRepo: UserSessionRepository,
    apiTokenRepo: Option[ApiTokenRepository],
    defaultLimit: Int,
    windowSeconds: Int
)(implicit ec: ExecutionContext)
    extends ResourceProtocol {

  /** `Some(key)` when the request carries a resolvable session or PAT credential; `None` when it
   *  carries no credential at all, or an unresolvable one (invalid/expired session cookie,
   *  unresolvable PAT bearer token) -- in every `None` case the caller is not rate-limited by this
   *  directive (HEL-837 scope; see class scaladoc). */
  private val resolveKey: Directive1[Option[String]] =
    optionalCookie(SessionCookies.Name).flatMap {
      case Some(cookie) =>
        onComplete(userSessionRepo.findValidSession(cookie.value)).flatMap {
          case Success(Some(user)) => provide(Some(s"user:${user.id.value}"))
          case _                   => provide(None)
        }
      case None =>
        optionalHeaderValueByType(Authorization).flatMap {
          case Some(Authorization(OAuth2BearerToken(token)))
              if apiTokenRepo.isDefined && token.startsWith(ApiTokenService.TokenPrefix) =>
            val hash = ApiTokenService.sha256Hex(token)
            onComplete(apiTokenRepo.get.findPrincipalByTokenHash(hash)).flatMap {
              case Success(Some((_, tokenId, _))) => provide(Some(s"pat:${tokenId.value}"))
              case _                              => provide(None)
            }
          case _ => provide(None)
        }
    }

  /** Enforces `limit` requests per `windowSeconds` (defaulting to the configured global limit) for
   *  the resolved bucket key. On exceed, completes 429 with a `Retry-After` header and a JSON
   *  `ErrorResponse` body (design.md D5); the inner route is never invoked for a rejected request.
   *  A request with no resolvable key (see [[resolveKey]]) passes through unconditionally -- there
   *  is nothing to key it on yet (HEL-837 scope). */
  def rateLimit(limit: Int = defaultLimit): Directive0 =
    resolveKey.flatMap {
      case None => pass
      case Some(key) =>
        limiter.tryAcquire(key, limit, windowSeconds) match {
          case RateLimitResult.Allowed => pass
          case RateLimitResult.Exceeded(retryAfterSeconds) =>
            respondWithHeader(`Retry-After`(retryAfterSeconds)) &
              complete(StatusCodes.TooManyRequests, ErrorResponse("Rate limit exceeded"))
        }
    }
}
