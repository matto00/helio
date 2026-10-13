package com.helio.services.panels

import com.helio.domain.model.Dashboard
import com.helio.services.ServiceError

import scala.concurrent.{ExecutionContext, Future}

/** The shared conflict policy of the two compare-and-set layout writers, `DashboardWrites` and `AutoLayoutService`
 *  (HEL-1457). One attempt reads what it needs from a dashboard row, resolves its write against that row's layout
 *  and tries to store it, conditional on the row's `layoutVersion`.
 *
 *  - A caller `expected` version that is not the version just read is refused at once with `LayoutConflict(existing)`:
 *    the write would be resolved against a layout the caller never saw, so it must not be merged and stored.
 *  - A caller with no `expected` version gets up to [[MaxAttempts]] attempts: each miss hands back the row as it now
 *    is and the write is resolved against that, so it never overwrites a layout it did not read. After the last
 *    miss, or on any miss when `expected` was given, the result is `LayoutConflict(current)`. */
object LayoutCasRetry {

  val MaxAttempts: Int = 3

  sealed trait Attempt
  object Attempt {
    final case class Finished(result: Either[ServiceError, Dashboard]) extends Attempt
    /** The version moved before the write landed; nothing was stored. `current` is the row as it now is. */
    final case class Moved(current: Dashboard) extends Attempt
  }

  def run(initial: Dashboard, expected: Option[Long])(attempt: Dashboard => Future[Attempt])(
      implicit ec: ExecutionContext
  ): Future[Either[ServiceError, Dashboard]] = {
    def go(existing: Dashboard, attemptNumber: Int): Future[Either[ServiceError, Dashboard]] =
      if (expected.exists(_ != existing.layoutVersion)) Future.successful(Left(ServiceError.LayoutConflict(existing)))
      else
        attempt(existing).flatMap {
          case Attempt.Finished(result) => Future.successful(result)
          case Attempt.Moved(current) =>
            if (expected.isDefined || attemptNumber >= MaxAttempts) Future.successful(Left(ServiceError.LayoutConflict(current)))
            else go(current, attemptNumber + 1)
        }
    go(initial, 1)
  }
}
