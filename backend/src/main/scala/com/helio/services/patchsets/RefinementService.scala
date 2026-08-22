package com.helio.services.patchsets

import com.helio.services.proposals.{AuthoringErrorKind, AuthoringHistoryBudget}
import com.helio.services.ServiceError
import com.helio.services.proposals.AuthoringError
import com.helio.ai.{ClaudeClient, ClaudeError, ClaudeMessage, ClaudeRequest, ClaudeRole, TokenUsage}
import com.helio.api.protocols.patchsets.{PatchSet, RefinementRequest, RefinementResponse}
import com.helio.domain.model.{AuthenticatedUser, AuthoringConversationId}
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository.AuthoringConversationRecord

import scala.concurrent.{ExecutionContext, Future}

/** `POST /api/refinements` (design.md, this ticket) — turns a user's natural-language message about
 *  an EXISTING dashboard/pipeline into a validated `PatchSet`, grounded in that target's real current
 *  live state (`RefinementGrounding`, design.md D1) plus workspace-wide context (HEL-345) and
 *  panel-capability menus (HEL-365, AC5). NEVER applies the patch set — applying stays the caller's
 *  explicit, separate action via the existing `POST /api/patch-sets/apply` (HEL-406). Multi-turn,
 *  buffered only (design.md Non-Goals — no SSE variant, unlike `DashboardAuthoringService`).
 *
 *  Mirrors `DashboardAuthoringService`'s structure closely (turn 1 / continuation, parse-validate-
 *  repair core, `AuthoringError`/`AuthoringErrorKind` reuse) but targets an EXISTING resource and
 *  produces a `PatchSet`, not a `DashboardProposal`. Composes `RefinementGrounding` (which itself
 *  resolves + ACL-checks `request.target` BEFORE any Claude call), `PatchSetPreviewService.preview`
 *  (design.md D2 — the SAME "reuse the apply path's own validation" pattern `DashboardAuthoringService`
 *  uses via `DashboardProposalService.validate`), `ClaudeClient` (HEL-390), and
 *  `AuthoringConversationRepository` (HEL-397, generalized by design.md D3) via
 *  `RefinementConversationTurns` — this class holds no persistence logic of its own beyond
 *  delegating to that turns-glue class.
 *
 *  Parse/validate/repair core: the model's response text is parsed defensively
 *  (`RefinementParsing`) into a `PatchSet`, then validated via `PatchSetPreviewService.preview` — the
 *  exact same pre-validation + per-kind content checks `apply` itself would run. A parse failure or a
 *  `preview` rejection triggers exactly ONE re-prompt; a second failure returns `422
 *  UnprocessableEntity` (kind `InvalidProposal`) — never a third attempt. */
