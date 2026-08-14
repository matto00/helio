package com.helio.services

import com.helio.api.protocols.{DashboardProtocol, DataSourceProtocol, DataTypeProtocol, PanelProtocol, PipelineProtocol, PipelineStepProtocol}

/** Spray-JSON helper surface for the `patch-set-apply-path` (HEL-406) files —
 *  mirrors `CombinedProposalServiceJson`/`PatchSetProtocol`'s own mixin list
 *  exactly, giving [[PatchSetApplyResolvers]]/[[PatchSetApplyService]]/
 *  [[PatchSetApplyRollback]] access to every existing per-resource request/
 *  response `RootJsonFormat` (decode `createPatch`, encode `priorState`/
 *  `resultingState` via each kind's EXISTING response shape) without
 *  duplicating any per-domain protocol trait. */
private[services] object PatchSetApplyServiceJson
    extends PanelProtocol
    with DashboardProtocol
    with DataSourceProtocol
    with DataTypeProtocol
    with PipelineProtocol
    with PipelineStepProtocol
