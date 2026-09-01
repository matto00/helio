package com.helio.services.patchsets

import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.api.protocols.dashboards.{CreateDashboardRequest, UpdateDashboardRequest}
import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.patchsets.EditOutcome
import com.helio.api.protocols.sources.{StaticDataSourceRequest, UpdateDataSourceRequest}
import com.helio.domain.model.{Dashboard, DashboardId, DataSource, DataSourceId, Panel, PanelId, PipelineId, PipelineStep, PipelineStepId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import spray.json.JsValue

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

  // `dataType`/`pipelineStep` create carry no ResolvedAction — rejected at
  // pre-validation itself (design.md D1: no create API / no parent-pipeline
  // id field on EditTarget).
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
    action: ResolvedAction
) {
  def toOutcome(status: String, newId: Option[String] = None, resultingState: Option[JsValue] = None): EditOutcome =
    EditOutcome(index = index, status = status, newId = newId, priorState = priorStateJson, resultingState = resultingState)
}

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
    accessChecker: AccessChecker
)

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
    pipelineService: PipelineService
)
