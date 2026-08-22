package com.helio.services.proposals

import com.helio.services.ServiceError
import com.helio.ai.TokenUsage

/** Distinguishes WHY an authoring call failed, threaded ALONGSIDE the existing [[ServiceError]]
 *  (HEL-401 design.md D1) rather than folded into it — `ServiceError`'s own doc comment states it
 *  is "intentionally a small, closed set" shared by every service in the codebase, so adding
 *  authoring-specific cases there would be invasive for one caller's needs. HTTP status codes are
 *  still driven entirely by the paired `ServiceError`; this only adds a UI-branchable category the
 *  client can switch on instead of string-matching a message. */
sealed trait AuthoringErrorKind

object AuthoringErrorKind {
  /** The upstream Claude API/transport failed (`ClaudeError.ApiError`/`TransportFailure`). */
  case object ModelFailure extends AuthoringErrorKind
  /** A repair-exhausted proposal — still unparseable or still failing
   *  `DashboardProposalService.validate` after the one allowed repair attempt. */
  case object InvalidProposal extends AuthoringErrorKind
  /** No pipeline-output DataTypes exist to ground an authoring call against — the short-circuit
   *  BEFORE any Claude call. */
  case object EmptyWorkspace extends AuthoringErrorKind
  /** A token/cost guardrail was exceeded — either `ClaudeClient`'s own pre-flight
   *  `GuardrailExceeded` rejection, or the HEL-397 per-conversation token ceiling. Both collapse to
   *  this single kind (design.md D2): different `ServiceError`s underneath, same user-facing story
   *  ("you've used your token budget"). */
  case object BudgetExceeded extends AuthoringErrorKind

  /** The wire-shape name rendered into `AuthoringErrorResponse.kind` / `AuthoringStreamEvent.
   *  Error.kind` — matches spec.md's Scenario text verbatim (`ModelFailure`/`InvalidProposal`/
   *  `EmptyWorkspace`/`BudgetExceeded`). */
  def wireName(kind: AuthoringErrorKind): String = kind match {
    case ModelFailure    => "ModelFailure"
    case InvalidProposal => "InvalidProposal"
    case EmptyWorkspace  => "EmptyWorkspace"
    case BudgetExceeded  => "BudgetExceeded"
  }
}

/** Pairs an OPTIONAL, UI-branchable [[AuthoringErrorKind]] with the existing [[ServiceError]] that
 *  still determines HTTP status/message (design.md D1) — `DashboardAuthoringService`'s own Left
 *  channel for `author`/`authorStreaming`/the conversation-continuation path.
 *
 *  `kind` is `None` for failure modes outside the ticket's four defined categories (e.g. a missing/
 *  not-owned `conversationId` — a plain `404`, unaffected by this ticket): the route renders those
 *  with the pre-existing bare `ErrorResponse(message)` shape, unchanged, rather than inventing a
 *  fifth catch-all `AuthoringErrorKind` the ticket never asked for.
 *
 *  `tokensUsed` carries REAL usage (never the pre-flight estimate) when a Claude call actually ran
 *  before the failure (e.g. a repair-exhausted `InvalidProposal` made two real calls) — `(0, 0)`
 *  when the failure occurred before any call (guardrail rejection, empty workspace, missing
 *  conversation). Telemetry-only; never affects the HTTP response. */
final case class AuthoringError(
    kind: Option[AuthoringErrorKind], serviceError: ServiceError, tokensUsed: TokenUsage = AuthoringError.NoTokens
)

object AuthoringError {
  private val NoTokens = TokenUsage(0, 0)

  /** One of the ticket's four defined failure categories. */
  def kinded(kind: AuthoringErrorKind, serviceError: ServiceError, tokensUsed: TokenUsage = NoTokens): AuthoringError =
    AuthoringError(Some(kind), serviceError, tokensUsed)

  /** A failure outside the four defined categories (e.g. `NotFound`) — no `kind` reaches the wire. */
  def plain(serviceError: ServiceError): AuthoringError =
    AuthoringError(None, serviceError, NoTokens)
}
