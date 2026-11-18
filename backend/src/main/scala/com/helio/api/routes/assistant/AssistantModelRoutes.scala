package com.helio.api.routes.assistant

import com.helio.api.JsonProtocols
import com.helio.api.protocols.assistant.{AssistantModelOption, AssistantModelRef, AssistantModelsResponse}
import com.helio.api.routes.TierErrorCompletion
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.services.assistant.AssistantModelPolicy
import com.helio.services.auth.ChatAccessService
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.server.{Directives, Route}

import scala.concurrent.Future

/** `GET /api/assistant-models` (HEL-1755 D8): the selectable models with their beta weights, the server default and
 *  the caller's resolved default for a new conversation. Same tier gate as the conversation routes (free -> 403). */
final class AssistantModelRoutes(
    policy: AssistantModelPolicy,
    chatAccessService: ChatAccessService,
    user: AuthenticatedUser,
    userDefaultModel: UserId => Future[Option[String]]
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private def refOf(id: String): AssistantModelRef = AssistantModelRef(id, policy.labelOf(id))

  val routes: Route =
    path("assistant-models") {
      get {
        onSuccess(chatAccessService.guard(user)) {
          case Left(err) => TierErrorCompletion.completeTierError(err)
          case Right(_) =>
            onSuccess(userDefaultModel(user.id)) { userDefault =>
              complete(
                AssistantModelsResponse(
                  models        = policy.catalog.selectable.map(s => AssistantModelOption(s.id, s.label, policy.weightOf(s.id))),
                  serverDefault = refOf(policy.serverDefault),
                  defaultModel  = refOf(policy.defaultFor(userDefault))
                )
              )
            }
        }
      }
    }
}
