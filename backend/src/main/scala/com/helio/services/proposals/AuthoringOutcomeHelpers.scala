package com.helio.services.proposals

import com.helio.ai.TokenUsage
import com.helio.api.protocols.proposals.{AuthoringStreamEvent, DashboardAuthoringResponse, DashboardProposal}

import java.util.{Map => JMap}
import java.util.UUID
import scala.concurrent.ExecutionContextExecutor

/** `DashboardAuthoringService`'s own terminal-outcome helpers (HEL-401 tasks.md 6.1) — pairs a
 *  telemetry emission ([[AuthoringTelemetry]]) with building the domain response/event object the
 *  buffered or streaming path actually returns to its caller. Kept as a SIBLING object to
 *  `AuthoringTelemetry` rather than folded into it: `AuthoringTelemetry`'s own doc comment scopes
 *  it to pure log emission, and these functions also construct `DashboardAuthoringResponse`/
 *  `AuthoringStreamEvent` domain objects (including minting a fresh `authoringRequestId`) — a
 *  different concern that would blur that scope if merged in.
 *
 *  Takes `proposal`/`warnings`/`tokens` as separate parameters rather than
 *  `DashboardAuthoringService`'s own private `AttemptOutcome` case class, which cannot be
 *  referenced from outside that class; `modelId` is threaded explicitly (mirrors
 *  `AuthoringTelemetry.emitGenerated`/`emitFailed`'s own `modelId: String` parameter) since
 *  `claudeClient.modelId` is an instance member of `DashboardAuthoringService`, out of scope here. */
object AuthoringOutcomeHelpers {

  /** Failed terminal outcome — buffered path. Emits `outcome=failed` telemetry, then returns the
   *  `Left` the caller returns as-is. */
  def failWithTelemetry(
      mdcSnapshot: JMap[String, String],
      err: AuthoringError,
      modelId: String,
      goal: String
  )(implicit ec: ExecutionContextExecutor): Either[AuthoringError, DashboardAuthoringResponse] = {
    AuthoringTelemetry.emitFailed(mdcSnapshot, err.kind, modelId, err.tokensUsed, goal)
    Left(err)
  }

  /** Successful terminal outcome — buffered path. Mints a fresh `authoringRequestId`, emits
   *  `outcome=generated` telemetry, then builds the `DashboardAuthoringResponse`. */
  def succeedWithTelemetry(
      mdcSnapshot: JMap[String, String],
      proposal: DashboardProposal,
      warnings: Vector[String],
      tokens: TokenUsage,
      conversationId: String,
      modelId: String,
      goal: String
  )(implicit ec: ExecutionContextExecutor): DashboardAuthoringResponse = {
    val authoringRequestId = UUID.randomUUID().toString
    AuthoringTelemetry.emitGenerated(mdcSnapshot, authoringRequestId, modelId, proposal.panels.size, tokens, goal)
    DashboardAuthoringResponse(proposal, warnings, conversationId, authoringRequestId)
  }

  /** Failed terminal outcome — streaming path. Same telemetry as [[failWithTelemetry]]; builds the
   *  terminal `AuthoringStreamEvent.Error` instead of an HTTP response. */
  def failStreamEvent(
      mdcSnapshot: JMap[String, String],
      err: AuthoringError,
      modelId: String,
      goal: String
  )(implicit ec: ExecutionContextExecutor): AuthoringStreamEvent.Error = {
    AuthoringTelemetry.emitFailed(mdcSnapshot, err.kind, modelId, err.tokensUsed, goal)
    AuthoringStreamEvent.Error(err.serviceError.message, err.kind.map(AuthoringErrorKind.wireName))
  }

  /** Successful terminal outcome — streaming path. Same telemetry as [[succeedWithTelemetry]];
   *  builds the terminal `AuthoringStreamEvent.Result` instead of an HTTP response. */
  def succeedStreamEvent(
      mdcSnapshot: JMap[String, String],
      proposal: DashboardProposal,
      warnings: Vector[String],
      tokens: TokenUsage,
      conversationId: String,
      modelId: String,
      goal: String
  )(implicit ec: ExecutionContextExecutor): AuthoringStreamEvent.Result = {
    val authoringRequestId = UUID.randomUUID().toString
    AuthoringTelemetry.emitGenerated(mdcSnapshot, authoringRequestId, modelId, proposal.panels.size, tokens, goal)
    AuthoringStreamEvent.Result(proposal, warnings, conversationId, authoringRequestId)
  }
}
