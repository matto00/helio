package com.helio.api.routes.dashboards

import com.helio.api.protocols.panels.PublicFormSchemaResponse
import com.helio.domain.model._
import com.helio.domain.panels.FormPanel
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1587 design D2: the declarations of the fields a `form` panel binds, for the public read-only form preview.
 *  Called only after `authorizeResourceWithSharing` admitted the caller for `dashboardId`.
 *
 *  Read path (pinned at the design gate):
 *   - the panel is found among THIS dashboard's panels (`findAllByDashboardId`, `accessAlreadyGranted = true`), so a panel
 *     of another dashboard is never resolved;
 *   - the declaration is read on the APP pool in the form OWNER's database context
 *     (`DataSourceRepository.getDeclaredSchemaOwnedBy`), never `withSystemContext` and never an `*Internal` read: RLS
 *     admits only a dataset the form owner can read, and the read's own `owner_id` predicate holds under any role.
 *  Every "cannot resolve" case is the same `NotFound("Panel not found")`. */
final class PublicFormSchemaResolver(
    panelRepo: PanelRepository,
    dataSourceRepo: DataSourceRepository,
    userOpt: Option[AuthenticatedUser]
)(implicit executionContext: ExecutionContext) {

  private val notFound = Left(ServiceError.NotFound("Panel not found"))

  def resolveFormSchema(dashboardId: String, panelId: String): Future[Either[ServiceError, PublicFormSchemaResponse]] =
    panelRepo.findAllByDashboardId(DashboardId(dashboardId), userOpt, Page(offset = 0, limit = Page.MaxLimit), accessAlreadyGranted = true).flatMap { paged =>
      paged.items.find(_.id.value == panelId) match {
        case Some(form: FormPanel) =>
          dataSourceRepo.getDeclaredSchemaOwnedBy(form.config.dataSourceId, form.ownerId).map {
            case None => notFound
            case Some(declaration) =>
              val bound = form.config.fields.map(_.sourceField).toSet
              Right(PublicFormSchemaResponse.fromDomain(declaration.filter(f => bound.contains(f.name))))
          }
        case _ => Future.successful(notFound)
      }
    }
}
