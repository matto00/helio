package com.helio.services.dashboards

import com.helio.domain.model.{AuthenticatedUser, DashboardChange}
import com.helio.domain.util.{Clock, SystemClock}
import com.helio.infrastructure.persistence.dashboards.DashboardChangesRepository
import com.helio.services.ServiceError

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** `GET /api/dashboard-changes` (HEL-1575): validates the id list and reports, for the dashboards the caller can read,
 *  when each was last edited and last received new data. Ids the caller cannot read are omitted, never refused. */
final class DashboardChangesService(repo: DashboardChangesRepository, clock: Clock = SystemClock)(implicit
    ec: ExecutionContext
) {

  def changes(rawIds: String, user: AuthenticatedUser): Future[Either[ServiceError, (Instant, Vector[DashboardChange])]] = {
    val ids = rawIds.split(",", -1).toVector.map(_.trim)
    if (ids.exists(_.isEmpty))
      Future.successful(Left(ServiceError.BadRequest("ids must be a non-empty comma-separated list of dashboard ids")))
    else if (ids.size > DashboardChangesService.MaxIds)
      Future.successful(Left(ServiceError.BadRequest(s"ids holds at most ${DashboardChangesService.MaxIds} dashboard ids")))
    else {
      val serverNow = clock.now()
      repo.changes(user.id, ids).map(items => Right((serverNow, items)))
    }
  }
}

object DashboardChangesService {
  val MaxIds: Int = 20
}
