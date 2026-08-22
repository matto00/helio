package com.helio.services.assistant

import com.helio.services.panels.PanelCapabilityService
import com.helio.services.patchsets.PatchSetPreviewService
import com.helio.services.pipelines.PipelineProposalService
import com.helio.services.proposals.{CombinedProposalService, DashboardProposalService}
import com.helio.services.sources.SourceService
import com.helio.services.workspace.WorkspaceSearchService
import com.helio.ai.ClaudeToolExecutor
import com.helio.api.protocols.assistant.AssistantProposal
import com.helio.api.protocols.proposals.{CombinedProposal, CombinedProposalProtocol, DashboardProposal}
import com.helio.api.protocols.panels.PanelCapabilityProtocol
import com.helio.api.protocols.patchsets.{PatchSet, PatchSetPreviewProtocol, PatchSetProtocol}
import com.helio.api.protocols.pipelines.{PipelineProposal, PipelineProposalSource}
import com.helio.api.protocols.sources.{RestApiConfigPayload, SqlInferRequest, SqlSourceConfigPayload}
import com.helio.api.protocols.workspace.{WorkspaceResourceDetail, WorkspaceResourceSearchProtocol}
import com.helio.domain.model.{AuthenticatedUser, DataTypeId, WorkspaceResourceType}
import spray.json._

import java.util.concurrent.atomic.{AtomicInteger, AtomicReference}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** HEL-756 design.md D1 — closed ADT over the two typed inline-source config payloads a
 *  `test_connection` call can verify, keyed by REUSING their existing `equals` (never a JSON-string
 *  fingerprint, which would need its own canonicalization). File-private: `verifiedConfigs` below
 *  never escapes `AssistantToolExecutor`. */
private[services] sealed trait VerifiedConfig
private[services] object VerifiedConfig {
  final case class Rest(config: RestApiConfigPayload) extends VerifiedConfig
  final case class Sql(config: SqlSourceConfigPayload) extends VerifiedConfig
}

/** `ClaudeToolExecutor` for HEL-659's top-level assistant (HEL-662 tasks.md section 4) — dispatches
 *  each of the 7 tools in `AssistantProtocol.assistantTools` to the collaborator that already
 *  implements it. Constructed FRESH per `AssistantService.converse` call (design.md D6) — never
 *  shared/reused across turns, so `capturedProposal`/`verifiedConfigs` below carry no cross-request
 *  state leakage.
 *
 *  Hard Boundary (non-negotiable): every `propose_*` case below calls a NON-MUTATING `validate`/
 *  `preview` method — never `apply`. There is no code path in this class that can reach a mutating
 *  service method. `test_connection` (HEL-756) is ALSO non-mutating — `SourceService.testRest`/
 *  `testSql` never persist anything, they only probe reachability. */