final class RefinementService(
    refinementGrounding: RefinementGrounding,
    patchSetPreviewService: PatchSetPreviewService,
    claudeClient: ClaudeClient,
    conversationRepo: AuthoringConversationRepository
)(implicit ec: ExecutionContext) {

  private val turns = new RefinementConversationTurns(conversationRepo)

  /** Outcome of a successful parse-validate(-repair) attempt — the final response TEXT (never
   *  re-derived from `patchSet` — the persisted assistant message must be the model's own output
   *  verbatim) and the REAL accumulated token usage across every Claude call this attempt made. */
  private final case class AttemptOutcome(patchSet: PatchSet, finalResponseText: String, tokens: TokenUsage)

  // ── Public API ──────────────────────────────────────────────────────────

  def refine(request: RefinementRequest, user: AuthenticatedUser): Future[Either[AuthoringError, RefinementResponse]] =
    request.conversationId match {
      case Some(rawId) => continueBuffered(AuthoringConversationId(rawId), request, user)
      case None         => startBuffered(request, user)
    }

  // ── Turn 1 (no conversationId) ─────────────────────────────────────────

  private def startBuffered(request: RefinementRequest, user: AuthenticatedUser): Future[Either[AuthoringError, RefinementResponse]] =
    refinementGrounding.assemble(request.target, user).flatMap {
      case Left(err) => Future.successful(Left(AuthoringError.plain(err)))
      case Right(ctx) =>
        val userMessage = ClaudeMessage(ClaudeRole.User, RefinementPrompt.userMessage(ctx, request.message))
        runAttempt(Vector(userMessage), user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(outcome) =>
            turns
              .persistNew(user, request.message, userMessage, outcome.finalResponseText, outcome.patchSet, totalTokensOf(outcome))
              .map(conv => Right(RefinementResponse(outcome.patchSet, conv.id.value)))
        }
    }

  // ── Continued turns (conversationId present, design.md D3a) ────────────

  private def continueBuffered(
      id: AuthoringConversationId,
      request: RefinementRequest,
      user: AuthenticatedUser
  ): Future[Either[AuthoringError, RefinementResponse]] =
    loadForContinuation(id, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(prior) =>
        val userMessage = ClaudeMessage(ClaudeRole.User, request.message)
        val messages     = AuthoringHistoryBudget.trim(prior.apiHistory, AuthoringHistoryBudget.DefaultMaxHistoryTokens) :+ userMessage
        // No new grounding-assembly on a continued turn — grounding is only ever (re-)assembled on
        // turn 1, mirroring DashboardAuthoringService's identical design.md D3 precedent.
        runAttempt(messages, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(outcome) =>
            turns.persistContinuation(prior, user, request.message, userMessage, outcome.finalResponseText, outcome.patchSet, totalTokensOf(outcome)).map {
              case Some(conv) => Right(RefinementResponse(outcome.patchSet, conv.id.value))
              case None       => Left(AuthoringError.plain(ServiceError.NotFound()))
            }
        }
    }

  /** Loads a conversation for continuation — missing/not-owned → `NotFound`; an already-exhausted
   *  per-conversation token budget → `UnprocessableEntity` (kind `BudgetExceeded`) BEFORE any Claude
   *  call — mirrors `DashboardAuthoringService.loadForContinuation` exactly, reusing the SAME
   *  `AuthoringHistoryBudget` ceiling (AC4 — one shared cost/token budget, not a parallel one).
   *
   *  Design.md D3a: a record belonging to the OTHER flow (here, an authoring conversation —
   *  `latestPatchSet.isEmpty`, since `AuthoringConversationTurns` only ever populates
   *  `latestProposal`) is rejected the SAME "not found" shape an owner mismatch already gets —
   *  checked BEFORE the token-budget branch so a cross-flow id never reaches (and never silently
   *  reassigns) this flow's own outcome column via `appendTurn`'s unconditional column overwrite. */
  private def loadForContinuation(id: AuthoringConversationId, user: AuthenticatedUser): Future[Either[AuthoringError, AuthoringConversationRecord]] =
    conversationRepo.findById(id, user).map {
      case None => Left(AuthoringError.plain(ServiceError.NotFound()))
      case Some(record) if record.latestPatchSet.isEmpty =>
        Left(AuthoringError.plain(ServiceError.NotFound()))
      case Some(record) if record.totalTokensUsed >= AuthoringHistoryBudget.DefaultMaxConversationTokens =>
        Left(AuthoringError.kinded(
          AuthoringErrorKind.BudgetExceeded,
          ServiceError.UnprocessableEntity(
            s"This conversation has reached its token budget (${AuthoringHistoryBudget.DefaultMaxConversationTokens} tokens). " +
              "Start a new conversation to continue."
          )
        ))
      case Some(record) => Right(record)
    }

  // ── Shared parse -> validate core (design.md D2) ────────────────────────

  private def parseAndValidate(text: String, user: AuthenticatedUser): Future[Either[String, PatchSet]] =
    RefinementParsing.parsePatchSet(text) match {
      case Left(err) => Future.successful(Left(err))
      case Right(patchSet) =>
        patchSetPreviewService.preview(patchSet, user).map {
          case Right(_)  => Right(patchSet)
          case Left(err) => Left(err.message)
        }
    }

  private def mapClaudeError(err: ClaudeError): AuthoringError = err match {
    case ClaudeError.ApiError(status, body)    => AuthoringError.kinded(AuthoringErrorKind.ModelFailure, ServiceError.BadGateway(s"Claude API error ($status): $body"))
    case ClaudeError.TransportFailure(message) => AuthoringError.kinded(AuthoringErrorKind.ModelFailure, ServiceError.BadGateway(message))
    case ClaudeError.GuardrailExceeded(reason) => AuthoringError.kinded(AuthoringErrorKind.BudgetExceeded, ServiceError.UnprocessableEntity(reason))
  }

  private def totalTokensOf(outcome: AttemptOutcome): Int = outcome.tokens.inputTokens + outcome.tokens.outputTokens

  // ── Claude call + one repair round-trip (design.md D2) ──────────────────

  private def runAttempt(messages: Vector[ClaudeMessage], user: AuthenticatedUser): Future[Either[AuthoringError, AttemptOutcome]] =
    claudeClient.send(ClaudeRequest(messages)).flatMap {
      case Left(err) => Future.successful(Left(mapClaudeError(err)))
      case Right(resp) =>
        parseAndValidate(resp.text, user).flatMap {
          case Right(patchSet) => Future.successful(Right(AttemptOutcome(patchSet, resp.text, resp.usage)))
          case Left(errText)   => runRepair(messages, resp.text, errText, resp.usage, user)
        }
    }

  private def runRepair(
      priorMessages: Vector[ClaudeMessage],
      priorResponseText: String,
      errorText: String,
      tokensSoFar: TokenUsage,
      user: AuthenticatedUser
  ): Future[Either[AuthoringError, AttemptOutcome]] = {
    val repairMessages = priorMessages :+
      ClaudeMessage(ClaudeRole.Assistant, priorResponseText) :+
      ClaudeMessage(ClaudeRole.User, RefinementPrompt.repairMessage(errorText))
    claudeClient.send(ClaudeRequest(repairMessages)).flatMap {
      case Left(err) => Future.successful(Left(mapClaudeError(err)))
      case Right(resp) =>
        val tokens = TokenUsage(tokensSoFar.inputTokens + resp.usage.inputTokens, tokensSoFar.outputTokens + resp.usage.outputTokens)
        parseAndValidate(resp.text, user).map {
          case Right(patchSet) => Right(AttemptOutcome(patchSet, resp.text, tokens))
          case Left(errText2)  => Left(AuthoringError.kinded(AuthoringErrorKind.InvalidProposal, ServiceError.UnprocessableEntity(errText2), tokens))
        }
    }
  }
}
