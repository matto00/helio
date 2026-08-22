package com.helio.api.routes.auth

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.http._
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.auth.MfaService

import scala.concurrent.ExecutionContextExecutor

/** TOTP MFA endpoints (HEL-702, design.md D6): the authenticated enrollment/
 *  status/backup-code/disable surface (`authenticatedRoutes`, mounted inside
 *  `ApiRoutes`'s `authenticate` concat, mirroring `ApiTokenRoutes`) plus the
 *  public login-time `POST /api/auth/mfa/verify` (`verifyRoute`, mounted
 *  alongside `AuthRoutes`/`OAuthRoutes` in the public `pathPrefix("auth")`
 *  concat) — one class for both, mirroring `AuthRoutes`'s own split between
 *  its public `routes` and its authenticated `logoutRoute`. */
final class MfaRoutes(
    mfaService: MfaService,
    cookieConfig: CookieConfig
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  /** Public: exchanges a challenge token + TOTP-or-backup code for a
   *  session, identical in shape to `AuthRoutes`'s login (`setCookie` +
   *  `AuthResponse`). No session cookie exists yet on this request, so
   *  `AuthDirectives.requireCsrfHeader` is naturally inert here — mirrors
   *  register/login's own exemption. */
  val verifyRoute: Route =
    path("mfa" / "verify") {
      post {
        entity(as[MfaVerifyRequest]) { request =>
          ServiceResponse.runWith(mfaService.verifyLogin(request)) { result =>
            setCookie(SessionCookies.issue(result.token, cookieConfig)) {
              complete(StatusCodes.OK, result.response)
            }
          }
        }
      }
    }

  /** Authenticated: status + the enrollment/backup-code/disable lifecycle.
   *  All derive the acting user from the already-resolved `user` — no
   *  cross-user access shape exists for any of these routes. */
  def authenticatedRoutes(user: AuthenticatedUser): Route =
    pathPrefix("mfa") {
      concat(
        pathEndOrSingleSlash {
          get { ServiceResponse.run(mfaService.status(user))(identity) }
        },
        path("enroll") {
          post { ServiceResponse.run(mfaService.startEnrollment(user))(identity) }
        },
        path("enroll" / "confirm") {
          post {
            entity(as[MfaConfirmRequest]) { request =>
              ServiceResponse.run(mfaService.confirmEnrollment(request, user))(identity)
            }
          }
        },
        path("backup-codes" / "regenerate") {
          post {
            entity(as[MfaReauthRequest]) { request =>
              ServiceResponse.run(mfaService.regenerateBackupCodes(request, user))(identity)
            }
          }
        },
        path("disable") {
          post {
            entity(as[MfaReauthRequest]) { request =>
              ServiceResponse.runNoContent(mfaService.disable(request, user))
            }
          }
        }
      )
    }
}
