package com.helio.services.pipelines

import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.pipelines.OutputHistoryRepository
import org.slf4j.LoggerFactory

import java.time.Instant
import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** HEL-1272: thins and purges Output history on the existing scheduler tick (no dedicated timer),
 *  at most once per `config.purgeInterval` per process. The slot is claimed by compare-and-set
 *  BEFORE the repository call, so overlapping callers run at most one purge and a persistently
 *  failing purge retries once per interval rather than every tick. The gate is in-process (no
 *  migration); the purge is idempotent and the repo serialises concurrent instances with an
 *  advisory lock, so a second instance or a restart only costs a redundant cheap pass. */
class OutputHistoryRetentionService(
    repo: OutputHistoryRepository,
    config: OutputHistoryRetentionConfig,
    clock: Clock
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val lastAttempt = new AtomicReference[Option[Instant]](None)

  def tick(): Future[Unit] = tickAt(clock.now())

  def tickAt(now: Instant): Future[Unit] = purgeIfDue(now).map(_ => ())

  /** `Some(deleted)` when a purge ran and succeeded; `None` when skipped (not due) or failed. Never fails. */
  def purgeIfDue(now: Instant): Future[Option[Int]] =
    if (!claim(now)) Future.successful(None)
    else
      Future.delegate(repo.thinAndPurge(now, config.policy, config.maxAgeByTier))
        .map { deleted =>
          if (deleted > 0) log.info("Output history retention deleted {} point(s)", deleted)
          Option(deleted)
        }
        .recover { case NonFatal(e) =>
          log.error("Output history retention purge failed", e)
          None
        }

  private def claim(now: Instant): Boolean = {
    val prev = lastAttempt.get()
    val due  = prev.forall(l => !l.plus(config.purgeInterval).isAfter(now))
    due && lastAttempt.compareAndSet(prev, Some(now))
  }
}
