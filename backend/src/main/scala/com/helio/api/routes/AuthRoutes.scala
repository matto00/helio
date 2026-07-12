package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.services.AuthService

import scala.concurrent.ExecutionContextExecutor

/** Credential-based auth handlers: `/register`, `/login`, `/logout`.
 *  Business logic — password hashing, session minting, validation — lives in
 *  [[AuthService]]. Google OAuth handlers live in [[OAuthRoutes]].
 *
 *  HEL-287 CodeQL #8: the session token is no longer echoed in the response
 *  body — `register`/`login` set it via `Set-Cookie` (see [[SessionCookies]],
 *  design.md D1/D3) and `logout` reads it back from the cookie via
 *  [[AuthDirectives.authenticate]] instead of a manually-parsed
 *  `Authorization` header, clearing the cookie on completion. */
class AuthRoutes(
    authService: AuthService,
    authDirectives: AuthDirectives,
    cookieConfig: CookieConfig
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  /** Public routes — no identity is required (or resolvable) yet; register
   *  and login are the routes that mint the session cookie in the first
   *  place. `logout` is mounted separately by [[ApiRoutes]] inside the
   *  authenticated route tree since it now needs a resolved identity. */
  val routes: Route =
    concat(
      path("register") {
        post {
          entity(as[RegisterRequest]) { request =>
            ServiceResponse.runWith(authService.register(request)) { result =>
              setCookie(SessionCookies.issue(result.token, cookieConfig)) {
                complete(StatusCodes.Created, result.response)
              }
            }
          }
        }
      },
      path("login") {
        post {
          entity(as[LoginRequest]) { request =>
            ServiceResponse.runWith(authService.login(request)) { result =>
              setCookie(SessionCookies.issue(result.token, cookieConfig)) {
                complete(StatusCodes.OK, result.response)
              }
            }
          }
        }
      }
    )

  /** Mounted under `/api/auth/logout` inside the authenticated route tree
   *  (see [[ApiRoutes]]). Requires a valid session cookie — PAT-authenticated
   *  callers have no session to log out of and get 401, matching the
   *  "no credential" response shape. */
  val logoutRoute: Route =
    path("logout") {
      post {
        authDirectives.authenticate { _ =>
          optionalCookie(SessionCookies.Name) {
            case Some(cookiePair) =>
              setCookie(SessionCookies.expire(cookieConfig)) {
                ServiceResponse.runNoContent(authService.logout(cookiePair.value))
              }
            case None =>
              complete(StatusCodes.Unauthorized, ErrorResponse("Unauthorized"))
          }
        }
      }
    }
}
