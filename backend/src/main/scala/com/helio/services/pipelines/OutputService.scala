package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.services.auth.AccessChecker
import com.helio.api.protocols.pipelines.{AssertionStatusResponse, CreateOutputRequest, DeleteOutputResponse, OutputPanelPlacementResponse, UpdateOutputRequest}
import com.helio.domain.model.{AuthenticatedUser, NodeRef, Output, OutputId, OutputKind, Page, PagedResult, PipelineId, PipelineRunId, PipelineStepId, ResourceAccess}
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRunRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.domain.panels.OutputBindingSpec
import org.slf4j.LoggerFactory
import spray.json.{JsObject, JsString, JsValue}

import scala.concurrent.{ExecutionContext, Future}

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
    nodeSnapshotRepo: NodeSnapshotRepository = null
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

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

  /** Extracts `config.fieldMapping` (a `{slot: columnName}` object, when present) and
   *  validates its KEYS against `kind`'s own `requiredSlots ++ optionalSlots` (HEL-892,
   *  `OutputBindingSpec.validateFieldMapping`) -- column-TYPE eligibility (`evaluate`) is a
   *  capabilities-time concern (`GET /api/pipelines/:id/capabilities`), not a create/update-time
   *  one, since validating it here would require re-resolving the node's projected schema on
   *  every write. Absent `fieldMapping` is not an error -- not every Output kind requires one
   *  (`table`/`markdown` have no slots at all). */
  private def validateFieldMapping(kind: OutputKind, config: JsObject): Either[ServiceError, Unit] = {
    val spec = OutputBindingSpec.All.find(_.outputKind == kind).getOrElse(
      throw new IllegalStateException(s"OutputService: no OutputBindingSpec for kind $kind -- OutputBindingSpec.All is missing a case")
    )
    config.fields.get("fieldMapping").collect { case o: JsObject => o } match {
      case None => Right(())
      case Some(mappingObj) =>
        val mapping = mappingObj.fields.collect { case (k, JsString(v)) => k -> v }
        OutputBindingSpec.validateFieldMapping(spec, mapping) match {
          case Left(msg) => Left(ServiceError.BadRequest(msg))
          case Right(())  => Right(())
        }
    }
  }

  /** Create an Output on a pipeline node. Requires Editor or Owner access on
   *  the parent pipeline — a Viewer grantee cannot add Outputs. */
  def create(pipelineId: PipelineId, req: CreateOutputRequest, user: AuthenticatedUser): Future[Either[ServiceError, Output]] =
    if (req.name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else OutputKind.fromString(req.kind) match {
      case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(kind) =>
        val config = req.config.getOrElse(JsObject.empty)
        validateFieldMapping(kind, config) match {
          case Left(err) => Future.successful(Left(err))
          case Right(()) =>
            accessChecker.requireAccess("pipeline", pipelineId.value, Some(user), "Pipeline not found").flatMap {
              case Left(err)                       => Future.successful(Left(err))
              case Right(ResourceAccess.Viewer)     => Future.successful(Left(ServiceError.Forbidden()))
              case Right(_)                         =>
                outputRepo.insertInternal(
                  pipelineId = pipelineId,
                  nodeStepId = req.nodeStepId.map(PipelineStepId(_)),
                  ownerId    = user.id,
                  name       = req.name.trim,
                  kind       = kind,
                  config     = config
                ).map { output =>
                  audit("output.create", Some(output.id.value), user)
                  Right(output)
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

  /** Partial-merge update (HEL-877): a present `config` field is merged into
   *  the stored config one level deep for the four known sub-objects
   *  (`legend`, `tooltip`, `seriesColors`, `axisLabels`) — every other
   *  top-level key is replaced outright, matching a shallow-merge PATCH
   *  contract. Owner-only (RLS `outputs_update`, V94) — a non-owner sees a
   *  404 (existence-not-leaked), never a 403. */
  def update(id: OutputId, req: UpdateOutputRequest, user: AuthenticatedUser): Future[Either[ServiceError, (Output, JsObject)]] =
    outputRepo.findById(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(output) =>
        outputRepo.findConfigById(id, user).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
          case Some(existingConfig) =>
            val mergedConfig = req.config.map(patch => mergeConfig(existingConfig, patch))
            // HEL-892: validate the MERGED config's fieldMapping (the shape the write will
            // actually persist), not the raw patch -- a patch that only touches an unrelated
            // sub-object must not bypass validation of an already-invalid stored fieldMapping,
            // and a patch that legitimately fixes fieldMapping must be judged on its result.
            mergedConfig.map(cfg => validateFieldMapping(output.kind, cfg)).getOrElse(Right(())) match {
              case Left(err) => Future.successful(Left(err))
              case Right(()) =>
                outputRepo.updateOwned(id, user, req.name, mergedConfig).flatMap {
                  case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
                  case Some(updated) =>
                    audit("output.update", Some(updated.id.value), user)
                    outputRepo.findConfigById(id, user).map(cfg => Right((updated, cfg.getOrElse(JsObject.empty))))
                }
            }
        }
    }

  private val mergeableSubObjects = Set("legend", "tooltip", "seriesColors", "axisLabels")

  private def mergeConfig(existing: JsObject, patch: JsObject): JsObject = {
    val mergedFields = existing.fields ++ patch.fields.map {
      case (key, patchValue: JsObject) if mergeableSubObjects.contains(key) =>
        val existingSub = existing.fields.get(key).collect { case o: JsObject => o }.getOrElse(JsObject.empty)
        key -> JsObject(existingSub.fields ++ patchValue.fields)
      case other => other
    }
    JsObject(mergedFields)
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

  /** `GET /api/outputs/:id/rows` (HEL-906 cycle 7, P1.4's `get_output_rows` dependency):
   *  the Output's own materialized node snapshot (`node_snapshots`, keyed by
   *  `(pipelineId, nodeStepId)` off `output.node`), offset/limit paginated. Gated by
   *  `outputRepo.findById`'s own sharing-aware RLS select (same ACL surface as `GET
   *  /api/outputs/:id` above) -- an Output's rows are exactly as visible as the Output itself,
   *  no separate check needed. A missing `nodeSnapshotRepo` (nullable-optional wiring) degrades
   *  to an empty page rather than an NPE, mirroring every other nullable dependency in this
   *  service. */
  def rows(id: OutputId, page: Page, user: AuthenticatedUser): Future[Either[ServiceError, PagedResult[JsValue]]] =
    outputRepo.findById(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(_) if nodeSnapshotRepo == null =>
        Future.successful(Right(PagedResult(Vector.empty, 0, page.offset, page.limit)))
      case Some(output) =>
        nodeSnapshotRepo
          .listRowsPaged(output.node.pipelineId.value, output.node.stepId.map(_.value), page)
          .map(paged => Right(paged.copy(items = paged.items.map(identity[JsValue]))))
    }
}
