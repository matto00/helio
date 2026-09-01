package com.helio.api

import com.helio.api.protocols._
import com.helio.api.protocols.agents._
import com.helio.api.protocols.alerts._
import com.helio.api.protocols.assistant._
import com.helio.api.protocols.audit._
import com.helio.api.protocols.auth._
import com.helio.api.protocols.dashboards._
import com.helio.api.protocols.hooks._
import com.helio.api.protocols.panels._
import com.helio.api.protocols.patchsets._
import com.helio.api.protocols.pipelines._
import com.helio.api.protocols.proposals._
import com.helio.api.protocols.sources._
import com.helio.api.protocols.workspace._

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
 *  - `PatchSetProtocol extends PanelProtocol with DashboardProtocol with DataSourceProtocol
 *    with DataTypeProtocol with PipelineProtocol with PipelineStepProtocol` (Edit's six
 *    update-patch fields reuse each domain's existing Update*Request format verbatim — HEL-403)
 *  - `PatchSetApplyProtocol` has no cross-domain dependency of its own (EditOutcome's
 *    priorState/resultingState are raw JsValue) — HEL-406
 *  - `PatchSetPreviewProtocol` has no cross-domain dependency of its own (EditPreview's
 *    before/after are raw JsValue) — HEL-408
 *  - `PatchSetUndoProtocol` has no cross-domain dependency of its own (EditUndoOutcome's
 *    resultingState is raw JsValue) — HEL-413
 *  - `AlertRuleProtocol` has no cross-domain dependency (condition is a raw JsValue)
 *  - `AlertEventProtocol` has no cross-domain dependency (value is a raw JsValue)
 *  - `MetricProtocol` has no cross-domain dependency
 *  - `PipelineScheduleProtocol` has no cross-domain dependency
 *  - `ConnectorProtocol` has no cross-domain dependency
 *  - `PipelineShapeProtocol` has no cross-domain dependency
 *  - `PanelCapabilityProtocol` has no cross-domain dependency
 *  - `DashboardAuthoringProtocol extends DashboardProposalProtocol` (DashboardAuthoringResponse
 *    nests DashboardProposal verbatim — HEL-392)
 *  - `AuthoringConversationProtocol extends DashboardProposalProtocol with PatchSetProtocol`
 *    (AuthoringConversationView nests DashboardProposal verbatim — HEL-397 — and, since HEL-411
 *    design.md D3/D4, PatchSet verbatim too — one shared conversation-view shape for both flows)
 *  - `RefinementProtocol extends PatchSetProtocol` (RefinementResponse nests PatchSet verbatim —
 *    HEL-411)
 *  - `AssistantConversationProtocol` has no cross-domain dependency (`transcript` is a raw
 *    `JsValue` — HEL-663)
 *  - `AgentPreferencesProtocol` has no cross-domain dependency (HEL-472 / 420-A)
 *  - `AgentMemoryProtocol` has no cross-domain dependency (HEL-478 / 420-B)
 *  - `MfaProtocol` has no cross-domain dependency (HEL-702)
 *  - `BetaAccessProtocol` has no cross-domain dependency (redeem's response reuses
 *    `UserResponse`/`AuthProtocol` verbatim, not a nested type of its own — HEL-704)
 *  - `AuditEventProtocol` has no cross-domain dependency (`metadata` is a raw `JsValue` — HEL-471)
 *  - `PaginationProtocol extends DashboardProtocol with DataTypeProtocol with
 *    DataSourceProtocol with PanelProtocol with MetricProtocol` (one
 *    `PagedResult[...]` format per list-endpoint response type, HEL-493 adds
 *    `PagedResult[MetricResponse]`)
 *  - `WorkspaceResourceSearchProtocol extends WorkspaceContextProtocol with MetricProtocol`
 *    (`WorkspaceResourceDetail` wraps 4 `WorkspaceContext*` types verbatim + the new
 *    `WorkspaceResourceMetric`, whose `format` field reuses `MetricFormat` — HEL-661)
 *
 *  All re-exports for backward compatibility happen via `package object protocols`
 *  / wildcard import below: every case class and companion is in
 *  `com.helio.api.protocols`, and the package object re-exports them into
 *  `com.helio.api` so call sites that say `import com.helio.api._` still see them.
 */
trait JsonProtocols
    extends ResourceProtocol
    with AuthProtocol
    with MfaProtocol
    with ApiTokenProtocol
    with PanelProtocol
    with DashboardProtocol
    with DashboardProposalProtocol
    with PipelineProposalProtocol
    with CombinedProposalProtocol
    with PipelineAnalyzeProposalProtocol
    with PatchSetProtocol
    with PatchSetApplyProtocol
    with PatchSetPreviewProtocol
    with PatchSetUndoProtocol
    with DataSourceProtocol
    with PipelineProtocol
    with PermissionProtocol
    with PaginationProtocol
    with ImageUploadProtocol
    with AlertRuleProtocol
    with AlertEventProtocol
    with PipelineScheduleProtocol
    with ConnectorProtocol
    with PipelineShapeProtocol
    with PanelCapabilityProtocol
    with WorkspaceProtocol
    with WorkspaceContextProtocol
    with WorkspaceResourceSearchProtocol
    with HookProtocol
    with DashboardAuthoringProtocol
    with AuthoringConversationProtocol
    with RefinementProtocol
    with AssistantConversationProtocol
    with AgentPreferencesProtocol
    with AgentMemoryProtocol
    with BetaAccessProtocol
    with AuditEventProtocol
    with ConnectorEntityProtocol
