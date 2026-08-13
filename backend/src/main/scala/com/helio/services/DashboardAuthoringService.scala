package com.helio.services

import com.helio.ai.{ClaudeClient, ClaudeError, ClaudeMessage, ClaudeRequest, ClaudeRole, ClaudeStreamEvent}
import com.helio.api.protocols.{
  AuthoringContextOptions,
  AuthoringStreamEvent,
  DashboardAuthoringRequest,
  DashboardAuthoringResponse,
  DashboardProposal,
  PanelCapabilitiesResponse,
  WorkspaceContextDataType,
  WorkspaceContextResponse
}
import com.helio.domain.{AuthenticatedUser, DataTypeId}
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source

import scala.concurrent.{ExecutionContext, Future}

/** `POST /api/authoring/dashboard` (HEL-392) — turns a user's natural-language goal into a
 *  validated [[DashboardProposal]], grounded in the caller's real workspace. NEVER applies the
 *  proposal — applying stays the caller's explicit, separate action via the existing
 *  `POST /api/dashboards/apply-proposal`.
 *
 *  Composes the existing [[WorkspaceContextService]] (HEL-371) + [[PanelCapabilityService]]
 *  (HEL-365) + [[DashboardProposalService]] (its new `validate`, this ticket's design.md D1) and
 *  depends on [[ClaudeClient]] (HEL-390) as a collaborator (design.md D2) — this class holds no
 *  persistence logic and never touches the database directly.
 *
 *  Parse/validate/repair core (design.md D4/D5): the model's response text is parsed defensively
 *  ([[DashboardAuthoringParsing]]) into a `DashboardProposal`, then validated via
 *  `DashboardProposalService.validate` — the SAME checks `apply` uses. A parse failure or a
 *  validation rejection triggers exactly ONE re-prompt (the model's own prior output plus the
 *  error, fed back via [[DashboardAuthoringPrompt.repairMessage]]); a second failure returns
 *  `422 UnprocessableEntity` — never a third attempt. */
