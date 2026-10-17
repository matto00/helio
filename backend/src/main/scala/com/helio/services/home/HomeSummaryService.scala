package com.helio.services.home

import com.helio.domain.model.AuthenticatedUser
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.home.HomeSummaryRepository
import com.helio.services.ServiceError
import com.helio.services.dashboards.DashboardChangesService

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1578: `GET /api/home-summary`. One owner-scoped read, then pure derivation ([[HomeSummaryBuilder]]).
 *
 *  `dashboardIds` (Phase B, design D5) returns `dashboardChanges` by REUSING HEL-1575's [[DashboardChangesService]]
 *  verbatim: its id validation (at most 20, no empty id -> `400`), its RLS-scoped content/data queries and its
 *  omission of ids the caller cannot read. Home adds no second change-signal query. */
class HomeSummaryService(repo: HomeSummaryRepository, changes: DashboardChangesService, clock: Clock)(implicit
    ec: ExecutionContext
) {

  def summary(user: AuthenticatedUser, dashboardIds: Option[String]): Future[Either[ServiceError, HomeSummary]] = {
    val now = clock.now()
    // Validate (and read) the dashboard ids first so a bad request costs no pipeline query.
    val changesF: Future[Either[ServiceError, Vector[HomeDashboardChange]]] = dashboardIds match {
      case None => Future.successful(Right(Vector.empty))
      case Some(raw) =>
        changes.changes(raw, user).map(_.map { case (_, items) =>
          items.map(c => HomeDashboardChange(c.dashboardId, Some(c.contentUpdatedAt), c.dataUpdatedAt))
        })
    }
    changesF.flatMap {
      case Left(error) => Future.successful(Left(error))
      case Right(dashboardChanges) =>
        repo.load(user, now.minusSeconds(HomeSummaryLimits.WindowHours * 3600L)).map { rows =>
          Right(HomeSummaryBuilder.build(rows, now).copy(dashboardChanges = dashboardChanges))
        }
    }
  }
}
