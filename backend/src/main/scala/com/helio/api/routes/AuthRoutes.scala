package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.services.AuthService

import scala.concurrent.ExecutionContextExecutor

/** Credential-based auth handlers: `/register`, `/login`, `/logout`.
 *  Business logic — password hashing, session minting, validation — lives in
 *  [[AuthService]]. Google OAuth handlers live in [[OAuthRoutes]]. */
class AuthRoutes(authService: AuthService)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    concat(
      path("register") {
        post {
          entity(as[RegisterRequest]) { request =>
            ServiceResponse.run(authService.register(request)) { resp =>
              StatusCodes.Created -> resp
            }
          }
        }
      },
      path("login") {
        post {
          entity(as[LoginRequest]) { request =>
            ServiceResponse.run(authService.login(request))(identity)
          }
        }
      },
      path("logout") {
        post {
          optionalHeaderValueByType(Authorization) {
            case Some(Authorization(OAuth2BearerToken(token))) =>
              ServiceResponse.runNoContent(authService.logout(token))
            case _ =>
              complete(StatusCodes.Unauthorized, ErrorResponse("Authorization header required"))
          }
        }
      }
    )
}