final class DashboardAuthoringService(
    workspaceContextService: WorkspaceContextService,
    panelCapabilityService: PanelCapabilityService,
    dashboardProposalService: DashboardProposalService,
    claudeClient: ClaudeClient
)(implicit ec: ExecutionContext) {

  private val EmptyWorkspaceMessage: String =
    "Nothing to build a dashboard from — the workspace has no pipeline-output data types yet. " +
      "Run a pipeline first."

  /** Grounding context assembled once per authoring call: the workspace snapshot, a per-DataType
   *  panel-capability menu (keyed by `dataTypeId`, HEL-365), and any degrade-not-fail warnings
   *  collected while fetching it (design.md D3). */
  private final case class GroundedContext(
      workspace: WorkspaceContextResponse,
      capabilities: Map[String, PanelCapabilitiesResponse],
      warnings: Vector[String]
  )

  // ── Public API ──────────────────────────────────────────────────────────

  def author(
      request: DashboardAuthoringRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, DashboardAuthoringResponse]] =
    assembleGroundedContext(user, request.contextOptions).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(ctx) =>
        val initialMessages = Vector(ClaudeMessage(ClaudeRole.User, DashboardAuthoringPrompt.userMessage(request.goal, pipelineOutputTypes(ctx.workspace), ctx.capabilities)))
        runAttempt(initialMessages, user, ctx.warnings)
    }

  def authorStreaming(request: DashboardAuthoringRequest, user: AuthenticatedUser): Source[AuthoringStreamEvent, NotUsed] =
    Source
      .futureSource(assembleGroundedContext(user, request.contextOptions).map {
        case Left(err) => Source.single[AuthoringStreamEvent](AuthoringStreamEvent.Error(err.message))
        case Right(ctx) =>
          val initialMessages = Vector(ClaudeMessage(ClaudeRole.User, DashboardAuthoringPrompt.userMessage(request.goal, pipelineOutputTypes(ctx.workspace), ctx.capabilities)))
          streamAttempt(initialMessages, user, ctx.warnings)
      })
      .mapMaterializedValue(_ => NotUsed)

  // ── Grounding context (design.md D3/D6) ────────────────────────────────

  private def assembleGroundedContext(
      user: AuthenticatedUser,
      contextOptions: Option[AuthoringContextOptions]
  ): Future[Either[ServiceError, GroundedContext]] = {
    val budgetBytes = contextOptions.flatMap(_.budgetBytes).getOrElse(WorkspaceContextBudget.DefaultBudgetBytes)
    workspaceContextService.assemble(user, budgetBytes).flatMap { workspace =>
      val outputTypes = pipelineOutputTypes(workspace)
      if (outputTypes.isEmpty)
        // design.md D6: short-circuit BEFORE any ClaudeClient call.
        Future.successful(Left(ServiceError.UnprocessableEntity(EmptyWorkspaceMessage)))
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

  /** One per-DataType capability fetch. A failure degrades to a warning for THAT type only
   *  (design.md D3) — mirrors `WorkspaceContextService.buildPipeline`'s own per-item
   *  degrade-not-fail precedent; never fails the whole grounding assembly. */
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

  // ── Shared parse -> validate core ──────────────────────────────────────

  private def parseAndValidate(text: String, user: AuthenticatedUser): Future[Either[String, DashboardProposal]] =
    DashboardAuthoringParsing.parseProposal(text) match {
      case Left(err) => Future.successful(Left(err))
      case Right(proposal) =>
        dashboardProposalService.validate(proposal, user).map {
          case Right(_)  => Right(proposal)
          case Left(err) => Left(err.message)
        }
    }

  private def mapClaudeError(err: ClaudeError): ServiceError = err match {
    case ClaudeError.ApiError(status, body)    => ServiceError.BadGateway(s"Claude API error ($status): $body")
    case ClaudeError.TransportFailure(message) => ServiceError.BadGateway(message)
    case ClaudeError.GuardrailExceeded(reason) => ServiceError.UnprocessableEntity(reason)
  }

  // ── Buffered path ───────────────────────────────────────────────────────

  private def runAttempt(
      messages: Vector[ClaudeMessage],
      user: AuthenticatedUser,
      warnings: Vector[String]
  ): Future[Either[ServiceError, DashboardAuthoringResponse]] =
    claudeClient.send(ClaudeRequest(messages)).flatMap {
      case Left(err) => Future.successful(Left(mapClaudeError(err)))
      case Right(resp) =>
        parseAndValidate(resp.text, user).flatMap {
          case Right(proposal) => Future.successful(Right(DashboardAuthoringResponse(proposal, warnings)))
          case Left(errText)   => runRepair(messages, resp.text, errText, user, warnings)
        }
    }

  private def runRepair(
      priorMessages: Vector[ClaudeMessage],
      priorResponseText: String,
      errorText: String,
      user: AuthenticatedUser,
      warnings: Vector[String]
  ): Future[Either[ServiceError, DashboardAuthoringResponse]] = {
    val repairMessages = priorMessages :+
      ClaudeMessage(ClaudeRole.Assistant, priorResponseText) :+
      ClaudeMessage(ClaudeRole.User, DashboardAuthoringPrompt.repairMessage(errorText))
    claudeClient.send(ClaudeRequest(repairMessages)).flatMap {
      case Left(err) => Future.successful(Left(mapClaudeError(err)))
      case Right(resp) =>
        parseAndValidate(resp.text, user).map {
          case Right(proposal) => Right(DashboardAuthoringResponse(proposal, warnings))
          case Left(errText2)  => Left(ServiceError.UnprocessableEntity(errText2))
        }
    }
  }

  // ── Streaming path (design.md D7) ──────────────────────────────────────

  private def streamAttempt(
      initialMessages: Vector[ClaudeMessage],
      user: AuthenticatedUser,
      warnings: Vector[String]
  ): Source[AuthoringStreamEvent, NotUsed] = {
    val buffer = new StringBuilder
    claudeClient.stream(ClaudeRequest(initialMessages)).flatMapConcat {
      case ClaudeStreamEvent.TextDelta(text) =>
        buffer.append(text)
        Source.single[AuthoringStreamEvent](AuthoringStreamEvent.Progress(text))
      case ClaudeStreamEvent.Error(err) =>
        Source.single[AuthoringStreamEvent](AuthoringStreamEvent.Error(mapClaudeError(err).message))
      case ClaudeStreamEvent.MessageStop =>
        Source.futureSource(completeStream(initialMessages, buffer.toString, user, warnings)).mapMaterializedValue(_ => NotUsed)
      case _ =>
        Source.empty[AuthoringStreamEvent]
    }
  }

  private def completeStream(
      initialMessages: Vector[ClaudeMessage],
      fullText: String,
      user: AuthenticatedUser,
      warnings: Vector[String]
  ): Future[Source[AuthoringStreamEvent, NotUsed]] =
    parseAndValidate(fullText, user).map {
      case Right(proposal) =>
        Source.single[AuthoringStreamEvent](AuthoringStreamEvent.Result(proposal, warnings))
      case Left(errText) =>
        // design.md D7: a Status("repairing") event BEFORE the buffered (not re-streamed) repair
        // attempt — the client already saw the first attempt's full text as progress.
        Source.single[AuthoringStreamEvent](AuthoringStreamEvent.Status("repairing")) ++
          Source.future(runStreamingRepair(initialMessages, fullText, errText, user, warnings))
    }

  private def runStreamingRepair(
      initialMessages: Vector[ClaudeMessage],
      priorResponseText: String,
      errorText: String,
      user: AuthenticatedUser,
      warnings: Vector[String]
  ): Future[AuthoringStreamEvent] = {
    val repairMessages = initialMessages :+
      ClaudeMessage(ClaudeRole.Assistant, priorResponseText) :+
      ClaudeMessage(ClaudeRole.User, DashboardAuthoringPrompt.repairMessage(errorText))
    claudeClient.send(ClaudeRequest(repairMessages)).flatMap {
      case Left(err) => Future.successful(AuthoringStreamEvent.Error(mapClaudeError(err).message))
      case Right(resp) =>
        parseAndValidate(resp.text, user).map {
          case Right(proposal) => AuthoringStreamEvent.Result(proposal, warnings)
          case Left(errText2)  => AuthoringStreamEvent.Error(ServiceError.UnprocessableEntity(errText2).message)
        }
    }
  }
}
