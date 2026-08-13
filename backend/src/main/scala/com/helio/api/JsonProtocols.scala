package com.helio.api

import com.helio.api.protocols._

/** Aggregator trait that composes every per-domain protocol trait.
 *
 *  Per-domain traits live under `com.helio.api.protocols` and own their
 *  own case classes, companion-object converters, and `implicit val ...Format`
 *  definitions. This trait carries zero formats of its own — it exists only
 *  to give downstream call sites (routes, tests, repositories) a single
 *  `extends JsonProtocols` mix-in that pulls every JSON formatter into scope.
 *
 *  Inter-trait dependencies (each declared via `extends` inside the per-domain
 *  trait, so the macro resolution order is correct here regardless of order):
 *
 *  - `PanelProtocol      extends ResourceProtocol`     (PanelResponse carries ResourceMetaResponse)
 *  - `DashboardProtocol  extends PanelProtocol`        (DuplicateDashboardResponse + snapshot use panel types)
 *  - `PipelineProtocol   extends DataTypeProtocol`     (PipelineAnalyzeResponse uses SchemaFieldResponse)
 *  - `DataSourceProtocol extends DataTypeProtocol`     (CreateSourceResponse carries DataTypeResponse)
 *  - `PipelineProposalProtocol extends DataSourceProtocol with PipelineStepProtocol`
 *    (PipelineProposalSource carries the per-kind config payloads; PipelineProposal.steps
 *    reuses CreatePipelineStepRequest verbatim — HEL-379)
 *  - `CombinedProposalProtocol extends PipelineProposalProtocol with DashboardProposalProtocol
 *    with DashboardProtocol` (CombinedProposal nests PipelineProposal + DashboardProposal
 *    verbatim; CombinedProposalApplyResponse nests PipelineProposalApplyResponse +
 *    DuplicateDashboardResponse verbatim — HEL-387)
 *  - `PipelineAnalyzeProposalProtocol extends PipelineAnalyzeProtocol` (reuses
 *    SchemaFieldResponse + AnalyzeStepResponse/analyzeStepResponseFormat verbatim — HEL-381)
 *  - `AlertRuleProtocol` has no cross-domain dependency (condition is a raw JsValue)
 *  - `AlertEventProtocol` has no cross-domain dependency (value is a raw JsValue)
 *  - `MetricProtocol` has no cross-domain dependency
 *  - `PipelineScheduleProtocol` has no cross-domain dependency
 *  - `ConnectorProtocol` has no cross-domain dependency
 *  - `PipelineShapeProtocol` has no cross-domain dependency
 *  - `PanelCapabilityProtocol` has no cross-domain dependency
 *  - `BoundPanelProtocol extends PanelProtocol with DataSourceProtocol with PipelineProtocol`
 *    (BoundPanelRequest/Response carry PanelResponse, StaticColumnPayload, and
 *    CreatePipelineStepRequest)
 *  - `DashboardAuthoringProtocol extends DashboardProposalProtocol` (DashboardAuthoringResponse
 *    nests DashboardProposal verbatim — HEL-392)
 *  - `AuthoringConversationProtocol extends DashboardProposalProtocol` (AuthoringConversationView
 *    nests DashboardProposal verbatim — HEL-397)
 *  - `PaginationProtocol extends DashboardProtocol with DataTypeProtocol with
 *    DataSourceProtocol with PanelProtocol with MetricProtocol` (one
 *    `PagedResult[...]` format per list-endpoint response type, HEL-493 adds
 *    `PagedResult[MetricResponse]`)
 *
 *  All re-exports for backward compatibility happen via `package object protocols`
 *  / wildcard import below: every case class and companion is in
 *  `com.helio.api.protocols`, and the package object re-exports them into
 *  `com.helio.api` so call sites that say `import com.helio.api._` still see them.
 */
trait JsonProtocols
    extends ResourceProtocol
    with AuthProtocol
    with ApiTokenProtocol
    with PanelProtocol
    with DashboardProtocol
    with DashboardProposalProtocol
    with PipelineProposalProtocol
    with CombinedProposalProtocol
    with PipelineAnalyzeProposalProtocol
    with DataTypeProtocol
    with DataSourceProtocol
    with PipelineProtocol
    with PermissionProtocol
    with PaginationProtocol
    with ImageUploadProtocol
    with AlertRuleProtocol
    with AlertEventProtocol
    with MetricProtocol
    with PipelineScheduleProtocol
    with ConnectorProtocol
    with PipelineShapeProtocol
    with PanelCapabilityProtocol
    with BoundPanelProtocol
    with WorkspaceProtocol
    with WorkspaceContextProtocol
    with HookProtocol
    with DashboardAuthoringProtocol
    with AuthoringConversationProtocol
