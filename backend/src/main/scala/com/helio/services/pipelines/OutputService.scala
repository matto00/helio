package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.services.auth.AccessChecker
import com.helio.api.protocols.pipelines.{AssertionStatusResponse, CreateOutputRequest, DeleteOutputResponse, OutputPanelPlacementResponse, OutputRowsResponse, UpdateOutputRequest}
import com.helio.domain.model.{AuthenticatedUser, NodeRef, Output, OutputId, OutputKind, Page, PagedResult, PipelineId, PipelineRunId, PipelineStepId, ResourceAccess}
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRootRepository, PipelineRunRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import org.slf4j.LoggerFactory
import spray.json.{JsObject, JsValue}

import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** Business logic for `GET/POST /api/pipelines/:id/outputs` and
 *  `GET/PATCH/DELETE /api/outputs/:id` (HEL-906, P1.3 of the Pipelines &
 *  Outputs remodel). Mirrors `PanelService`'s ACL pattern: the pipeline-level
 *  ACL (via `accessChecker`, resource type `"pipeline"` — already registered
 *  in `ApiRoutes.registry`) gates create/list-by-pipeline; per-Output
 *  read/update/delete rely on `OutputRepository`'s own RLS-backed methods
 *  (`findById` sharing-aware select, `updateOwned`/`deleteInternal`
 *  owner-only, V94 `outputs_update`/`outputs_delete`). */
