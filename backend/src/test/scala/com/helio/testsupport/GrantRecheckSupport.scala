package com.helio.testsupport

import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.domain.model.{DashboardId, DataSourceId, PanelId, PipelineId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.PipelineRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.auth.AccessChecker

import scala.concurrent.ExecutionContext

/** HEL-1882: the production access checker (the same registry shape `ApiRoutes` builds) over a spec's `DbContext`, so a
 *  service-level race spec admits and refuses exactly as the route does. */
object GrantRecheckSupport {

  def accessChecker(ctx: DbContext)(implicit ec: ExecutionContext): AccessChecker = {
    val dataSourceRepo = new DataSourceRepository(ctx)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
    val dashboardRepo  = new DashboardRepository(ctx)
    val panelRepo      = new PanelRepository(ctx)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    new AccessCheckerImpl(new ResourcePermissionRepository(ctx), registry)
  }
}
