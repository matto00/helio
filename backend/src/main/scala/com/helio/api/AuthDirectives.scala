package com.helio.api

import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import akka.http.scaladsl.server.Directive1
import akka.http.scaladsl.server.Directives._
import com.helio.domain.AuthenticatedUser
import com.helio.infrastructure.UserSessionRepository

import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

class AuthDirectives(userSessionRepo: UserSessionRepository)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  /** Extracts a Bearer token from the Authorization header, validates it against
   *  the session store, and provides the resolved AuthenticatedUser to the inner route.
   *  Returns 401 with a JSON error body if the header is missing, malformed, or the
   *  token is unknown/expired — always a `complete` (not a rejection) so the error
   *  shape is consistent regardless of the route tree.
   */
  val authenticate: Directive1[AuthenticatedUser] =
    optionalHeaderValueByType(Authorization).flatMap {
      case Some(Authorization(OAuth2BearerToken(token))) =>
        onComplete(userSessionRepo.findValidSession(token)).flatMap {
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
   *  tokens when they are provided.
   */
  val optionalAuthenticate: Directive1[Option[AuthenticatedUser]] =
    optionalHeaderValueByType(Authorization).flatMap {
      case Some(Authorization(OAuth2BearerToken(token))) =>
        onComplete(userSessionRepo.findValidSession(token)).flatMap {
          case Success(Some(user)) => provide(Some(user))
          case Success(None)       => complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
          case Failure(_)          => complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
        }
      case _ =>
        provide(None)
    }
}
