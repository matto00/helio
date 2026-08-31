package com.helio.services.patchsets

import com.helio.api.protocols.dashboards.DashboardProtocol
import com.helio.api.protocols.sources.DataSourceProtocol
import com.helio.api.protocols.pipelines.{PipelineProtocol, PipelineStepProtocol}
import com.helio.api.protocols.panels.PanelProtocol

/** Spray-JSON helper surface for the `patch-set-apply-path` (HEL-406) files —
 *  mirrors `CombinedProposalServiceJson`/`PatchSetProtocol`'s own mixin list
 *  exactly, giving [[PatchSetApplyResolvers]]/[[PatchSetApplyService]]/
 *  [[PatchSetApplyRollback]] access to every existing per-resource request/
 *  response `RootJsonFormat` (decode `createPatch`, encode `priorState`/
 *  `resultingState` via each kind's EXISTING response shape) without
 *  duplicating any per-domain protocol trait.
 *
 *  HEL-904 task 3.3: `DataTypeProtocol` REMOVED outright -- `dataType` is no
 *  longer a valid target.kind, so nothing here encodes/decodes a
 *  `DataTypeResponse`/`UpdateDataTypeRequest` anymore. */
private[services] object PatchSetApplyServiceJson
    extends PanelProtocol
    with DashboardProtocol
    with DataSourceProtocol
    with PipelineProtocol
    with PipelineStepProtocol
