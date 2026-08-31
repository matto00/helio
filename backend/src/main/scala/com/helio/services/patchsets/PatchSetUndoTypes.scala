package com.helio.services.patchsets

import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository

/** Read-side collaborators [[PatchSetUndoConflictCheck]]'s Phase-1 pass and [[PatchSetUndoService]]'s
 *  Phase-2 restore walk both need — bundled so a call doesn't need an unwieldy positional repo
 *  list, mirroring [[PatchSetApplyContext]]'s identical role for the apply path. No
 *  `accessChecker`/`metricRepo` here (unlike `PatchSetApplyContext`) — undo never re-runs the
 *  apply path's embedded cross-resource reference validation (design.md D4/D4a only re-checks
 *  each edit's OWN captured fields against current live state, never a fresh ACL/reference
 *  resolve), and the caller's own ownership of the WHOLE application is already established by
 *  `PatchSetApplicationRepository.findById`'s RLS + owner check before either of these ever
 *  runs. */
// HEL-904 task 3.3: `dataTypeRepo` REMOVED outright -- `dataType` is no
// longer a valid target.kind, so nothing here ever reads it.
private[services] final case class PatchSetUndoContext(
    panelRepo: PanelRepository,
    dashboardRepo: DashboardRepository,
    dataSourceRepo: DataSourceRepository,
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository
)
