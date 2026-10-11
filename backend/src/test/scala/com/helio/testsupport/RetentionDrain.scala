package com.helio.testsupport

import com.helio.domain.history.HistoryBaselineLimits
import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.pipelines.{HistoryPassOutcome, HistoryThinningPolicy, OutputHistoryRepository, RetentionPassOutcome, ThinBatchLimits}

import java.time.{Duration, Instant}
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1477: the one-call "drain a whole thin cycle" form, moved out of production code (it was
 *  `OutputHistoryRepository.thinAndPurge`, test-only). Built on the public `thinPass` only. Import
 *  `RetentionDrain._` to call `repo.thinAndPurge(...)` exactly as before. A lock-held skip anywhere is `LockBusy`. */
object RetentionDrain {

  implicit final class ThinAndPurge(private val repo: OutputHistoryRepository) extends AnyVal {

    def thinAndPurge(
        now: Instant,
        policy: HistoryThinningPolicy,
        maxAgeByTier: Map[UserTier, Duration],
        protectedNewest: Int = HistoryBaselineLimits.ProtectedNewestPoints,
        limits: ThinBatchLimits = ThinBatchLimits.Defaults
    )(implicit ec: ExecutionContext): Future[RetentionPassOutcome] = {
      def drain(cursor: Option[String], deleted: Int): Future[RetentionPassOutcome] =
        repo.thinPass(now, policy, maxAgeByTier, limits, cursor, protectedNewest).flatMap {
          case HistoryPassOutcome.Completed(d)    => Future.successful(RetentionPassOutcome.Purged(deleted + d))
          case HistoryPassOutcome.MoreWork(d, at) => drain(Some(at), deleted + d)
          case HistoryPassOutcome.LockHeld(_, _)  => Future.successful(RetentionPassOutcome.LockBusy)
        }
      drain(None, 0)
    }
  }
}
