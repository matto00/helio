package com.helio.services.pipelines

import com.helio.domain.model.{AuthenticatedUser, DataSourceId}
import com.helio.services.ServiceError
import com.helio.services.sources.InlineSourceCleanup

import scala.collection.mutable.ArrayBuffer
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** HEL-1469 / HEL-1475: inline root sources are created by `SourceService`/`DataSourceService` as their own committed
 *  writes, outside any pipeline transaction, so a failure after creation cannot roll them back. On a `Left` or a
 *  failed Future from `body`, delete every `(id, implicitConnector)` recorded in `created` through
 *  [[InlineSourceCleanup]] (as the user) BEFORE returning the ORIGINAL `Left` or re-raising the ORIGINAL exception.
 *  `created` is read when the failure happens, so `body` can keep appending to it as it creates sources. A cleanup
 *  failure is logged by the cleanup and never replaces the original error. Not crash-atomic (see [[InlineSourceCleanup]]). */
private[pipelines] object InlineSourceCompensation {

  def compensating[T](
      cleanup: InlineSourceCleanup,
      created: ArrayBuffer[(DataSourceId, Boolean)],
      user: AuthenticatedUser,
      context: String
  )(body: => Future[Either[ServiceError, T]])(implicit ec: ExecutionContext): Future[Either[ServiceError, T]] =
    Future.unit.flatMap(_ => body).transformWith {
      case Success(right @ Right(_)) => Future.successful(right)
      case Success(left)             => deleteAll(cleanup, created.toVector, user, context).map(_ => left)
      case Failure(ex)               => deleteAll(cleanup, created.toVector, user, context).flatMap(_ => Future.failed(ex))
    }

  private def deleteAll(cleanup: InlineSourceCleanup, ids: Vector[(DataSourceId, Boolean)], user: AuthenticatedUser, context: String)(implicit ec: ExecutionContext): Future[Unit] =
    ids.foldLeft(Future.unit) { (accF, entry) =>
      accF.flatMap(_ => cleanup.deleteCallCreated(entry._1, entry._2, user, context).map(_ => ()))
    }
}
