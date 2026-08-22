package com.helio.services.proposals

import com.helio.services.workspace.WorkspaceContextBudget
import com.helio.services.panels.PanelCapabilityService
import com.helio.services.workspace.WorkspaceContextService
import com.helio.services.ServiceError
import com.helio.ai.{ClaudeClient, ClaudeError, ClaudeMessage, ClaudeRequest, ClaudeRole, ClaudeStreamEvent, TokenUsage}
import com.helio.api.protocols.proposals.{AuthoringContextOptions, AuthoringConversationView, AuthoringStreamEvent, DashboardAuthoringRequest, DashboardAuthoringResponse, DashboardProposal}
import com.helio.api.protocols.panels.PanelCapabilitiesResponse
import com.helio.api.protocols.workspace.{WorkspaceContextDataType, WorkspaceContextResponse}
import com.helio.domain.model.{AuthenticatedUser, AuthoringConversationId, DataTypeId}
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository
import com.helio.infrastructure.persistence.proposals.AuthoringConversationRepository.AuthoringConversationRecord
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source

import java.util.{Map => JMap}
import scala.concurrent.{ExecutionContextExecutor, Future}

/** `POST /api/authoring/dashboard` (HEL-392, extended by HEL-397, and by HEL-401 for error kinds +
 *  telemetry) — turns a user's natural-language goal into a validated [[DashboardProposal]],
 *  grounded in the caller's real workspace, OR continues refining an existing one across turns
 *  (HEL-397 design.md D1/D2). NEVER applies the proposal — applying stays the caller's explicit,
 *  separate action via the existing `POST /api/dashboards/apply-proposal`.
 *
 *  Composes the existing [[WorkspaceContextService]] (HEL-371) + [[PanelCapabilityService]]
 *  (HEL-365) + [[DashboardProposalService]]'s `validate` and depends on [[ClaudeClient]] (HEL-390)
 *  and [[AuthoringConversationRepository]] (HEL-397) as collaborators — this class holds no
 *  persistence logic of its own beyond delegating to [[AuthoringConversationTurns]].
 *
 *  Parse/validate/repair core (unchanged since HEL-392): the model's response text is parsed
 *  defensively ([[DashboardAuthoringParsing]]) into a `DashboardProposal`, then validated via
 *  `DashboardProposalService.validate` — the SAME checks `apply` uses. A parse failure or a
 *  validation rejection triggers exactly ONE re-prompt; a second failure returns
 *  `422 UnprocessableEntity` (kind `InvalidProposal`) — never a third attempt.
 *
 *  Turn 1 (no `conversationId`, design.md D1/D3): behaves exactly as HEL-392 shipped it, but also
 *  persists a new, resumable `authoring_conversations` row as a transparent side effect. Turn N+1
 *  (`conversationId` present): loads that row (RLS-scoped), trims its history to a token budget
 *  (`AuthoringHistoryBudget`, D4), appends the plain follow-up message (no re-embedded grounding),
 *  and re-runs the SAME parse-validate-repair core.
 *
 *  HEL-401 design.md D3: `ec` is `ExecutionContextExecutor` (not the plain `ExecutionContext` every
 *  other service uses) SOLELY so [[AuthoringTelemetry]] can wrap its log call in a
 *  `MdcPropagatingExecutionContext(ec, mdcSnapshot)` — the class-level `ec` this service otherwise
 *  runs its `Future` chains on is captured ONCE at `ApiRoutes` construction and is never the
 *  per-request, trace-carrying EC `TraceContextDirective` swaps in. `mdcSnapshot` is threaded as an
 *  explicit parameter (captured by `DashboardAuthoringRoutes` at the route-evaluation instant, while
 *  the trace id is still set on that thread) into both `author`/`authorStreaming` rather than
 *  assumed ambient — see [[AuthoringTelemetry]]'s own doc comment for the full rationale. */
