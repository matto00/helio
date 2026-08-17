package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.ai.{ClaudeContentBlock, ClaudeError, ClaudeToolMessage}
import com.helio.api.{ErrorResponse, JsonProtocols, RequestValidation}
import com.helio.api.protocols.IdParsing.AssistantConversationIdSegment
import com.helio.api.protocols._
import com.helio.domain._
import com.helio.infrastructure.AssistantConversationRepository._
import com.helio.services.{AssistantConversationService, AssistantService, AssistantTelemetry, ServiceError}
import com.helio.services.AssistantConversationService.AssistantConversationDetail
import org.slf4j.{LoggerFactory, MDC}
import spray.json._

import scala.concurrent.{ExecutionContextExecutor, Future}

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
 *  header comment for why that format doesn't live under `com.helio.api.protocols`).
 *
 *  `POST /:id/converse` (HEL-665, reopened composer ticket, design.md D3/D4) is the one route in
 *  this family gated on a SECOND, independently nullable dependency (`assistantServiceOpt`) — the
 *  other 5 routes stay gated on `dbContext` alone (Pattern A, this class's own constructor-level
 *  `.fold(reject)` in `ApiRoutes.scala`), completely unaffected by whether `AssistantService` is
 *  configured. `assistantServiceOpt = None` (e.g. no `ANTHROPIC_API_KEY`) degrades ONLY the
 *  converse route to a clean `503`, mirroring `DashboardAuthoringRoutes`'s own
 *  `serviceOpt.fold(unavailable)` precedent — never a confusing `404`. */
