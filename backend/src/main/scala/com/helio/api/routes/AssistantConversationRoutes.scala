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
import com.helio.services.{AssistantConversationService, AssistantService, AssistantTelemetry, ChatAccessError, ChatAccessService, ServiceError}
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
 *  `serviceOpt.fold(unavailable)` precedent — never a confusing `404`.
 *
 *  `chatAccessService` (HEL-703, design.md D7) wraps the ENTIRE route tree below in a tier-gate
 *  directive — a `free`-tier caller is denied every endpoint in this family, including any added
 *  later, with no per-route opt-in required. `converse` alone additionally calls
 *  `ChatAccessService.checkConverseCap` after the base gate passes, since only that endpoint is
 *  metered (design.md D6). */
final class AssistantConversationRoutes(
    service: AssistantConversationService,
    assistantServiceOpt: Option[AssistantService],
    chatAccessService: ChatAccessService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  private val log = LoggerFactory.getLogger(getClass)

  private val DefaultListLimit: Int = 10

  private def unavailable: Route =
    complete(StatusCodes.ServiceUnavailable, ErrorResponse("Assistant conversation is not configured"))

  /** Maps a tier-gate denial directly to its status + [[TierErrorResponse]] body (HEL-703,
   *  design.md D7) — NOT `ServiceResponse.run`, which hardcodes the generic `ErrorResponse` and has
   *  no `429` case to map onto (`CHAT_LIMIT_REACHED`'s status has no `ServiceError` counterpart). */
  private def completeTierError(err: ChatAccessError): Route = err match {
    case ChatAccessError.TierForbidden(message) =>
      complete(StatusCodes.Forbidden, TierErrorResponse("TIER_FORBIDDEN", message, None))
    case ChatAccessError.LimitReached(limit) =>
      complete(StatusCodes.TooManyRequests, TierErrorResponse("CHAT_LIMIT_REACHED", err.message, Some(limit)))
  }

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

  /** design.md D3's converse -> (on success) append -> re-fetch flow, given the conversation's
   *  ALREADY-fetched current state (`existing`). `existing.transcript` is a raw `JsValue` — converted
   *  to `Seq[ClaudeToolMessage]` here via the same `.convertTo[...]` idiom this file already uses
   *  twice above. On `Left(claudeError)`: mapped to a real error status via `mapClaudeError`, NOTHING
   *  persisted — the user's message is never silently discarded nor fabricated into the transcript,
   *  and (HEL-667 design.md D6's own guard) no telemetry is emitted since no turn actually completed.
   *  On `Right(result)`: the telemetry line is emitted right here (mirrors `DashboardAuthoringRoutes`'s
   *  own MDC-snapshot-at-route-evaluation-time call-site placement — `mdcSnapshot` is captured at the
   *  very top of this function, synchronously on the route-evaluation thread, before any `Future`
   *  chain begins), then only the new turns (`result.fullHistory.drop(history.length)`) are appended,
   *  then the conversation is re-fetched so the response always reflects the persisted row, never a
   *  client-reconstructed approximation — now carrying `result`'s two turn-outcome signals
   *  (design.md D1).
   *
   *  `idempotencyKey` (HEL-698 design.md D3/D4) is threaded into `appendTurn`, which owns the append-
   *  time check (design.md D3, against a freshly-read record) that closes the timeout-retry race.
   *  **The route-entry replay check — same key already equals `existing.record.lastIdempotencyKey` —
   *  is NOT this function's job**: `existing` is fetched exactly once, by the `routes` val below,
   *  BEFORE deciding whether to run the HEL-703 tier-cap check at all (a replay must reach neither the
   *  cap check nor this function — see that call site's own comment) — so by the time this function is
   *  ever invoked, the caller has already established this is a real send, not a replay. Accepting
   *  `existing` as a parameter (rather than re-fetching it here, as earlier revisions of this function
   *  did) avoids a second, redundant `service.get` on every real send. */
  private def converseFlow(
      assistantService: AssistantService,
      id: AssistantConversationId,
      message: String,
      idempotencyKey: Option[String],
      existing: AssistantConversationDetail
  ): Future[Either[ServiceError, AssistantConversationResponse]] = {
    val mdcSnapshot = MDC.getCopyOfContextMap
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
      // HEL-703 design.md D7: the tier gate wraps the WHOLE route tree below — every endpoint in
      // this family (including any added later) resolves the caller's tier exactly once here.
      // `free` never reaches any inner route; `beta`/`owner` proceed with `tier` in scope for
      // `converse`'s own additional cap check below.
      onSuccess(chatAccessService.guard(user)) {
        case Left(err) => completeTierError(err)
        case Right(tier) =>
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
                        // HEL-698/HEL-703 merge reconciliation. Fetch once, decide replay-vs-real
                        // HERE, and gate the HEL-703 tier-cap check on that decision — a replayed
                        // duplicate (same idempotencyKey as the conversation's already-recorded
                        // `lastIdempotencyKey`) must reach neither the cap check nor
                        // `AssistantService.converse` (converseFlow never even runs for it), so it
                        // must never consume a unit of the beta daily cap for what is semantically
                        // the SAME logical send. Chosen ordering, in full: tier gate (guard, above,
                        // wraps everything) -> idempotency-key format validation -> fetch +
                        // replay check -> [replay: return existing detail, done] OR [real send: cap
                        // check -> converseFlow]. The fetched `existing` is passed into
                        // `converseFlow` directly (not re-fetched there) so a real send still costs
                        // exactly the same two `service.get` calls total as before this
                        // reconciliation (one here, one after `appendTurn` for the fresh response).
                        onSuccess(service.get(user, id)) {
                          case Left(e) => complete(ServiceResponse.statusCodeFor(e), ErrorResponse(e.message))
                          case Right(existing)
                              if idempotencyKey.isDefined && idempotencyKey == existing.record.lastIdempotencyKey =>
                            log.info(
                              s"Replaying converse for conversation ${id.value}: idempotency key already applied"
                            )
                            complete(detailOf(existing))
                          case Right(existing) =>
                            // HEL-703 design.md D6: the ONLY metered endpoint — beta's daily cap is
                            // checked/incremented here, after both the base tier gate above and the
                            // replay check just above have already passed.
                            onSuccess(chatAccessService.checkConverseCap(user, tier)) {
                              case Left(err) => completeTierError(err)
                              case Right(()) =>
                                ServiceResponse.run(
                                  converseFlow(assistantService, id, request.message, idempotencyKey, existing)
                                )(identity)
                            }
                        }
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
}
