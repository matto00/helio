package com.helio.services.patchsets

import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.{OutputControlsValidator, PanelCreateDryRun, PanelService}
import com.helio.services.pipelines.{OutputService, PipelineRootDryRun, PipelineService, PipelineStepWriteChecks}
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.services.sources.{DataSourceService, SourceService}
import scala.concurrent.ExecutionContext
import com.helio.api.protocols.dashboards.{CreateDashboardRequest, UpdateDashboardRequest}
import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.api.protocols.pipelines.{CreateOutputRequest, CreatePipelineRequest, CreatePipelineStepRequest, UpdateOutputRequest, UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.patchsets.EditOutcome
import com.helio.api.protocols.sources.{StaticDataSourceRequest, UpdateDataSourceRequest}
import com.helio.domain.model.{OutputKind, Dashboard, DashboardId, DataSource, DataSourceId, Output, OutputId, Panel, PanelId, PipelineId, PipelineStep, PipelineStepId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import spray.json.{JsObject, JsValue}

/** Internal types shared by [[PatchSetApplyService]]'s pre-validation
 *  (design.md D2/D2a), forward-apply (design.md D1), and rollback (design.md
 *  D3/D3a/D1) passes — extracted to its own file to keep
 *  `PatchSetApplyService.scala` under a manageable size.
 *
 *  A `ResolvedEdit` is the output of pre-validation: everything task 4/5 need
 *  to apply and, if necessary, roll back one edit, without a second DB read
 *  (design.md D2's pre-validation reads double as D4a's prior-state capture). */

/** One kind/op's resolved intent, carrying the typed request the matching
 *  existing service method expects plus (for `update`/`delete`) the
 *  pre-mutation domain object already read during pre-validation. `create`
 *  actions carry no prior domain object — nothing existed before a create. */
private[services] sealed trait ResolvedAction

private[services] object ResolvedAction {
  final case class PanelUpdate(id: PanelId, request: UpdatePanelRequest, prior: Panel) extends ResolvedAction
  final case class PanelDelete(id: PanelId, prior: Panel) extends ResolvedAction
  final case class PanelCreate(request: CreatePanelRequest) extends ResolvedAction

  final case class DashboardUpdate(id: DashboardId, request: UpdateDashboardRequest, prior: Dashboard) extends ResolvedAction
  final case class DashboardDelete(id: DashboardId, prior: Dashboard) extends ResolvedAction
  final case class DashboardCreate(request: CreateDashboardRequest) extends ResolvedAction

  final case class DataSourceUpdate(id: DataSourceId, request: UpdateDataSourceRequest, prior: DataSource) extends ResolvedAction
  final case class DataSourceDelete(id: DataSourceId, prior: DataSource) extends ResolvedAction
  final case class DataSourceCreate(request: StaticDataSourceRequest) extends ResolvedAction

  // HEL-904 task 3.3: `DataTypeUpdate`/`DataTypeDelete` REMOVED outright --
  // `PatchSetProtocol.recognizedKinds` no longer accepts "dataType" as a
  // valid target.kind, so no resolver can ever produce one of these.

  final case class PipelineUpdate(id: PipelineId, request: UpdatePipelineRequest, prior: PipelineSummary) extends ResolvedAction
  final case class PipelineDelete(id: PipelineId, prior: PipelineSummary) extends ResolvedAction
  final case class PipelineCreate(request: CreatePipelineRequest) extends ResolvedAction

  final case class PipelineStepUpdate(id: PipelineStepId, request: UpdatePipelineStepRequest, prior: PipelineStep) extends ResolvedAction
  final case class PipelineStepDelete(id: PipelineStepId, prior: PipelineStep) extends ResolvedAction
  // HEL-914 task 5.1/5.2: a lane -- `pipelineId` is resolved from `target.parentId`, `request`
  // carries the tree-shape `parentStepId` (which EXISTING step this lane branches off).
  final case class PipelineStepCreate(pipelineId: PipelineId, request: CreatePipelineStepRequest) extends ResolvedAction

  // HEL-907 task 1.2: `output` has no `create` ResolvedAction -- unimplemented deliberately
  // (task 5.4/D3): the `EditTarget.parentId` gap that used to explain this is now closed, but
  // nothing in this change exercises an `output` create.
  final case class OutputUpdate(id: OutputId, request: UpdateOutputRequest, prior: Output, priorConfig: JsObject) extends ResolvedAction
  final case class OutputDelete(id: OutputId, prior: Output) extends ResolvedAction
  // HEL-1639 D2: add an Output at an existing step of an existing pipeline. `request` is the create-Output body; its
  // `nodeStepId` was checked against the pipeline's SAVED steps at resolve time. The edit's own `ref` (if any) lives on
  // `ResolvedEdit.ref`.
  final case class OutputCreate(pipelineId: PipelineId, request: CreateOutputRequest) extends ResolvedAction

  // `dataType` create carries no ResolvedAction -- rejected at pre-validation itself (no create
  // API exists for it at all). `output` create likewise carries none -- not because of any
  // EditTarget gap (task 5.1 closed that for every kind), but because it is unimplemented since
  // untested (task 5.4/D3). `pipelineStep` create is NOT in this list: it has its own
  // `PipelineStepCreate` ResolvedAction above (task 5.1/5.2).
}

/** Pairs one edit's original index/kind/op with its `ResolvedAction` and the
 *  pre-mutation state captured for `update`/`delete` (design.md D4a's
 *  `priorState`, `None` for `create`). `toOutcome` builds this edit's
 *  `EditOutcome` for either the all-succeeded path (`status = "applied"`) or
 *  a rollback compensation's own outcome. */
private[services] final case class ResolvedEdit(
    index: Int,
    kind: String,
    op: String,
    priorStateJson: Option[JsValue],
    action: ResolvedAction,
    // HEL-1639 D2: the `target.ref` a create edit carries, which a later panel create may name as `"$ref:<ref>"`.
    ref: Option[String] = None,
    // HEL-1639 D2: set on a panel create whose `config.outputId` is `"$ref:<ref>"`; carries the referenced create's kind.
    outputRefUse: Option[OutputRefUse] = None
) {
  def toOutcome(status: String, newId: Option[String] = None, resultingState: Option[JsValue] = None): EditOutcome =
    EditOutcome(index = index, status = status, newId = newId, priorState = priorStateJson, resultingState = resultingState)
}

/** A panel create's binding to an earlier `output` create of the same set (HEL-1639 D2): `ref` names it and `kind` is
 *  that create's Output kind (a pending Output has no stored row to read the kind from). */
private[services] final case class OutputRefUse(ref: String, kind: OutputKind)

/** Read-side collaborators [[PatchSetApplyResolvers]]'s pre-validation pass
 *  needs (design.md D2/D2a) — bundled so every resolver function takes one
 *  parameter instead of a positional repo list. HEL-904 task 4.1:
 *  `dataTypeRepo`/`metricRepo` removed outright — neither field was ever
 *  read after construction (DataTypes/metrics no longer exist). */
private[services] final case class PatchSetApplyContext(
    panelRepo: PanelRepository,
    dashboardRepo: DashboardRepository,
    dataSourceRepo: DataSourceRepository,
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    accessChecker: AccessChecker,
    // HEL-1239: NO `= null` default -- a construction site that omits a collaborator must fail to
    // compile instead of silently reaching a resolver NPE. HEL-1337: non-null is also asserted at
    // construction (below), so a null repo fails loudly here rather than as a later NPE.
    outputRepo: OutputRepository,
    // HEL-1638 D1b: resolves an inline pipeline-create root's schema for the create dry run. `chargeFetches` is true for
    // preview only (the propose-time fetch is charged to the source-fetch budget; apply's re-run of resolve is not, exactly
    // as `PipelineProposalService.apply`).
    rootDryRun: PipelineRootDryRun,
    chargeFetches: Boolean,
    // HEL-1638 D3: runs `PanelService.create`/`update`'s own checks at resolve. Its controls validator has no node-snapshot
    // repo, so a `dropdown` control's eq/in cardinality check stays apply-only.
    panelDryRun: PanelCreateDryRun,
    // HEL-1722 D3: `PipelineService.addStep`/`updateStep`'s own read-only pre-write checks, run at resolve. Built in `build` from the
    // repositories already here, so preview, apply and the draft save cannot omit it.
    stepWriteChecks: PipelineStepWriteChecks
) {
  require(outputRepo != null, "PatchSetApplyContext requires an OutputRepository")
}

private[services] object PatchSetApplyContext {

  /** The ONE construction path for the context -- both [[PatchSetApplyService]] and
   *  [[PatchSetPreviewService]] build through here, so a collaborator one of them omits is a
   *  compile error (every parameter is required) and the structural parity test can exercise it.
   *  This overload CHARGES live fetches (preview): the `sourceFetchBudget` is required so a new construction site cannot
   *  silently get a private, unshared budget (HEL-1638, C12). */
  def build(
      panelRepo: PanelRepository,
      dashboardRepo: DashboardRepository,
      dataSourceRepo: DataSourceRepository,
      pipelineRepo: PipelineRepository,
      pipelineStepRepo: PipelineStepRepository,
      accessChecker: AccessChecker,
      outputRepo: OutputRepository,
      sourceService: SourceService,
      sourceFetchBudget: SourceFetchBudget,
      chargeFetches: Boolean
  )(implicit ec: ExecutionContext): PatchSetApplyContext = {
    // The context's own message must win over the nested OutputControlsValidator's (HEL-1337), so check before building it.
    require(outputRepo != null, "PatchSetApplyContext requires an OutputRepository")
    PatchSetApplyContext(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker, outputRepo,
      new PipelineRootDryRun(dataSourceRepo, sourceService, sourceFetchBudget), chargeFetches,
      new PanelCreateDryRun(outputRepo, dataSourceRepo, new OutputControlsValidator(outputRepo, null)),
      PipelineStepWriteChecks.fromRepos(pipelineRepo, pipelineStepRepo, dataSourceRepo)
    )
  }

  /** The apply-side context: `chargeFetches = false`, so the budget is never consulted (the preview that preceded apply
   *  paid; apply's one fetch is `createRest`/`createSql`'s own). An inert budget is supplied instead of a parameter. */
  def buildUncharged(
      panelRepo: PanelRepository,
      dashboardRepo: DashboardRepository,
      dataSourceRepo: DataSourceRepository,
      pipelineRepo: PipelineRepository,
      pipelineStepRepo: PipelineStepRepository,
      accessChecker: AccessChecker,
      outputRepo: OutputRepository,
      sourceService: SourceService = null
  )(implicit ec: ExecutionContext): PatchSetApplyContext =
    build(panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker, outputRepo, sourceService,
      SourceFetchBudget.default(), chargeFetches = false)
}

/** The existing per-resource services [[PatchSetApplyService]]'s forward-
 *  apply (design.md D1) and [[PatchSetApplyRollback]]'s compensation
 *  (design.md D3/D3a) exclusively mutate through — no direct repository
 *  writes anywhere in this ticket. */
// HEL-904 task 3.3: `dataTypeService` REMOVED outright -- `dataType` is no
// longer a valid target.kind, so forward-apply/rollback never invoke it.
private[services] final case class PatchSetApplyServices(
    panelService: PanelService,
    dashboardService: DashboardService,
    dataSourceService: DataSourceService,
    pipelineService: PipelineService,
    // HEL-907 task 1.2: nullable-optional, same rationale as PatchSetApplyContext.outputRepo above.
    outputService: OutputService = null
)
