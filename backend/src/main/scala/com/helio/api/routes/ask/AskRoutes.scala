package com.helio.api.routes.ask

import com.helio.api.protocols.IdParsing.{DashboardIdSegment, OutputIdSegment}
import com.helio.api.protocols.ask.{AskQuestionRequest, AskTruncatedResponse, AskUngroundedResponse}
import com.helio.api.routes.{ServiceResponse, TierErrorCompletion}
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.ask.{AskAccess, AskDataService, AskError, AskReasons, AskScope}
import com.helio.services.assistant.AssistantModelPolicy
import com.helio.services.auth.ChatAccessService
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}

import scala.concurrent.ExecutionContext

/** `POST /api/dashboards/:id/ask` and `POST /api/outputs/:id/ask` (HEL-1745), authenticated tree only.
 *
 *  Order, so a stranger learns nothing and is never charged: access (404 for any caller the explicit-SQL gate does not
 *  admit, a public grant or share token included, even with no model client); no client configured -> 503; body validation (question 1..2000
 *  characters after trimming, else 400); the tier gate (free -> 403); one charge at the server default model's catalog
 *  weight before the first model call. The corrective retry inside an ask is not charged again. */
final class AskRoutes(
    serviceOpt: Option[AskDataService],
    access: AskAccess,
    chatAccess: ChatAccessService,
    policy: AssistantModelPolicy,
    user: AuthenticatedUser
)(implicit ec: ExecutionContext)
    extends Directives
    with JsonProtocols {

  private val MaxQuestionChars = 2000

  private def unavailable: Route = complete(StatusCodes.ServiceUnavailable, ErrorResponse("Ask is not configured"))

  private def askRoute(scope: AskScope): Route =
    post {
      onSuccess(access.gate(scope, user)) {
        case Left(err) => complete(ServiceResponse.statusCodeFor(err), ErrorResponse(err.message))
        case Right(()) =>
          serviceOpt.fold(unavailable) { service =>
            entity(as[AskQuestionRequest]) { request =>
              val question = request.question.trim
              if (question.isEmpty || question.length > MaxQuestionChars)
                complete(StatusCodes.BadRequest, ErrorResponse(s"question must be 1..$MaxQuestionChars characters"))
              else
                onSuccess(chatAccess.guard(user)) {
                  case Left(err) => TierErrorCompletion.completeTierError(err)
                  case Right(tier) =>
                    val modelId = policy.serverDefault
                    onSuccess(chatAccess.checkConverseCap(user, tier, policy.weightOf(modelId), policy.labelOf(modelId))) {
                      case Left(err) => TierErrorCompletion.completeTierError(err)
                      case Right(()) =>
                        onSuccess(service.ask(scope, question, user)) {
                          case Right(response) => complete(response)
                          case Left(AskError.Ungrounded(reasons)) =>
                            complete(
                              StatusCodes.UnprocessableEntity,
                              AskUngroundedResponse("The answer could not be grounded in the data", "ASK_UNGROUNDED", AskReasons.publicOf(reasons))
                            )
                          case Left(AskError.Truncated) =>
                            complete(
                              StatusCodes.UnprocessableEntity,
                              AskTruncatedResponse("The answer ran out of room before it finished; ask something narrower", "ASK_ANSWER_TRUNCATED")
                            )
                          case Left(AskError.Failed(err)) => complete(ServiceResponse.statusCodeFor(err), ErrorResponse(err.message))
                        }
                    }
                }
            }
          }
      }
    }

  val routes: Route =
    concat(
      path("dashboards" / DashboardIdSegment / "ask") { id => askRoute(AskScope.DashboardScope(id.value)) },
      path("outputs" / OutputIdSegment / "ask") { id => askRoute(AskScope.OutputScope(id.value)) }
    )
}
