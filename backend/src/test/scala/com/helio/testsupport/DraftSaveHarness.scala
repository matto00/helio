package com.helio.testsupport

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.alerts.{AlertEventRepository, AlertRuleRepository}
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{LockSite, NodeSnapshotRepository, OutputHistoryRepository, OutputRepository, PipelineDefinitionLocks, PipelineRepository, PipelineRootRepository, PipelineScheduleRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
import com.helio.services.pipelines.draft.{DraftSaveHooks, DraftSaveService}

import scala.concurrent.ExecutionContext

/** A lock set with some sites removed: the recorded mutation the race, deadlock and fault specs owe (HEL-1629). */
final case class LocksWithout(removed: Set[LockSite]) extends PipelineDefinitionLocks {
  def active(site: LockSite): Boolean = !removed.contains(site)
}

object LocksWithout {
  def apply(sites: LockSite*): LocksWithout = new LocksWithout(sites.toSet)
}

/** The repositories and the draft save service built over one `DbContext` with one lock set and one hook set, so a spec can
 *  run the REAL production code with exactly one protocol lock removed or the save parked at a known point. */
final class DraftSaveHarness(
    val ctx: DbContext,
    val locks: PipelineDefinitionLocks = PipelineDefinitionLocks.Enforced,
    val hooks: DraftSaveHooks = DraftSaveHooks.None
)(implicit ec: ExecutionContext) {
  val dataSourceRepo  = new DataSourceRepository(ctx, locks)
  val pipelineRepo    = new PipelineRepository(ctx, dataSourceRepo)
  val stepRepo        = new PipelineStepRepository(ctx, locks)
  val outputRepo      = new OutputRepository(ctx, locks)
  val rootRepo        = new PipelineRootRepository(ctx, locks)
  val scheduleRepo    = new PipelineScheduleRepository(ctx, locks)
  val panelRepo       = new PanelRepository(ctx)
  val dashboardRepo   = new DashboardRepository(ctx)
  val alertRuleRepo   = new AlertRuleRepository(ctx)
  val alertEventRepo  = new AlertEventRepository(ctx)
  val nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
  val outputHistoryRepo = new OutputHistoryRepository(ctx)
  val applicationRepo = new PatchSetApplicationRepository(ctx)
  val auditRepo       = new AuditEventRepository(ctx)
  val teardownRepo    = new WorkspaceTeardownRepository(ctx, locks)
  val service = new DraftSaveService(
    pipelineRepo, stepRepo, outputRepo, panelRepo, dataSourceRepo, rootRepo, applicationRepo, auditRepo, null, locks, hooks
  )
}
