package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.ai.ClaudeToolMessage
import com.helio.api.JsonProtocols
import com.helio.api.protocols.IdParsing.AssistantConversationIdSegment
import com.helio.api.protocols._
import com.helio.domain._
import com.helio.infrastructure.AssistantConversationRepository._
import com.helio.services.AssistantConversationService
import com.helio.services.AssistantConversationService.AssistantConversationDetail
import spray.json._

import scala.concurrent.ExecutionContextExecutor

/** Thin HTTP shell for `/api/assistant-conversations` (HEL-663). All logic in
 *  [[AssistantConversationService]] — mirrors `MetricRoutes`'s thin-HTTP-shell pattern, with one
 *  deliberate departure (design.md D5, design-gate round-1 fix): the list endpoint's default `limit`
 *  is a ROUTE-LOCAL constant (`DefaultListLimit = 10`), explicitly NOT `Page.Default.limit` (`200`)
 *  — mirroring `MetricRoutes`'s pagination shape literally here would silently violate this ticket's
 *  own "default view shows 10 most recent" AC. An explicit caller-supplied `limit` is still clamped
 *  to `Page.MaxLimit`, same as `MetricRoutes`.
 *
 *  `firstMessage`/`turns`/`transcript` cross this boundary as raw `JsValue` — converted to/from
 *  `ClaudeToolMessage` here via the repository-internal format imported from
 *  `AssistantConversationRepository` (design.md D3; see `AssistantConversationProtocol.scala`'s own
 *  header comment for why that format doesn't live under `com.helio.api.protocols`). */
final class AssistantConversationRoutes(
    service: AssistantConversationService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  private val DefaultListLimit: Int = 10

  private def summaryOf(record: AssistantConversationRecord): AssistantConversationSummaryResponse =
    AssistantConversationSummaryResponse(
      id        = record.id.value,
      title     = record.title,
      pinned    = record.pinned,
      updatedAt = record.updatedAt.toString
    )

  private def detailOf(detail: AssistantConversationDetail): AssistantConversationResponse =
    AssistantConversationResponse(
      id         = detail.record.id.value,
      title      = detail.record.title,
      pinned     = detail.record.pinned,
      updatedAt  = detail.record.updatedAt.toString,
      transcript = detail.transcript
    )

  val routes: Route =
    pathPrefix("assistant-conversations") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              parameters("limit".as[Int].?) { limitOpt =>
                val limit = math.min(limitOpt.getOrElse(DefaultListLimit), Page.MaxLimit)
                onSuccess(service.list(user, limit)) { records =>
                  complete(records.map(summaryOf))
                }
              }
            },
            post {
              entity(as[CreateAssistantConversationRequest]) { request =>
                val firstMessage = request.firstMessage.map(_.convertTo[ClaudeToolMessage])
                onSuccess(service.create(user, firstMessage, request.title)) { detail =>
                  complete(StatusCodes.Created, detailOf(detail))
                }
              }
            }
          )
        },
        path(AssistantConversationIdSegment / "messages") { id =>
          post {
            entity(as[AppendAssistantConversationTurnRequest]) { request =>
              val turns = request.turns.map(_.convertTo[ClaudeToolMessage])
              ServiceResponse.run(service.appendTurn(user, id, turns))(summaryOf)
            }
          }
        },
        path(AssistantConversationIdSegment) { id =>
          concat(
            get {
              ServiceResponse.run(service.get(user, id))(detailOf)
            },
            patch {
              entity(as[UpdateAssistantConversationRequest]) { request =>
                ServiceResponse.run(service.update(user, id, request.pinned, request.title))(summaryOf)
              }
            }
          )
        }
      )
    }
}
