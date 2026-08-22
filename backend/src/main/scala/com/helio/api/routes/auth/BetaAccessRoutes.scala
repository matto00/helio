package com.helio.api.routes.auth

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.http.RequestValidation
import com.helio.api.{ErrorResponse, JsonProtocols, UserResponse}
import com.helio.api.protocols.auth.RedeemInviteCodeRequest
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.auth.{BetaAccessError, BetaAccessService}

import scala.concurrent.ExecutionContextExecutor

/** `POST /api/beta-access/request` + `POST /api/beta-access/redeem` (HEL-704, design.md D7). All
 *  orchestration lives in [[BetaAccessService]] -- this is a thin HTTP shell, mirroring
 *  `AssistantConversationRoutes`'s bespoke-error-completion pattern (NOT `ServiceResponse.run`,
 *  whose status mapping has no `503`/`429` cases for [[BetaAccessError.EmailUnconfigured]]/
 *  [[BetaAccessError.Cooldown]]).
 *
 *  `redeem`'s success response reuses `UserResponse.fromDomain` verbatim -- the same shape every
 *  other auth-adjacent endpoint (register/login/OAuth/`GET /api/auth/me`) returns, now carrying
 *  the caller's just-upgraded `tier = "beta"` (settings-beta-access-ui spec's "unlocks without
 *  re-login" requirement is a frontend concern: the route only needs to return fresh data). */
final class BetaAccessRoutes(service: BetaAccessService, user: AuthenticatedUser)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val ec: ExecutionContextExecutor = system.executionContext

  private def completeBetaAccessError(err: BetaAccessError): Route = err match {
    case e: BetaAccessError.EmailUnconfigured => complete(StatusCodes.ServiceUnavailable, ErrorResponse(e.message))
    case e: BetaAccessError.NotEligible       => complete(StatusCodes.Conflict, ErrorResponse(e.message))
    case e: BetaAccessError.Cooldown          => complete(StatusCodes.TooManyRequests, ErrorResponse(e.message))
    case e: BetaAccessError.SendFailed        => complete(StatusCodes.BadGateway, ErrorResponse(e.message))
    case e: BetaAccessError.InvalidCode       => complete(StatusCodes.BadRequest, ErrorResponse(e.message))
  }

  val routes: Route =
    pathPrefix("beta-access") {
      concat(
        path("request") {
          post {
            onSuccess(service.requestAccess(user)) {
              case Right(()) => complete(StatusCodes.NoContent)
              case Left(err) => completeBetaAccessError(err)
            }
          }
        },
        path("redeem") {
          post {
            entity(as[RedeemInviteCodeRequest]) { request =>
              RequestValidation.validateRedeemInviteCodeRequest(request) match {
                case Left(err) => complete(StatusCodes.BadRequest, ErrorResponse(err))
                case Right(validated) =>
                  onSuccess(service.redeem(user, validated.code)) {
                    case Right(updatedUser) => complete(StatusCodes.OK, UserResponse.fromDomain(updatedUser))
                    case Left(err)          => completeBetaAccessError(err)
                  }
              }
            }
          }
        }
      )
    }
}
