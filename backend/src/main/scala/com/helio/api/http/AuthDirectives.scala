package com.helio.api.http

import com.helio.api.ErrorResponse
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import org.apache.pekko.http.scaladsl.server.{Directive0, Directive1}
import org.apache.pekko.http.scaladsl.server.Directives._
import com.helio.api.protocols.ResourceProtocol
import com.helio.domain.model.{AuthenticatedUser, TokenScope}
import com.helio.infrastructure.persistence.auth.{ApiTokenRepository, UserSessionRepository}
import com.helio.services.auth.ApiTokenService

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

class AuthDirectives(
    userSessionRepo: UserSessionRepository,
    apiTokenRepo: Option[ApiTokenRepository] = None
)(implicit ec: ExecutionContext)
    extends ResourceProtocol {

  /** PAT lookup: only attempted for tokens in the `helio_pat_` namespace and
   *  only when a token repository is wired (kept optional so existing
   *  session-only test fixtures are unaffected). The raw token is hashed
   *  before it touches the database — only its SHA-256 is ever compared or
   *  stored. `touchLastUsed` is fire-and-forget so the auth path never blocks
   *  on the bookkeeping write. */
  private def resolveApiToken(token: String): Future[Option[AuthenticatedUser]] =
    apiTokenRepo match {
      case Some(repo) if token.startsWith(ApiTokenService.TokenPrefix) =>
        val hash = ApiTokenService.sha256Hex(token)
        repo.findUserByTokenHash(hash).map { userOpt =>
          if (userOpt.isDefined) repo.touchLastUsed(hash)
          userOpt
        }
      case _ =>
        Future.successful(None)
    }

  /** Resolves identity for a request. The `helio_session` cookie (browser
   *  sessions, HEL-287 httpOnly-cookie migration, design.md D1-D2) takes
   *  priority; if absent, falls back to a `helio_pat_`-prefixed
   *  `Authorization: Bearer` token (Personal Access Tokens, HEL-148 — a
   *  separate, non-browser credential kind). Raw session tokens are no
   *  longer accepted via the header at all: this is a hard cutover, safe
   *  because HEL-288's `V45` migration deleted every live session, so there
   *  is no legacy header-only client to keep working. Returns `None` when
   *  neither credential is present at all (distinct from "present but
   *  invalid", handled by the two directives below). */
  private def resolveIdentity(
      cookieToken: Option[String],
      authHeader: Option[Authorization]
  ): Option[Future[Option[AuthenticatedUser]]] =
    (cookieToken, authHeader) match {
      case (Some(token), _) => Some(userSessionRepo.findValidSession(token))
      case (None, Some(Authorization(OAuth2BearerToken(token)))) => Some(resolveApiToken(token))
      case _ => None
    }

  private val identity: Directive1[Option[Future[Option[AuthenticatedUser]]]] =
    optionalCookie(SessionCookies.Name).flatMap { cookieOpt =>
      optionalHeaderValueByType(Authorization).map { authOpt =>
        resolveIdentity(cookieOpt.map(_.value), authOpt)
      }
    }

  /** Resolves the caller's identity from the session cookie or a PAT bearer
   *  token and provides it to the inner route. Returns 401 with a JSON error
   *  body if neither credential is present, or if the one that is present
   *  does not resolve to a valid user — always a `complete` (not a
   *  rejection) so the error shape is consistent regardless of the route
   *  tree or credential kind. */
  val authenticate: Directive1[AuthenticatedUser] =
    identity.flatMap {
      case Some(resolved) =>
        onComplete(resolved).flatMap {
          case Success(Some(user)) => provide(user)
          case Success(None)       => complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
          case Failure(_)          => complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
        }
      case None =>
        complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
    }

  /** Optionally resolves identity from the session cookie or a PAT bearer
   *  token. Yields `Some(AuthenticatedUser)` when a valid credential is
   *  present, `None` when no credential is present at all, and completes
   *  with 401 if a credential is present but invalid/expired/unknown. This
   *  allows unauthenticated access for public resources while still
   *  validating credentials when they are supplied. Resolution is identical
   *  to [[authenticate]]. */
  val optionalAuthenticate: Directive1[Option[AuthenticatedUser]] =
    identity.flatMap {
      case Some(resolved) =>
        onComplete(resolved).flatMap {
          case Success(Some(user)) => provide(Some(user))
          case Success(None)       => complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
          case Failure(_)          => complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
        }
      case None => provide(None)
    }

  /** Single chokepoint (HEL-369 design.md Decision 2) wrapping the ENTIRE
   *  three-way `pathPrefix("auth")` / `optionalAuthenticate` / `authenticate`
   *  `concat(...)` in `ApiRoutes.scala`, between `requireCsrfHeader` and that
   *  `concat`. A round-1 design put this confinement only inside the
   *  `authenticate` branch -- insufficient, because `optionalAuthenticate`
   *  shares the exact same token-resolution chain and would otherwise
   *  resolve a scoped token to the *same* full `AuthenticatedUser`, handing
   *  it unconfined owner-level access on public/optional-auth routes like
   *  `GET /api/dashboards/:id/panels`. This directive runs ahead of that
   *  split so no branch — present or future — ever gets a chance to
   *  independently resolve a scoped token's identity.
   *
   *  Resolution (each step short-circuits on match):
   *  - a `helio_session` cookie is present at all (valid or not) -> `None`,
   *    without inspecting the `Authorization` header — mirrors
   *    `resolveIdentity`'s existing session-over-header precedence, so a
   *    session-authenticated request is never affected by this directive
   *    regardless of what bearer header also happens to be attached.
   *  - no `helio_pat_...` bearer header is present -> `None` — anonymous and
   *    non-PAT-bearer requests pass through untouched, preserving
   *    `optionalAuthenticate`'s public-access semantics.
   *  - the bearer does not resolve (invalid/expired/revoked) or resolves but
   *    is UNSCOPED -> `None` — let the branch's own `authenticate`/
   *    `optionalAuthenticate` perform its normal resolution and produce the
   *    normal 401 or full-access behavior; this directive only ever acts on
   *    a token that positively resolves to a *scoped* row.
   *  - resolves AND is scoped -> `Some(TokenScope(...))` if the first
   *    unmatched path **segment** is exactly `"hooks"` (exact equality, not
   *    a prefix/`startsWith` test — `/api/hooksomething` must still be
   *    rejected); otherwise `403 Forbidden` immediately, before any of the
   *    three branches run. */
  val confineScopedToken: Directive1[Option[TokenScope]] =
    optionalCookie(SessionCookies.Name).flatMap {
      case Some(_) => provide(None)
      case None =>
        optionalHeaderValueByType(Authorization).flatMap {
          case Some(Authorization(OAuth2BearerToken(token))) if token.startsWith(ApiTokenService.TokenPrefix) =>
            apiTokenRepo match {
              case None => provide(None)
              case Some(repo) =>
                val hash = ApiTokenService.sha256Hex(token)
                onComplete(repo.findPrincipalByTokenHash(hash)).flatMap {
                  case Success(Some((_, tokenId, Some(allowedIds)))) =>
                    extractUnmatchedPath.flatMap { path =>
                      val firstSegment = path.toString.split("/").filterNot(_.isEmpty).headOption
                      if (firstSegment.contains("hooks")) provide(Some(TokenScope(tokenId, allowedIds)))
                      else complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
                    }
                  case _ => provide(None)
                }
            }
          case _ => provide(None)
        }
    }

  /** CSRF defense (design.md D4). Once the session cookie can be sent
   *  cross-site (`SameSite=None` in prod), the browser's default same-site
   *  mitigation no longer protects state-changing requests, so this
   *  requires a custom header — `X-Helio-Requested-With: 1` — on every
   *  non-`GET` request that carries the session cookie. PAT-authenticated
   *  requests (no session cookie; a deliberately-attached `Authorization`
   *  header from a non-browser client) are exempt, since they are not
   *  ambient credentials a cross-site page could forge. A cross-site script
   *  cannot attach a custom header without triggering a CORS preflight,
   *  which `corsAllowedOrigins` already rejects for unknown origins.
   *  Checked by cookie *presence*, not by re-validating the session, so it
   *  applies uniformly ahead of [[authenticate]]/[[optionalAuthenticate]]
   *  (register/login naturally exempt themselves: no cookie exists yet on
   *  the request that is about to mint one). */
  val requireCsrfHeader: Directive0 =
    extractMethod.flatMap { method =>
      if (method == HttpMethods.GET) pass
      else
        optionalCookie(SessionCookies.Name).flatMap {
          case None => pass
          case Some(_) =>
            optionalHeaderValueByName(AuthDirectives.CsrfHeaderName).flatMap {
              case Some(AuthDirectives.CsrfHeaderValue) => pass
              case _ => complete(StatusCodes.Forbidden, ErrorResponse("Missing required CSRF header"))
            }
        }
    }
}

object AuthDirectives {
  val CsrfHeaderName: String  = "X-Helio-Requested-With"
  val CsrfHeaderValue: String = "1"
}
