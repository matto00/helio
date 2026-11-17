package com.helio.services.panels

import com.helio.services.ServiceError
import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.domain.model.{AuthenticatedUser, DashboardId, Panel}
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1638 D3: runs `PanelService.create`'s own build checks (config decode, appearance, Output/data-source bindings,
 *  `panel.validateConfig`, controls, form consistency) for a panel that is not being created, so a proposal or patch-set
 *  preview rejects what apply would. It is [[PanelCreateBuilder.dryRunForCreate]] -- the same code `create` runs -- over a
 *  placeholder dashboard id (the build never reads the dashboard). `controlsValidator` null skips the controls check. */
private[services] final class PanelCreateDryRun(
    outputRepo: OutputRepository,
    dataSourceRepo: DataSourceRepository,
    controlsValidator: OutputControlsValidator
)(implicit ec: ExecutionContext) {

  private val builder = new PanelCreateBuilder(new PanelBindingChecks(outputRepo, dataSourceRepo), controlsValidator)

  private val updateValidation = new PanelUpdateValidation(new PanelBindingChecks(outputRepo, dataSourceRepo), controlsValidator)

  /** `PanelService.update`'s post-authorize validation chain over the effective (post-patch) config; writes nothing. */
  def checkUpdate(existing: Panel, request: UpdatePanelRequest, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    updateValidation.validate(existing, request, user).map(_.map(_ => ()))

  def check(request: CreatePanelRequest, user: AuthenticatedUser, binding: PanelCreateBuilder.Binding): Future[Either[ServiceError, Unit]] =
    builder.dryRunForCreate(PanelCreateDryRun.PlaceholderDashboardId, request, user, binding).map(_.map(_ => ()))
}

private[services] object PanelCreateDryRun {
  val PlaceholderDashboardId: DashboardId = DashboardId("00000000-0000-0000-0000-000000000000")
}