final class DashboardAuthoringService(
    workspaceContextService: WorkspaceContextService,
    panelCapabilityService: PanelCapabilityService,
    dashboardProposalService: DashboardProposalService,
    claudeClient: ClaudeClient,
    conversationRepo: AuthoringConversationRepository
)(implicit ec: ExecutionContextExecutor) {

  private val turns = new AuthoringConversationTurns(conversationRepo)

  private val EmptyWorkspaceMessage: String =
    "Nothing to build a dashboard from — the workspace has no pipeline-output data types yet. " +
      "Run a pipeline first."

  /** Grounding context assembled once per FIRST-turn authoring call: the workspace snapshot, a
   *  per-DataType panel-capability menu (keyed by `dataTypeId`, HEL-365), and any degrade-not-fail
   *  warnings collected while fetching it. Never re-assembled for a continued turn (design.md D3 —
   *  turn 2+ user messages are plain follow-up text only). */
  private final case class GroundedContext(
      workspace: WorkspaceContextResponse,
      capabilities: Map[String, PanelCapabilitiesResponse],
      warnings: Vector[String]
  )

  /** Outcome of a successful parse-validate(-repair) attempt — carries what BOTH the buffered and
   *  streaming paths need to persist the turn AND emit telemetry: the final response TEXT (never
   *  re-derived from `proposal` — the persisted assistant message must be the model's own output
   *  verbatim), and the REAL accumulated token usage across every Claude call this attempt made
   *  (the first attempt plus the repair round-trip, if one happened) — never the pre-flight
   *  estimate (design.md D5). */
  private final case class AttemptOutcome(proposal: DashboardProposal, warnings: Vector[String], finalResponseText: String, tokens: TokenUsage)

  // ── Public API ──────────────────────────────────────────────────────────

  /** `mdcSnapshot` (HEL-401 design.md D3) defaults to `null` (= "empty MDC", matching
   *  `MdcPropagatingExecutionContext`'s own convention) so every pre-existing caller that predates
   *  telemetry keeps compiling/behaving unchanged — telemetry simply carries no trace id then. */
  def author(
      request: DashboardAuthoringRequest,
      user: AuthenticatedUser,
      mdcSnapshot: JMap[String, String] = null
  ): Future[Either[AuthoringError, DashboardAuthoringResponse]] =
    request.conversationId match {
      case Some(rawId) => continueBuffered(AuthoringConversationId(rawId), request, user, mdcSnapshot)
      case None         => startBuffered(request, user, mdcSnapshot)
    }

  def authorStreaming(
      request: DashboardAuthoringRequest,
      user: AuthenticatedUser,
      mdcSnapshot: JMap[String, String] = null
  ): Source[AuthoringStreamEvent, NotUsed] =
    request.conversationId match {
      case Some(rawId) => continueStreaming(AuthoringConversationId(rawId), request, user, mdcSnapshot)
      case None         => startStreaming(request, user, mdcSnapshot)
    }

  /** `GET /api/authoring/conversations/:id` (design.md D7) — the display-only rehydration read.
   *  Not part of the telemetry funnel (no `author`/`authorStreaming` terminal outcome here). */
  def getConversation(id: AuthoringConversationId, user: AuthenticatedUser): Future[Either[ServiceError, AuthoringConversationView]] =
    conversationRepo.findDisplayById(id, user).map {
      case None => Left(ServiceError.NotFound())
      case Some((displayTurns, latestProposal, latestPatchSet)) =>
        Right(AuthoringConversationView(id.value, displayTurns, latestProposal, latestPatchSet))
    }

  // ── Turn 1 (no conversationId) ─────────────────────────────────────────

  private def startBuffered(
      request: DashboardAuthoringRequest,
      user: AuthenticatedUser,
      mdcSnapshot: JMap[String, String]
  ): Future[Either[AuthoringError, DashboardAuthoringResponse]] =
    assembleGroundedContext(user, request.contextOptions).flatMap {
      case Left(err) => Future.successful(AuthoringOutcomeHelpers.failWithTelemetry(mdcSnapshot, err, claudeClient.modelId, request.goal))
      case Right(ctx) =>
        val userMessage = initialUserMessage(request.goal, ctx)
        runAttempt(Vector(userMessage), user, ctx.warnings).flatMap {
          case Left(err) => Future.successful(AuthoringOutcomeHelpers.failWithTelemetry(mdcSnapshot, err, claudeClient.modelId, request.goal))
          case Right(outcome) =>
            turns.persistNew(user, request.goal, userMessage, outcome.finalResponseText, outcome.proposal, totalTokensOf(outcome))
              .map(conv =>
                Right(AuthoringOutcomeHelpers.succeedWithTelemetry(
                  mdcSnapshot, outcome.proposal, outcome.warnings, outcome.tokens, conv.id.value, claudeClient.modelId, request.goal
                ))
              )
        }
    }

  private def startStreaming(request: DashboardAuthoringRequest, user: AuthenticatedUser, mdcSnapshot: JMap[String, String]): Source[AuthoringStreamEvent, NotUsed] =
    Source
      .futureSource(assembleGroundedContext(user, request.contextOptions).map {
        case Left(err) => Source.single[AuthoringStreamEvent](AuthoringOutcomeHelpers.failStreamEvent(mdcSnapshot, err, claudeClient.modelId, request.goal))
        case Right(ctx) =>
          val userMessage = initialUserMessage(request.goal, ctx)
          val persistTurn: AttemptOutcome => Future[Either[ServiceError, String]] = outcome =>
            turns.persistNew(user, request.goal, userMessage, outcome.finalResponseText, outcome.proposal, totalTokensOf(outcome))
              .map(conv => Right(conv.id.value))
          streamAttempt(Vector(userMessage), ctx.warnings, user, persistTurn, request.goal, mdcSnapshot)
      })
      .mapMaterializedValue(_ => NotUsed)

  private def initialUserMessage(goal: String, ctx: GroundedContext): ClaudeMessage =
    ClaudeMessage(
      ClaudeRole.User,
      DashboardAuthoringPrompt.userMessage(goal, pipelineOutputTypes(ctx.workspace), ctx.capabilities, ctx.workspace.agentContext)
    )

  // ── Continued turns (conversationId present, design.md D2) ────────────

  private def continueBuffered(
      id: AuthoringConversationId,
      request: DashboardAuthoringRequest,
      user: AuthenticatedUser,
      mdcSnapshot: JMap[String, String]
  ): Future[Either[AuthoringError, DashboardAuthoringResponse]] =
    loadForContinuation(id, user).flatMap {
      case Left(err) => Future.successful(AuthoringOutcomeHelpers.failWithTelemetry(mdcSnapshot, err, claudeClient.modelId, request.goal))
      case Right(prior) =>
        val userMessage = ClaudeMessage(ClaudeRole.User, request.goal)
        val messages     = continuationMessages(prior, userMessage)
        // No new grounding-assembly warnings on a continued turn — grounding is only ever
        // (re-)assembled on turn 1 (design.md D3).
        runAttempt(messages, user, Vector.empty).flatMap {
          case Left(err) => Future.successful(AuthoringOutcomeHelpers.failWithTelemetry(mdcSnapshot, err, claudeClient.modelId, request.goal))
          case Right(outcome) =>
            turns.persistContinuation(prior, user, request.goal, userMessage, outcome.finalResponseText, outcome.proposal, totalTokensOf(outcome)).map {
              case Some(conv) =>
                Right(AuthoringOutcomeHelpers.succeedWithTelemetry(
                  mdcSnapshot, outcome.proposal, outcome.warnings, outcome.tokens, conv.id.value, claudeClient.modelId, request.goal
                ))
              case None =>
                AuthoringOutcomeHelpers.failWithTelemetry(mdcSnapshot, AuthoringError.plain(ServiceError.NotFound()), claudeClient.modelId, request.goal)
            }
        }
    }

  private def continueStreaming(
      id: AuthoringConversationId,
      request: DashboardAuthoringRequest,
      user: AuthenticatedUser,
      mdcSnapshot: JMap[String, String]
  ): Source[AuthoringStreamEvent, NotUsed] =
    Source
      .futureSource(loadForContinuation(id, user).map {
        case Left(err) => Source.single[AuthoringStreamEvent](AuthoringOutcomeHelpers.failStreamEvent(mdcSnapshot, err, claudeClient.modelId, request.goal))
        case Right(prior) =>
          val userMessage = ClaudeMessage(ClaudeRole.User, request.goal)
          val messages     = continuationMessages(prior, userMessage)
          val persistTurn: AttemptOutcome => Future[Either[ServiceError, String]] = outcome =>
            turns.persistContinuation(prior, user, request.goal, userMessage, outcome.finalResponseText, outcome.proposal, totalTokensOf(outcome)).map {
              case Some(conv) => Right(conv.id.value)
              case None       => Left(ServiceError.NotFound())
            }
          streamAttempt(messages, Vector.empty, user, persistTurn, request.goal, mdcSnapshot)
      })
      .mapMaterializedValue(_ => NotUsed)

  private def continuationMessages(prior: AuthoringConversationRecord, userMessage: ClaudeMessage): Vector[ClaudeMessage] =
    AuthoringHistoryBudget.trim(prior.apiHistory, AuthoringHistoryBudget.DefaultMaxHistoryTokens) :+ userMessage

  /** Loads a conversation for continuation — missing/not-owned → `NotFound` (design.md D2, same
   *  owner-or-404 treatment `MetricRepository` uses; no `AuthoringErrorKind` — outside the ticket's
   *  four defined categories, design.md D1); an already-exhausted per-conversation token budget →
   *  `UnprocessableEntity` (kind `BudgetExceeded`, design.md D2) BEFORE any Claude call.
   *
   *  HEL-411 design.md D3a: a record belonging to the OTHER flow (here, a refinement conversation —
   *  `latestProposal.isEmpty`, since `RefinementConversationTurns` only ever populates
   *  `latestPatchSet`) is rejected the SAME "not found" shape an owner mismatch already gets —
   *  checked BEFORE the token-budget branch so a cross-flow id never reaches (and never silently
   *  reassigns) this flow's own outcome column via `appendTurn`'s unconditional column overwrite. */
  private def loadForContinuation(id: AuthoringConversationId, user: AuthenticatedUser): Future[Either[AuthoringError, AuthoringConversationRecord]] =
    conversationRepo.findById(id, user).map {
      case None => Left(AuthoringError.plain(ServiceError.NotFound()))
      case Some(record) if record.latestProposal.isEmpty =>
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

  // ── Grounding context (unchanged since HEL-392, EmptyWorkspace kind added HEL-401) ────────────

  private def assembleGroundedContext(
      user: AuthenticatedUser,
      contextOptions: Option[AuthoringContextOptions]
  ): Future[Either[AuthoringError, GroundedContext]] = {
    val budgetBytes = contextOptions.flatMap(_.budgetBytes).getOrElse(WorkspaceContextBudget.DefaultBudgetBytes)
    workspaceContextService.assemble(user, budgetBytes).flatMap { workspace =>
      val outputTypes = pipelineOutputTypes(workspace)
      if (outputTypes.isEmpty)
        // design.md D6 (HEL-392): short-circuit BEFORE any ClaudeClient call.
        Future.successful(Left(AuthoringError.kinded(AuthoringErrorKind.EmptyWorkspace, ServiceError.UnprocessableEntity(EmptyWorkspaceMessage))))
      else
        Future.traverse(outputTypes)(dt => fetchCapability(dt.id, user)).map { results =>
          Right(GroundedContext(
            workspace    = workspace,
            capabilities = results.collect { case Right(pair) => pair }.toMap,
            warnings     = results.collect { case Left(warning) => warning }
          ))
        }
    }
  }

  private def pipelineOutputTypes(workspace: WorkspaceContextResponse): Vector[WorkspaceContextDataType] =
    workspace.dataTypes.filter(_.pipelineOutput)

  /** One per-DataType capability fetch. A failure degrades to a warning for THAT type only —
   *  mirrors `WorkspaceContextService.buildPipeline`'s own per-item degrade-not-fail precedent;
   *  never fails the whole grounding assembly. */
  private def fetchCapability(dataTypeId: String, user: AuthenticatedUser): Future[Either[String, (String, PanelCapabilitiesResponse)]] =
    panelCapabilityService
      .getCapabilities(DataTypeId(dataTypeId), user)
      .map {
        case Right(capabilities) => Right(dataTypeId -> capabilities)
        case Left(err)           => Left(degradeMessage(dataTypeId, err.message))
      }
      .recover { case ex => Left(degradeMessage(dataTypeId, Option(ex.getMessage).getOrElse(ex.getClass.getName))) }

  private def degradeMessage(dataTypeId: String, reason: String): String =
    s"Could not load panel capabilities for data type $dataTypeId: $reason"

  // ── Shared parse -> validate core (unchanged since HEL-392) ────────────

  private def parseAndValidate(text: String, user: AuthenticatedUser): Future[Either[String, DashboardProposal]] =
    DashboardAuthoringParsing.parseProposal(text) match {
      case Left(err) => Future.successful(Left(err))
      case Right(proposal) =>
        dashboardProposalService.validate(proposal, user).map {
          case Right(_)  => Right(proposal)
          case Left(err) => Left(err.message)
        }
    }

  private def mapClaudeError(err: ClaudeError): AuthoringError = err match {
    case ClaudeError.ApiError(status, body)    => AuthoringError.kinded(AuthoringErrorKind.ModelFailure, ServiceError.BadGateway(s"Claude API error ($status): $body"))
    case ClaudeError.TransportFailure(message) => AuthoringError.kinded(AuthoringErrorKind.ModelFailure, ServiceError.BadGateway(message))
    case ClaudeError.GuardrailExceeded(reason) => AuthoringError.kinded(AuthoringErrorKind.BudgetExceeded, ServiceError.UnprocessableEntity(reason))
  }

  // ── Telemetry (HEL-401 design.md D3/D4) — the terminal-outcome helpers themselves live in
  //    AuthoringOutcomeHelpers (tasks.md 6.1); this class only threads modelId/goal/mdcSnapshot in. ──

  private def totalTokensOf(outcome: AttemptOutcome): Int = outcome.tokens.inputTokens + outcome.tokens.outputTokens

  // ── Buffered path ───────────────────────────────────────────────────────

  private def runAttempt(
      messages: Vector[ClaudeMessage],
      user: AuthenticatedUser,
      warnings: Vector[String]
  ): Future[Either[AuthoringError, AttemptOutcome]] =
    claudeClient.send(ClaudeRequest(messages)).flatMap {
      case Left(err) => Future.successful(Left(mapClaudeError(err)))
      case Right(resp) =>
        parseAndValidate(resp.text, user).flatMap {
          case Right(proposal) => Future.successful(Right(AttemptOutcome(proposal, warnings, resp.text, resp.usage)))
          case Left(errText)   => runRepair(messages, resp.text, errText, resp.usage, user, warnings)
        }
    }

  private def runRepair(
      priorMessages: Vector[ClaudeMessage],
      priorResponseText: String,
      errorText: String,
      tokensSoFar: TokenUsage,
      user: AuthenticatedUser,
      warnings: Vector[String]
  ): Future[Either[AuthoringError, AttemptOutcome]] = {
    val repairMessages = priorMessages :+
      ClaudeMessage(ClaudeRole.Assistant, priorResponseText) :+
      ClaudeMessage(ClaudeRole.User, DashboardAuthoringPrompt.repairMessage(errorText))
    claudeClient.send(ClaudeRequest(repairMessages)).flatMap {
      case Left(err) => Future.successful(Left(mapClaudeError(err)))
      case Right(resp) =>
        val tokens = TokenUsage(tokensSoFar.inputTokens + resp.usage.inputTokens, tokensSoFar.outputTokens + resp.usage.outputTokens)
        parseAndValidate(resp.text, user).map {
          case Right(proposal) => Right(AttemptOutcome(proposal, warnings, resp.text, tokens))
          case Left(errText2)  => Left(AuthoringError.kinded(AuthoringErrorKind.InvalidProposal, ServiceError.UnprocessableEntity(errText2), tokens))
        }
    }
  }

  // ── Streaming path (unchanged shape since HEL-392; now persists + threads conversationId,
  //    plus HEL-401's goal/mdcSnapshot for telemetry) ────────────────────────────────────────

  private def streamAttempt(
      initialMessages: Vector[ClaudeMessage],
      warnings: Vector[String],
      user: AuthenticatedUser,
      persistTurn: AttemptOutcome => Future[Either[ServiceError, String]],
      goal: String,
      mdcSnapshot: JMap[String, String]
  ): Source[AuthoringStreamEvent, NotUsed] = {
    val buffer = new StringBuilder
    var inputTokensSoFar  = 0
    var outputTokensSoFar = 0
    claudeClient.stream(ClaudeRequest(initialMessages)).flatMapConcat {
      case ClaudeStreamEvent.TextDelta(text) =>
        buffer.append(text)
        Source.single[AuthoringStreamEvent](AuthoringStreamEvent.Progress(text))
      case ClaudeStreamEvent.UsageDelta(usage) =>
        // Best-effort real usage (design.md D5) — `message_start` carries no usage in this
        // client's modeled ClaudeStreamEvent (see ClaudeModels.scala), so `inputTokens` is
        // typically 0 here; still strictly more accurate than the pre-flight estimate.
        inputTokensSoFar += usage.inputTokens
        outputTokensSoFar += usage.outputTokens
        Source.empty[AuthoringStreamEvent]
      case ClaudeStreamEvent.Error(err) =>
        Source.single[AuthoringStreamEvent](AuthoringOutcomeHelpers.failStreamEvent(mdcSnapshot, mapClaudeError(err), claudeClient.modelId, goal))
      case ClaudeStreamEvent.MessageStop =>
        Source
          .futureSource(completeStream(initialMessages, buffer.toString, TokenUsage(inputTokensSoFar, outputTokensSoFar), user, warnings, persistTurn, goal, mdcSnapshot))
          .mapMaterializedValue(_ => NotUsed)
      case _ =>
        Source.empty[AuthoringStreamEvent]
    }
  }

  private def completeStream(
      initialMessages: Vector[ClaudeMessage],
      fullText: String,
      tokensSoFar: TokenUsage,
      user: AuthenticatedUser,
      warnings: Vector[String],
      persistTurn: AttemptOutcome => Future[Either[ServiceError, String]],
      goal: String,
      mdcSnapshot: JMap[String, String]
  ): Future[Source[AuthoringStreamEvent, NotUsed]] =
    parseAndValidate(fullText, user).flatMap {
      case Right(proposal) =>
        val outcome = AttemptOutcome(proposal, warnings, fullText, tokensSoFar)
        persistTurn(outcome).map {
          case Right(conversationId) =>
            Source.single[AuthoringStreamEvent](AuthoringOutcomeHelpers.succeedStreamEvent(
              mdcSnapshot, outcome.proposal, outcome.warnings, outcome.tokens, conversationId, claudeClient.modelId, goal
            ))
          case Left(serviceErr) =>
            Source.single[AuthoringStreamEvent](AuthoringOutcomeHelpers.failStreamEvent(mdcSnapshot, AuthoringError.plain(serviceErr), claudeClient.modelId, goal))
        }
      case Left(errText) =>
        // A Status("repairing") event BEFORE the buffered (not re-streamed) repair attempt — the
        // client already saw the first attempt's full text as progress.
        Future.successful(
          Source.single[AuthoringStreamEvent](AuthoringStreamEvent.Status("repairing")) ++
            Source.future(runStreamingRepair(initialMessages, fullText, errText, tokensSoFar, user, warnings, persistTurn, goal, mdcSnapshot))
        )
    }

  private def runStreamingRepair(
      initialMessages: Vector[ClaudeMessage],
      priorResponseText: String,
      errorText: String,
      tokensSoFar: TokenUsage,
      user: AuthenticatedUser,
      warnings: Vector[String],
      persistTurn: AttemptOutcome => Future[Either[ServiceError, String]],
      goal: String,
      mdcSnapshot: JMap[String, String]
  ): Future[AuthoringStreamEvent] = {
    val repairMessages = initialMessages :+
      ClaudeMessage(ClaudeRole.Assistant, priorResponseText) :+
      ClaudeMessage(ClaudeRole.User, DashboardAuthoringPrompt.repairMessage(errorText))
    claudeClient.send(ClaudeRequest(repairMessages)).flatMap {
      case Left(err) => Future.successful(AuthoringOutcomeHelpers.failStreamEvent(mdcSnapshot, mapClaudeError(err), claudeClient.modelId, goal))
      case Right(resp) =>
        val tokens = TokenUsage(tokensSoFar.inputTokens + resp.usage.inputTokens, tokensSoFar.outputTokens + resp.usage.outputTokens)
        parseAndValidate(resp.text, user).flatMap {
          case Right(proposal) =>
            val outcome = AttemptOutcome(proposal, warnings, resp.text, tokens)
            persistTurn(outcome).map {
              case Right(conversationId) =>
                AuthoringOutcomeHelpers.succeedStreamEvent(
                  mdcSnapshot, outcome.proposal, outcome.warnings, outcome.tokens, conversationId, claudeClient.modelId, goal
                )
              case Left(serviceErr) =>
                AuthoringOutcomeHelpers.failStreamEvent(mdcSnapshot, AuthoringError.plain(serviceErr), claudeClient.modelId, goal)
            }
          case Left(errText2) =>
            Future.successful(AuthoringOutcomeHelpers.failStreamEvent(
              mdcSnapshot, AuthoringError.kinded(AuthoringErrorKind.InvalidProposal, ServiceError.UnprocessableEntity(errText2), tokens), claudeClient.modelId, goal
            ))
        }
    }
  }
}