final class AssistantConversationRoutes(
    service: AssistantConversationService,
    assistantServiceOpt: Option[AssistantService],
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  private val log = LoggerFactory.getLogger(getClass)

  private val DefaultListLimit: Int = 10

  private def unavailable: Route =
    complete(StatusCodes.ServiceUnavailable, ErrorResponse("Assistant conversation is not configured"))

  private def summaryOf(record: AssistantConversationRecord): AssistantConversationSummaryResponse =
    AssistantConversationSummaryResponse(
      id        = record.id.value,
      title     = record.title,
      pinned    = record.pinned,
      updatedAt = record.updatedAt.toString
    )

  /** `hopBudgetExhausted`/`searchedWithNoResults` stay `None` (the case class's own defaults) —
   *  every call site EXCEPT `converseFlow`'s own re-fetch (see [[detailOfConverse]]) leaves them
   *  unset (design.md D1: `GET`/create/append never carry either signal). Kept as a plain one-arg
   *  function (not a defaulted-param overload of `detailOfConverse`) so it stays eta-expandable bare
   *  at its `ServiceResponse.run(...)(detailOf)` call site below — a method with trailing defaulted
   *  params does NOT eta-expand to a narrower function type in Scala.
   *
   *  `lastIdempotencyKey` (HEL-698 design.md D5) — UNLIKE those two ephemeral signals, this IS
   *  populated here, from `detail.record.lastIdempotencyKey`, on every call site (GET, create,
   *  append, converse, AND the route-entry replay short-circuit below) — it is a persisted fact, not
   *  a just-this-turn signal. */
  private def detailOf(detail: AssistantConversationDetail): AssistantConversationResponse =
    AssistantConversationResponse(
      id                 = detail.record.id.value,
      title              = detail.record.title,
      pinned             = detail.record.pinned,
      updatedAt          = detail.record.updatedAt.toString,
      transcript         = detail.transcript,
      lastIdempotencyKey = detail.record.lastIdempotencyKey
    )

  /** `converseFlow`'s own re-fetch (design.md D1) — the ONE call site that actually populates
   *  `hopBudgetExhausted`/`searchedWithNoResults` as `Some(...)`. */
  private def detailOfConverse(
      detail: AssistantConversationDetail,
      hopBudgetExhausted: Boolean,
      searchedWithNoResults: Boolean
  ): AssistantConversationResponse =
    detailOf(detail).copy(
      hopBudgetExhausted    = Some(hopBudgetExhausted),
      searchedWithNoResults = Some(searchedWithNoResults)
    )

  /** `ClaudeError -> ServiceError`, the identical 3-case mapping `DashboardAuthoringService
   *  .mapClaudeError` already establishes (design.md D3) — kept as a small, local duplication here
   *  (this route emits a bare `ServiceError`, not `DashboardAuthoringService`'s `AuthoringError`,
   *  so the two can't literally share one function) rather than extracting a shared helper out of
   *  already-shipped HEL-401 code for this ticket's own sake. */
  private def mapClaudeError(err: ClaudeError): ServiceError = err match {
    case ClaudeError.ApiError(status, body)    => ServiceError.BadGateway(s"Claude API error ($status): $body")
    case ClaudeError.TransportFailure(message) => ServiceError.BadGateway(message)
    case ClaudeError.GuardrailExceeded(reason) => ServiceError.UnprocessableEntity(reason)
  }

  /** design.md D3's fetch -> converse -> (on success) append -> re-fetch flow. `existing.transcript`
   *  is a raw `JsValue` (from `service.get`) — converted to `Seq[ClaudeToolMessage]` here via the
   *  same `.convertTo[...]` idiom this file already uses twice above. On `Left(claudeError)`:
   *  mapped to a real error status via `mapClaudeError`, NOTHING persisted — the user's message is
   *  never silently discarded nor fabricated into the transcript, and (HEL-667 design.md D6's own
   *  guard) no telemetry is emitted since no turn actually completed. On `Right(result)`: the
   *  telemetry line is emitted right here (mirrors `DashboardAuthoringRoutes`'s own MDC-snapshot-at-
   *  route-evaluation-time call-site placement — `mdcSnapshot` is captured at the very top of this
   *  function, synchronously on the route-evaluation thread, before any `Future` chain begins), then
   *  only the new turns (`result.fullHistory.drop(history.length)`) are appended, then the
   *  conversation is re-fetched so the response always reflects the persisted row, never a
   *  client-reconstructed approximation — now carrying `result`'s two turn-outcome signals
   *  (design.md D1).
   *
   *  `idempotencyKey` (HEL-698 design.md D3/D4) — a ROUTE-ENTRY replay check runs first, right after
   *  the initial `service.get`: when the key is defined and equals `existing`'s already-recorded
   *  `lastIdempotencyKey`, this IS a replay of an already-applied send — return the current detail
   *  immediately, never call `AssistantService.converse`, never touch `appendTurn`, no telemetry (no
   *  turn completes), one info log line for observability. Otherwise the key is threaded into
   *  `appendTurn`, which owns the SECOND check (design.md D3's append-time check against a freshly-
   *  read record) that closes the timeout-retry race. */
  private def converseFlow(
      assistantService: AssistantService,
      id: AssistantConversationId,
      message: String,
      idempotencyKey: Option[String]
  ): Future[Either[ServiceError, AssistantConversationResponse]] = {
    val mdcSnapshot = MDC.getCopyOfContextMap
    service.get(user, id).flatMap {
      case Left(e) => Future.successful(Left(e))
      case Right(existing) if idempotencyKey.isDefined && idempotencyKey == existing.record.lastIdempotencyKey =>
        log.info(s"Replaying converse for conversation ${id.value}: idempotency key already applied")
        Future.successful(Right(detailOf(existing)))
      case Right(existing) =>
        val history = existing.transcript.convertTo[Seq[ClaudeToolMessage]]
        assistantService.converse(history, message, user).flatMap {
          case Left(claudeError) => Future.successful(Left(mapClaudeError(claudeError)))
          case Right(result) =>
            val newTurns = result.fullHistory.drop(history.length)
            AssistantTelemetry.emitToolLoopOutcome(
              mdcSnapshot,
              conversationId = id.value,
              toolCallCount = countToolUses(newTurns),
              hopBudgetExhausted = result.hopBudgetExhausted,
              searchedWithNoResults = result.searchedWithNoResults,
              modelId = assistantService.modelId,
              tokens = result.usage,
              proposeAttempts = result.proposeAttempts,
              proposeDecodeFailures = result.proposeDecodeFailures,
              proposeValidationFailures = result.proposeValidationFailures
            )
            service.appendTurn(user, id, newTurns, idempotencyKey).flatMap {
              case Left(e) => Future.successful(Left(e))
              case Right(_) =>
                service
                  .get(user, id)
                  .map(_.map(detailOfConverse(_, result.hopBudgetExhausted, result.searchedWithNoResults)))
            }
        }
    }
  }

  /** `toolCallCount` for `AssistantTelemetry` (design.md D6, tasks.md 5.2) — counts every `tool_use`
   *  content block across THIS call's new turns only, distinct from `AssistantTurnResult.toolCallCount`
   *  (which counts across the whole accumulated `fullHistory`, including turns from earlier converse
   *  calls in the same conversation). */
  private def countToolUses(turns: Seq[ClaudeToolMessage]): Int =
    turns.iterator.flatMap(_.content).count {
      case _: ClaudeContentBlock.ToolUse => true
      case _                              => false
    }

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
        path(AssistantConversationIdSegment / "converse") { id =>
          post {
            assistantServiceOpt.fold(unavailable) { assistantService =>
              entity(as[ConverseRequest]) { request =>
                RequestValidation.validateIdempotencyKey(request.idempotencyKey) match {
                  case Left(err) => complete(StatusCodes.BadRequest, ErrorResponse(err))
                  case Right(idempotencyKey) =>
                    ServiceResponse.run(converseFlow(assistantService, id, request.message, idempotencyKey))(identity)
                }
              }
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
