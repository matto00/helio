package com.helio.services

import com.helio.ai.ClaudeToolExecutor
import com.helio.api.protocols.{
  AssistantProposal,
  CombinedProposal,
  CombinedProposalProtocol,
  DashboardProposal,
  PanelCapabilityProtocol,
  PatchSet,
  PatchSetPreviewProtocol,
  PatchSetProtocol,
  PipelineProposal,
  WorkspaceResourceDetail,
  WorkspaceResourceSearchProtocol
}
import com.helio.domain.{AuthenticatedUser, DataTypeId, WorkspaceResourceType}
import spray.json._

import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** `ClaudeToolExecutor` for HEL-659's top-level assistant (HEL-662 tasks.md section 4) — dispatches
 *  each of the 6 tools in `AssistantProtocol.assistantTools` to the collaborator that already
 *  implements it. Constructed FRESH per `AssistantService.converse` call (design.md D6) — never
 *  shared/reused across turns, so `capturedProposal` below carries no cross-request state leakage.
 *
 *  Hard Boundary (non-negotiable): every `propose_*` case below calls a NON-MUTATING `validate`/
 *  `preview` method — never `apply`. There is no code path in this class that can reach a mutating
 *  service method. */
final class AssistantToolExecutor(
    workspaceSearchService: WorkspaceSearchService,
    panelCapabilityService: PanelCapabilityService,
    dashboardProposalService: DashboardProposalService,
    pipelineProposalService: PipelineProposalService,
    combinedProposalService: CombinedProposalService,
    patchSetPreviewService: PatchSetPreviewService,
    user: AuthenticatedUser
) extends ClaudeToolExecutor
    with WorkspaceResourceSearchProtocol
    with PanelCapabilityProtocol
    // CombinedProposalProtocol already extends PipelineProposalProtocol with DashboardProposalProtocol
    // (JsonProtocols.scala's own dependency notes) — no separate mix-in needed for either.
    with CombinedProposalProtocol
    with PatchSetProtocol
    with PatchSetPreviewProtocol {

  /** One-shot side channel (design.md D6): overwritten only on a `propose_*` call's validation
   *  SUCCESS, never on failure — so a later successful retry after an earlier rejected attempt
   *  correctly wins, and a rejected-then-abandoned attempt never lingers. Read once by
   *  `AssistantService.converse` after `sendWithTools` returns. `AtomicReference` (not a plain
   *  `var`): `ClaudeClient.sendWithTools` executes every `tool_use` block within one hop
   *  concurrently via `Future.traverse` (design.md "Same-hop concurrency"); a plain `var` write is
   *  not guaranteed visible/safe across those concurrent `Future` callbacks. */
  private val capturedProposal: AtomicReference[Option[AssistantProposal]] = new AtomicReference(None)

  def proposal: Option[AssistantProposal] = capturedProposal.get()

  override def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] =
    name match {
      case "find"              => executeFind(input)
      case "get_resource"      => executeGetResource(input)
      case "propose_dashboard" => executeProposeDashboard(input)
      case "propose_pipeline"  => executeProposePipeline(input)
      case "propose_combined"  => executeProposeCombined(input)
      case "propose_patch_set" => executeProposePatchSet(input)
      case other                => Future.successful(Left(s"Unknown tool: $other"))
    }

  // ── find / get_resource (HEL-661 dispatch, design.md D4) ────────────────────────────────────

  private def executeFind(input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
    val obj   = input.asJsObject
    val query = obj.fields.get("query").collect { case JsString(s) => s }.getOrElse("")
    parseResourceTypes(obj.fields.get("resourceTypes")) match {
      case Left(err)    => Future.successful(Left(err))
      case Right(types) => workspaceSearchService.find(user, query, types).map(results => Right(results.toJson.compactPrint))
    }
  }

  private def parseResourceTypes(raw: Option[JsValue]): Either[String, Option[Set[WorkspaceResourceType]]] = raw match {
    case None => Right(None)
    case Some(JsArray(items)) =>
      val parsed = items.map {
        case JsString(s) => WorkspaceResourceType.fromString(s).toRight(s"find: unrecognized resourceTypes value '$s'")
        case other         => Left(s"find: resourceTypes items must be strings, got $other")
      }
      parsed.collectFirst { case Left(err) => err } match {
        case Some(err) => Left(err)
        case None       => Right(Some(parsed.collect { case Right(t) => t }.toSet))
      }
    case Some(other) => Left(s"find: resourceTypes must be an array, got $other")
  }

  private def executeGetResource(input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
    val obj     = input.asJsObject
    val idOpt   = obj.fields.get("id").collect { case JsString(s) if s.nonEmpty => s }
    val typeOpt = obj.fields.get("type").collect { case JsString(s) => s }
    (idOpt, typeOpt.flatMap(WorkspaceResourceType.fromString)) match {
      case (None, _) =>
        Future.successful(Left("get_resource requires a non-empty 'id'"))
      case (_, None) =>
        Future.successful(Left(s"get_resource: unrecognized or missing 'type': ${typeOpt.getOrElse("<absent>")}"))
      case (Some(id), Some(resourceType)) =>
        workspaceSearchService.getResource(user, id, resourceType).flatMap {
          case Left(err)                                     => Future.successful(Left(err.message))
          case Right(detail: WorkspaceResourceDetail.DataTypeDetail) => withCapabilities(detail)
          case Right(detail)                                  => Future.successful(Right(detail.toJson.compactPrint))
        }
    }
  }

  /** Design.md D3a: nests `PanelCapabilitiesResponse` under a DISTINCT top-level key alongside (not
   *  flat-unioned with) `WorkspaceResourceDetail` — both wire shapes use the literal key `"columns"`
   *  for materially different content (`WorkspaceContextDataType.columns` carries `semanticRole`;
   *  `PanelCapabilitiesResponse.columns` does not), so a flat `JsObject` merge would silently drop
   *  one via `Map ++` right-wins semantics. A capability-fetch failure degrades to the DataType
   *  detail alone (mirrors `DashboardAuthoringService.fetchCapability`'s own per-item degrade — this
   *  read failing doesn't fail the whole `get_resource` call). */
  private def withCapabilities(detail: WorkspaceResourceDetail.DataTypeDetail)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
    // Widened to the sealed-trait static type: `workspaceResourceDetailFormat` is only defined for
    // `WorkspaceResourceDetail`, not the narrowed `DataTypeDetail` case-class type `.toJson`'s
    // implicit search would otherwise look for.
    val detailJson: JsValue = (detail: WorkspaceResourceDetail).toJson
    panelCapabilityService.getCapabilities(DataTypeId(detail.value.id), user).map {
      case Right(capabilities) =>
        Right(JsObject("detail" -> detailJson, "panelCapabilities" -> capabilities.toJson).compactPrint)
      case Left(_) =>
        Right(detailJson.compactPrint)
    }
  }

  // ── propose_* (design.md D5/D6, Hard Boundary) ──────────────────────────────────────────────

  private def executeProposeDashboard(input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] =
    decode[DashboardProposal](input, "propose_dashboard") match {
      case Left(err) => Future.successful(Left(err))
      case Right(proposal) =>
        dashboardProposalService.validate(proposal, user).map {
          case Left(err) => Left(err.message)
          case Right(_) =>
            capturedProposal.set(Some(AssistantProposal.Dashboard(proposal)))
            Right(proposal.toJson.compactPrint)
        }
    }

  private def executeProposePipeline(input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] =
    decode[PipelineProposal](input, "propose_pipeline") match {
      case Left(err) => Future.successful(Left(err))
      case Right(proposal) =>
        pipelineProposalService.validate(proposal, user).map {
          case Left(err) => Left(err.message)
          case Right(_) =>
            capturedProposal.set(Some(AssistantProposal.Pipeline(proposal)))
            Right(proposal.toJson.compactPrint)
        }
    }

  private def executeProposeCombined(input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] =
    decode[CombinedProposal](input, "propose_combined") match {
      case Left(err) => Future.successful(Left(err))
      case Right(proposal) =>
        combinedProposalService.validate(proposal, user).map {
          case Left(err) => Left(err.message)
          case Right(_) =>
            capturedProposal.set(Some(AssistantProposal.Combined(proposal)))
            Right(proposal.toJson.compactPrint)
        }
    }

  private def executeProposePatchSet(input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] =
    decode[PatchSet](input, "propose_patch_set") match {
      case Left(err) => Future.successful(Left(err))
      case Right(patchSet) =>
        patchSetPreviewService.preview(patchSet, user).map {
          case Left(err) => Left(err.message)
          case Right(preview) =>
            capturedProposal.set(Some(AssistantProposal.Patch(patchSet, preview)))
            Right(preview.toJson.compactPrint)
        }
    }

  /** `input.convertTo[T]` either succeeds or throws `DeserializationException` (design.md D5 —
   *  `tool_use.input` arrives as already-structured JSON per Claude's own function-calling
   *  contract, unlike `DashboardAuthoringParsing`'s free-text repair loop) — caught here and turned
   *  into a `Left` message, never an uncaught exception. */
  private def decode[T: JsonReader](input: JsValue, toolName: String): Either[String, T] =
    Try(input.convertTo[T]) match {
      case Success(value)                       => Right(value)
      case Failure(e: DeserializationException) => Left(s"$toolName: invalid input — ${e.getMessage}")
      case Failure(e)                            => Left(s"$toolName: invalid input — ${Option(e.getMessage).getOrElse(e.getClass.getName)}")
    }
}
