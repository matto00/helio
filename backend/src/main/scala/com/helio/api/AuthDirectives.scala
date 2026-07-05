package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import org.apache.pekko.http.scaladsl.server.Directive1
import org.apache.pekko.http.scaladsl.server.Directives._
import com.helio.api.protocols.ResourceProtocol
import com.helio.domain.AuthenticatedUser
import com.helio.infrastructure.{ApiTokenRepository, UserSessionRepository}
import com.helio.services.ApiTokenService

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

class AuthDirectives(
    userSessionRepo: UserSessionRepository,
    apiTokenRepo: Option[ApiTokenRepository] = None
)(implicit ec: ExecutionContext)
    extends ResourceProtocol {

  /** Resolves a Bearer token to a user: session first (the web app's hot
   *  path), then Personal Access Token fallback (HEL-148 Phase 1). Both paths
   *  yield the same [[AuthenticatedUser]], so every downstream repository
   *  call sets the identical `app.current_user_id` Postgres context and RLS
   *  visibility is byte-for-byte the same regardless of credential kind. */
  private def resolveBearer(token: String): Future[Option[AuthenticatedUser]] =
    userSessionRepo.findValidSession(token).flatMap {
      case some @ Some(_) => Future.successful(some)
      case None           => resolveApiToken(token)
    }

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

  /** Extracts a Bearer token from the Authorization header, validates it
   *  against the session store (falling back to Personal Access Tokens), and
   *  provides the resolved AuthenticatedUser to the inner route.
   *  Returns 401 with a JSON error body if the header is missing, malformed, or the
   *  token is unknown/expired/revoked — always a `complete` (not a rejection) so
   *  the error shape is consistent regardless of the route tree or credential kind.
   */
  val authenticate: Directive1[AuthenticatedUser] =
    optionalHeaderValueByType(Authorization).flatMap {
      case Some(Authorization(OAuth2BearerToken(token))) =>
        onComplete(resolveBearer(token)).flatMap {
          case Success(Some(user)) => provide(user)
          case Success(None)       => complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
          case Failure(_)          => complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
        }
      case _ =>
        complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
    }

  /** Optionally extracts a Bearer token from the Authorization header and validates it.
   *  Returns Some(AuthenticatedUser) if a valid token is present, None if no token is
   *  provided, and completes with 401 if a token is present but invalid/expired.
   *  This allows unauthenticated access for public resources while still validating
   *  tokens when they are provided. Resolution is identical to [[authenticate]]
   *  (session first, PAT fallback).
   */
  val optionalAuthenticate: Directive1[Option[AuthenticatedUser]] =
    optionalHeaderValueByType(Authorization).flatMap {
      case Some(Authorization(OAuth2BearerToken(token))) =>
        onComplete(resolveBearer(token)).flatMap {
          case Success(Some(user)) => provide(Some(user))
          case Success(None)       => complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
          case Failure(_)          => complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
        }
      case _ =>
        provide(None)
    }
}