final class AssistantToolExecutor(
    workspaceSearchService: WorkspaceSearchService,
    panelCapabilityService: PanelCapabilityService,
    dashboardProposalService: DashboardProposalService,
    pipelineProposalService: PipelineProposalService,
    combinedProposalService: CombinedProposalService,
    patchSetPreviewService: PatchSetPreviewService,
    sourceService: SourceService,
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

  /** HEL-756 design.md D1 — every inline `rest_api`/`sql` config a `test_connection` call has
   *  verified `ok = true` for, so far this turn. `AtomicReference[Set[_]]` for the SAME concurrency
   *  reason `capturedProposal` above is an `AtomicReference` (same-hop `tool_use` blocks execute
   *  concurrently via `Future.traverse`); `updateAndGet` gives lock-free, retry-on-conflict set
   *  union, so a `test_connection` and a `propose_pipeline` racing in the same hop can never lose a
   *  concurrent write to each other. Populated ONLY on `executeTestConnection`'s `ok = true` (mirrors
   *  `capturedProposal`'s "only set on success" rule) — a failed test never verifies a config, and a
   *  config Claude edits after a successful test simply isn't a member of this set (design.md D1). */
  private val verifiedConfigs: AtomicReference[Set[VerifiedConfig]] = new AtomicReference(Set.empty)

  /** HEL-700 design.md D4/D7 — per-turn propose-call quality counters, `AtomicInteger` for the SAME
   *  concurrency reason `capturedProposal` above is an `AtomicReference`: `ClaudeClient.sendWithTools`
   *  executes every same-hop `tool_use` block concurrently via `Future.traverse`. Counted ONLY in the
   *  four `executeProposeX` dispatch paths below — `executeFind`/`executeGetResource` never touch
   *  these. `proposeAttemptsCounter` increments once per `propose_*` dispatch, unconditionally,
   *  BEFORE decode is attempted; `proposeDecodeFailuresCounter` increments only when `decode` returns
   *  `Left` (the shaping signal this ticket exists to measure); `proposeValidationFailuresCounter`
   *  increments only when a successfully-decoded proposal's `validate`/`preview` call returns `Left`.
   *  Integer counts only — never the failing `tool_use.input` payload or its deserialization error
   *  text (design.md D7, mirrors this class's own privacy discipline for `find`/`get_resource`). */
  private val proposeAttemptsCounter: AtomicInteger           = new AtomicInteger(0)
  private val proposeDecodeFailuresCounter: AtomicInteger     = new AtomicInteger(0)
  private val proposeValidationFailuresCounter: AtomicInteger = new AtomicInteger(0)

  def proposeAttempts: Int           = proposeAttemptsCounter.get()
  def proposeDecodeFailures: Int     = proposeDecodeFailuresCounter.get()
  def proposeValidationFailures: Int = proposeValidationFailuresCounter.get()

  override def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] =
    name match {
      case "find"              => executeFind(input)
      case "get_resource"      => executeGetResource(input)
      case "test_connection"   => executeTestConnection(input)
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

  // ── test_connection (HEL-756 tasks.md 1.3) ──────────────────────────────────────────────────

  /** Decodes `{type, config}` by `type` (mirrors `SourcePreviewRoutes`'s `POST /sources/test`
   *  dispatch), calls `sourceService.testRest`/`testSql`, and — on a `Right(TestConnectionResponse)`
   *  with `ok = true` — records the exact config into `verifiedConfigs` (design.md D1). Always
   *  returns the `TestConnectionResponse` JSON as the tool_result on a `Right`, `ok = true` or
   *  `false` alike: an unreachable endpoint is a normal, non-error DOMAIN outcome (mirrors
   *  `ConnectionTest.run`'s own "domain outcome, not HTTP error" framing), not a tool-execution
   *  failure — only an undecodable `type`/`config` or a service-level `ServiceError` becomes a
   *  `Left`. */
  private def executeTestConnection(input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
    val obj    = input.asJsObject
    val config = obj.fields.getOrElse("config", JsObject.empty)
    obj.fields.get("type").collect { case JsString(s) => s } match {
      case Some("rest_api") =>
        Try(config.convertTo[RestApiConfigPayload]) match {
          case Failure(e) =>
            Future.successful(Left(s"test_connection: invalid config — ${Option(e.getMessage).getOrElse(e.getClass.getName)}"))
          case Success(restConfig) =>
            sourceService.testRest(restConfig).map {
              case Left(err) => Left(err.message)
              case Right(response) =>
                if (response.ok) verifiedConfigs.updateAndGet(_ + VerifiedConfig.Rest(restConfig))
                Right(response.toJson.compactPrint)
            }
        }
      case Some("sql") =>
        Try(config.convertTo[SqlSourceConfigPayload]) match {
          case Failure(e) =>
            Future.successful(Left(s"test_connection: invalid config — ${Option(e.getMessage).getOrElse(e.getClass.getName)}"))
          case Success(sqlConfig) =>
            sourceService.testSql(SqlInferRequest("sql", sqlConfig)).map {
              case Left(err) => Left(err.message)
              case Right(response) =>
                if (response.ok) verifiedConfigs.updateAndGet(_ + VerifiedConfig.Sql(sqlConfig))
                Right(response.toJson.compactPrint)
            }
        }
      case other =>
        Future.successful(Left(s"test_connection: unrecognized or missing 'type': ${other.getOrElse("<absent>")}"))
    }
  }

  // ── propose_* (design.md D5/D6, Hard Boundary) ──────────────────────────────────────────────

  /** HEL-756 tasks.md 1.4/1.5 (design.md D1/D4) — `Right(())` for a `sourceId` source (existing,
   *  already-tested) or an inline `csv`/`static` source (no live endpoint to reach); for inline
   *  `rest_api`/`sql`, `Right(())` iff that exact config is a member of `verifiedConfigs`, else a
   *  `Left` tool-error naming the calling tool. Shared by `executeProposePipeline` (on
   *  `proposal.source`) and `executeProposeCombined` (on `proposal.pipeline.source`) — never
   *  duplicated (design.md D4). */
  private def requireVerifiedInlineSource(toolName: String, source: PipelineProposalSource): Either[String, Unit] = {
    def unverified: Left[String, Unit] =
      Left(s"$toolName: call test_connection with this exact config before finalizing this proposal")

    if (source.sourceId.isDefined) Right(())
    else
      source.`type` match {
        case Some("rest_api") =>
          source.restConfig match {
            case Some(config) if verifiedConfigs.get().contains(VerifiedConfig.Rest(config)) => Right(())
            case _                                                                             => unverified
          }
        case Some("sql") =>
          source.sqlConfig match {
            case Some(config) if verifiedConfigs.get().contains(VerifiedConfig.Sql(config)) => Right(())
            case _                                                                            => unverified
          }
        case _ => Right(())
      }
  }

  private def executeProposeDashboard(input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
    proposeAttemptsCounter.incrementAndGet()
    decode[DashboardProposal](input, "propose_dashboard") match {
      case Left(err) =>
        proposeDecodeFailuresCounter.incrementAndGet()
        Future.successful(Left(err))
      case Right(proposal) =>
        dashboardProposalService.validate(proposal, user).map {
          case Left(err) =>
            proposeValidationFailuresCounter.incrementAndGet()
            Left(err.message)
          case Right(_) =>
            capturedProposal.set(Some(AssistantProposal.Dashboard(proposal)))
            Right(proposal.toJson.compactPrint)
        }
    }
  }

  private def executeProposePipeline(input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
    proposeAttemptsCounter.incrementAndGet()
    decode[PipelineProposal](input, "propose_pipeline") match {
      case Left(err) =>
        proposeDecodeFailuresCounter.incrementAndGet()
        Future.successful(Left(err))
      case Right(proposal) =>
        requireVerifiedInlineSource("propose_pipeline", proposal.source) match {
          case Left(err) =>
            proposeValidationFailuresCounter.incrementAndGet()
            Future.successful(Left(err))
          case Right(_) =>
            pipelineProposalService.validate(proposal, user).map {
              case Left(err) =>
                proposeValidationFailuresCounter.incrementAndGet()
                Left(err.message)
              case Right(_) =>
                capturedProposal.set(Some(AssistantProposal.Pipeline(proposal)))
                Right(proposal.toJson.compactPrint)
            }
        }
    }
  }

  private def executeProposeCombined(input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
    proposeAttemptsCounter.incrementAndGet()
    decode[CombinedProposal](input, "propose_combined") match {
      case Left(err) =>
        proposeDecodeFailuresCounter.incrementAndGet()
        Future.successful(Left(err))
      case Right(proposal) =>
        requireVerifiedInlineSource("propose_combined", proposal.pipeline.source) match {
          case Left(err) =>
            proposeValidationFailuresCounter.incrementAndGet()
            Future.successful(Left(err))
          case Right(_) =>
            combinedProposalService.validate(proposal, user).map {
              case Left(err) =>
                proposeValidationFailuresCounter.incrementAndGet()
                Left(err.message)
              case Right(_) =>
                capturedProposal.set(Some(AssistantProposal.Combined(proposal)))
                Right(proposal.toJson.compactPrint)
            }
        }
    }
  }

  private def executeProposePatchSet(input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
    proposeAttemptsCounter.incrementAndGet()
    decode[PatchSet](input, "propose_patch_set") match {
      case Left(err) =>
        proposeDecodeFailuresCounter.incrementAndGet()
        Future.successful(Left(err))
      case Right(patchSet) =>
        patchSetPreviewService.preview(patchSet, user).map {
          case Left(err) =>
            proposeValidationFailuresCounter.incrementAndGet()
            Left(err.message)
          case Right(preview) =>
            capturedProposal.set(Some(AssistantProposal.Patch(patchSet, preview)))
            Right(preview.toJson.compactPrint)
        }
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