final class OutputService(
    outputRepo:    OutputRepository,
    panelRepo:     PanelRepository,
    accessChecker: AccessChecker,
    // HEL-477: nullable-optional wiring mirrors PanelService/PipelineService above.
    auditService: AuditService = null,
    // HEL-906 task 2.5: nullable-optional wiring mirrors auditService above -- a fixture that
    // doesn't pass a PipelineRunRepository simply gets `invalid = false, failedRuleCount = 0`
    // from `assertionStatus` (no run history to check), never an NPE.
    pipelineRunRepo: PipelineRunRepository = null,
    // HEL-906 cycle 7 (`GET /api/outputs/:id/rows`): nullable-optional wiring mirrors
    // `pipelineRunRepo`/`auditService` above -- a fixture that doesn't pass a
    // `NodeSnapshotRepository` simply gets an empty page from `rows` rather than an NPE.
    nodeSnapshotRepo: NodeSnapshotRepository = null,
    // HEL-947: nullable-optional wiring mirrors nodeSnapshotRepo/pipelineRunRepo above -- a
    // fixture that doesn't pass a PipelineRunService simply skips the fire-and-forget
    // backfill kicked off by create/update below (never blocks, never fails the caller either
    // way -- see PipelineRunService.backfillOutputNode's own doc for why this is a targeted,
    // single-node call rather than PipelineRunService's own per-run write).
    pipelineRunService: PipelineRunService = null,
    // HEL-913 task 5.8a: nullable-optional wiring mirrors pipelineRunService/nodeSnapshotRepo
    // above -- a fixture that doesn't pass a PipelineRootRepository simply cannot validate a
    // caller-supplied `rootId` and falls back to the pipeline's auto-resolved first root
    // (Stage-1/2 behavior), never an NPE.
    pipelineRootRepo: PipelineRootRepository = null,
    // HEL-1356: completion hook. Receives the Output id and the Future returned by
    // `PipelineRunService.backfillOutputNode` (completes once the whole backfill chain has
    // finished; never fails). Called synchronously inside `create`/`update`, so it has run
    // before the HTTP response exists. Not called when `pipelineRunService` is null. Covers
    // exactly what `backfillOutputNode`'s returned Future covers -- work it detaches is not
    // observable. Default is a no-op; production never awaits it.
    backfillObserver: (OutputId, Future[Unit]) => Unit = OutputService.NoBackfillObserver
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val rowReads       = new OutputRowReads(outputRepo, nodeSnapshotRepo, pipelineRunRepo)
  private val rootResolution = new OutputRootResolution(pipelineRootRepo)
  import rootResolution.{requireUnambiguousRootWhenNeither, resolveExplicitRootId}

  /** HEL-947: fires `PipelineRunService.backfillOutputNode` off the request path -- NOT
   *  awaited, NOT flatMapped into the `create`/`update` response Future. The route's HTTP
   *  response returns as soon as the Output row itself is written; this runs concurrently and,
   *  per `backfillOutputNode`'s own contract, degrades to a complete no-op (never throws into
   *  this call site) whether it succeeds, finds nothing to backfill, or fails outright. A
   *  missing `pipelineRunService` (nullable-optional wiring, mirrors every other such fixture in
   *  this file) is a no-op too. */
  private def triggerBackfill(output: Output, user: AuthenticatedUser): Unit =
    if (pipelineRunService != null)
      // HEL-913 task 5.10: threads the Output's OWN root id through so a root-bound backfill
      // evaluates the root this Output is actually attached to, not always the lowest-positioned
      // one -- see PipelineRunService.backfillOutputNode's doc.
      {
        val done = pipelineRunService.backfillOutputNode(output.node.pipelineId, output.node.stepId, user, output.node.rootId)
        // The observer must never fail create/update.
        try backfillObserver(output.id, done)
        catch { case NonFatal(e) => log.warn(s"backfillObserver threw for output ${output.id.value}", e) }
      }

  private def audit(action: String, resourceId: Option[String], user: AuthenticatedUser, metadata: JsValue = JsObject.empty): Unit =
    if (auditService != null)
      auditService.record(Some(user.id), user.tokenId, user.source, action, "output", resourceId, metadata)

  /** `GET /api/outputs` (HEL-906 cycle 7, task 2.6, absorbs HEL-722): a lean, top-level,
   *  paginated list of every Output the CALLER OWNS -- mirrors `OutputRepository.findAllByOwner`
   *  exactly (owner-scoped, not sharing-aware; a shared-but-not-owned Output is reachable only
   *  via `GET /api/pipelines/:id/outputs`/`GET /api/outputs/:id`, which ARE sharing-aware).
   *  No ACL check needed beyond the query's own owner-scoping -- there is nothing to leak. */
  def listAll(user: AuthenticatedUser, page: Page): Future[PagedResult[Output]] =
    outputRepo.findAllByOwner(user.id, page)

  /** Per-page panel-placement counts for `listAll`'s page (HEL-909 CR2) — a
   *  single batched query via `PanelRepository.countByOutputIdsInternal`
   *  instead of the Output picker's prior N+1
   *  `GET /api/outputs/:id/panels` fan-out per card. Missing ids (no bound
   *  panels) default to `0` by the caller reading this map. */
  def panelCountsFor(outputs: Vector[Output]): Future[Map[String, Int]] =
    panelRepo.countByOutputIdsInternal(outputs.map(_.id.value))

  /** Batch config lookup for a page/list of Outputs (HEL-946) — a single
   *  query via `OutputRepository.findConfigsByIdsInternal`, not a per-row
   *  fetch. Missing ids (shouldn't happen — every persisted Output has a
   *  config row) default to `JsObject.empty` by the caller. */
  def configsFor(outputs: Vector[Output]): Future[Map[String, JsObject]] =
    outputRepo.findConfigsByIdsInternal(outputs.map(_.id.value))

  /** List every Output on a pipeline (optionally scoped to one node), gated
   *  on any level of pipeline access (owner/editor/viewer). */
  def listByPipeline(pipelineId: PipelineId, nodeStepId: Option[String], user: AuthenticatedUser): Future[Either[ServiceError, Vector[Output]]] =
    accessChecker.requireAccess("pipeline", pipelineId.value, Some(user), "Pipeline not found").flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  =>
        val stepId = nodeStepId.map(PipelineStepId(_))
        outputRepo.listByPipelineInternal(pipelineId).map { all =>
          Right(nodeStepId.fold(all)(_ => all.filter(_.node.stepId == stepId)))
        }
    }

  /** Create an Output on a pipeline node. Requires Editor or Owner access on
   *  the parent pipeline — a Viewer grantee cannot add Outputs. */
  def create(pipelineId: PipelineId, req: CreateOutputRequest, user: AuthenticatedUser): Future[Either[ServiceError, (Output, JsObject)]] =
    if (req.name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    // HEL-913 task 5.8a: `nodeStepId` and `rootId` are mutually exclusive when BOTH are
    // present -- naming both is ambiguous (which one wins?) and never a silent pick.
    else if (req.nodeStepId.isDefined && req.rootId.isDefined)
      Future.successful(Left(ServiceError.BadRequest("nodeStepId and rootId are mutually exclusive")))
    else OutputKind.fromString(req.kind) match {
      case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(kind) =>
        val config = req.config.getOrElse(JsObject.empty)
        OutputService.validateConfig(kind, config, JsObject.empty) match {
          case Left(err) => Future.successful(Left(err))
          case Right(()) =>
            accessChecker.requireAccess("pipeline", pipelineId.value, Some(user), "Pipeline not found").flatMap {
              case Left(err)                       => Future.successful(Left(err))
              case Right(ResourceAccess.Viewer)     => Future.successful(Left(ServiceError.Forbidden()))
              case Right(_)                         =>
                requireUnambiguousRootWhenNeither(pipelineId, req).flatMap {
                  case Left(err) => Future.successful(Left(err))
                  case Right(()) =>
                    resolveExplicitRootId(pipelineId, req.rootId).flatMap {
                      case Left(err) => Future.successful(Left(err))
                      case Right(explicitRootId) =>
                        outputRepo.insertInternal(
                          pipelineId = pipelineId,
                          nodeStepId = req.nodeStepId.map(PipelineStepId(_)),
                          ownerId    = user.id,
                          name       = req.name.trim,
                          kind       = kind,
                          config     = config,
                          explicitRootId = explicitRootId
                        ).map { output =>
                          audit("output.create", Some(output.id.value), user)
                          triggerBackfill(output, user)
                          // HEL-946: return the config we just wrote, not a re-fetch —
                          // the caller (POST /api/pipelines/:id/outputs) previously
                          // dropped it via the config-less `outputResponseFrom`
                          // overload, so a freshly-created Output round-tripped as
                          // `config: {}` even though the write itself was correct.
                          Right((output, config))
                        }
                    }
                }
            }
        }
    }

  /** Sharing-aware read — owner, editor, and viewer grantees of the parent
   *  pipeline can read (enforced by `outputs_select` RLS, V94). */
  def findById(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, (Output, JsObject)]] =
    outputRepo.findById(id, user).flatMap {
      case None         => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(output) => outputRepo.findConfigById(id, user).map(cfg => Right((output, cfg.getOrElse(JsObject.empty))))
    }

  /** Partial-merge update (HEL-877): a present `config` field is shallow-merged
   *  into the stored config — each top-level key in the patch replaces that key
   *  outright (HEL-1313 removed the former one-level deep merge). `policy` is
   *  [[OutputConfigWritePolicy.ValidateWrite]] for every caller except patch-set
   *  rollback. Owner-only (RLS `outputs_update`, V94) — a non-owner sees a
   *  404 (existence-not-leaked), never a 403. */
  def update(
      id:     OutputId,
      req:    UpdateOutputRequest,
      user:   AuthenticatedUser,
      policy: OutputConfigWritePolicy = OutputConfigWritePolicy.ValidateWrite
  ): Future[Either[ServiceError, (Output, JsObject)]] =
    outputRepo.findById(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(output) =>
        outputRepo.findConfigById(id, user).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
          case Some(existingConfig) =>
            val mergedConfig = req.config.map { patch =>
              val merged = OutputService.mergeConfig(existingConfig, patch)
              // HEL-1409: a restore of previously captured state is written as V117 would have written
              // it (judged on the MERGED config: a non-null live key shadows a dead one). Never for ValidateWrite.
              if (policy == OutputConfigWritePolicy.RestorePriorStored) LegacyOutputConfigKeys.normalise(output.kind, merged) else merged
            }
            // HEL-892: validate the MERGED config's fieldMapping (the shape the write will
            // actually persist), not the raw patch -- a patch that only touches an unrelated
            // sub-object must not bypass validation of an already-invalid stored fieldMapping,
            // and a patch that legitimately fixes fieldMapping must be judged on its result.
            req.config.map(patch => OutputService.validateConfig(output.kind, patch, existingConfig, policy)).getOrElse(Right(())) match {
              case Left(err) => Future.successful(Left(err))
              case Right(()) =>
                outputRepo.updateOwned(id, user, req.name, mergedConfig).flatMap {
                  case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
                  case Some(updated) =>
                    audit("output.update", Some(updated.id.value), user)
                    // HEL-947: `nodeStepId` is not part of `UpdateOutputRequest` -- an edit can
                    // never move an Output to a different node today -- but this call is still
                    // wired here (not only in `create`) so a future request shape that adds
                    // repointing does not silently regress the backfill guarantee. Idempotent
                    // and cheap when the node is already snapshotted (backfillOutputNode's own
                    // first check).
                    triggerBackfill(updated, user)
                    outputRepo.findConfigById(id, user).map(cfg => Right((updated, cfg.getOrElse(JsObject.empty))))
                }
            }
        }
    }

  /** Deletes the Output and every panel placement bound to it (V94's
   *  `panels.output_id ON DELETE CASCADE` would do this at the DB level too,
   *  but the panels are deleted explicitly here — before the Output row —
   *  so their ids can be reported back in the response). Owner-only: checked
   *  explicitly against the sharing-aware `findById` result's `ownerId`
   *  (rather than relying on RLS alone) BEFORE calling the ACL-bypassing
   *  `panelRepo.deleteByOutputIdInternal`/`outputRepo.deleteInternal` —
   *  those two are privileged writes with no RLS backstop of their own, so
   *  the owner check has to happen here, in the service layer. */
  def delete(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, DeleteOutputResponse]] =
    outputRepo.findById(id, user).flatMap {
      case None                                        => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(output) if output.ownerId != user.id    => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(_) =>
        panelRepo.deleteByOutputIdInternal(id.value).flatMap { removedPanelIds =>
          outputRepo.deleteInternal(id).map { _ =>
            audit("output.delete", Some(id.value), user)
            Right(DeleteOutputResponse(removedPanelIds.map(_.value)))
          }
        }
    }

  /** `GET /api/outputs/:id/panels` — the placements report used by the
   *  delete-warning UI and the Output sheet. */
  def listPanels(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[OutputPanelPlacementResponse]]] =
    outputRepo.findById(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(_) =>
        panelRepo.findByOutputIdInternal(id.value).map { panels =>
          Right(panels.map(p => OutputPanelPlacementResponse(p.id.value, p.dashboardId.value)))
        }
    }

  /** `GET /api/outputs/:id/assertion-status` (HEL-906 task 2.5, replacing the retired
   *  `GET /api/types/:id/assertion-status`, HEL-576). `invalid = true` iff the Output's OWN
   *  node (`node.stepId` -- `None` never has an `assert` step, so is always `invalid = false`)
   *  has at least one error-severity failed assertion on the pipeline's most recent NON-DRY
   *  run.
   *
   *  HEL-906 cycle 4 correction (evaluation-3.md CR1): a prior version of this comment claimed
   *  "a dry run persists no `pipeline_runs` row at all" -- FALSE. `insertDryRunInternal`
   *  (`PipelineRunRepository.scala`) writes a real row with `status = "dry_run"` into the SAME
   *  `pipeline_runs` table (`onDryRunSuccess` sequences `insertAssertions` after it specifically
   *  so the row exists as the assertions' FK parent); `listByPipelineInternal` has no status
   *  filter and returns dry runs sorted alongside real ones. Filtering `status != "dry_run"`
   *  explicitly below is therefore load-bearing, not defensive dead code -- without it, a
   *  preview (dry) run's assertion outcome could be reported as the pipeline's real last-run
   *  status. */
  def assertionStatus(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, AssertionStatusResponse]] =
    outputRepo.findById(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(output) if output.node.stepId.isEmpty || pipelineRunRepo == null =>
        Future.successful(Right(AssertionStatusResponse(id.value, invalid = false, failedRuleCount = 0)))
      case Some(output) =>
        val stepId = output.node.stepId.get.value
        pipelineRunRepo.listByPipelineInternal(output.node.pipelineId).flatMap { runs =>
          runs.find(_.status != "dry_run") match {
            case None => Future.successful(Right(AssertionStatusResponse(id.value, invalid = false, failedRuleCount = 0)))
            case Some(latestRealRun) =>
              pipelineRunRepo.listAssertionsByRunInternal(PipelineRunId(latestRealRun.id)).map { assertions =>
                val failedCount = assertions.count(a => a.stepId == stepId && a.severity == "error" && !a.passed)
                Right(AssertionStatusResponse(id.value, invalid = failedCount > 0, failedRuleCount = failedCount))
              }
          }
        }
    }

  /** `GET /api/outputs/:id/rows`; implemented by [[OutputRowReads]]. */
  def rows(
      id: OutputId,
      page: Page,
      user: AuthenticatedUser,
      sort: Option[OutputRowsQuery.SortParam] = None,
      filter: Option[OutputRowsQuery.FilterParam] = None
  ): Future[Either[ServiceError, OutputRowsResponse]] =
    rowReads.rows(id, page, user, sort, filter)

  /** `GET /api/outputs/:id/filter-capabilities`; implemented by [[OutputRowReads]]. */
  def filterCapabilities(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, OutputFilterCapability.FilterCapabilityContract]] =
    rowReads.filterCapabilities(id, user)

  /** `GET /api/outputs/:id/distinct-values?column=`; implemented by [[OutputRowReads]]. */
  def distinctValues(id: OutputId, user: AuthenticatedUser, column: String): Future[Either[ServiceError, Vector[(String, Int)]]] =
    rowReads.distinctValues(id, user, column)
}

object OutputService {

  /** Default `backfillObserver` (HEL-1356): does nothing. */
  val NoBackfillObserver: (OutputId, Future[Unit]) => Unit = (_, _) => ()

  /** Forwarder to [[OutputConfigValidation.validateFieldMapping]]. */
  def validateFieldMapping(kind: OutputKind, config: JsObject): Either[ServiceError, Unit] =
    OutputConfigValidation.validateFieldMapping(kind, config)

  /** Forwarder to [[OutputConfigValidation.validateConfig]]. */
  def validateConfig(
      kind:    OutputKind,
      written: JsObject,
      stored:  JsObject,
      policy:  OutputConfigWritePolicy = OutputConfigWritePolicy.ValidateWrite
  ): Either[ServiceError, Unit] =
    OutputConfigValidation.validateConfig(kind, written, stored, policy)

  /** Forwarder to [[OutputConfigValidation.mergeConfig]] (shared with `PatchSetPreviewProjection`). */
  def mergeConfig(existing: JsObject, patch: JsObject): JsObject =
    OutputConfigValidation.mergeConfig(existing, patch)
}
