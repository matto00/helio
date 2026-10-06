package com.helio.services.pipelines

import com.helio.domain.util.Clock
import com.helio.domain.history.PayloadHistoryConfig
import com.helio.infrastructure.persistence.pipelines.RetentionPassOutcome.{LockBusy, Purged}
import com.helio.infrastructure.persistence.pipelines.{NodePayloadHistoryRepository, OutputHistoryRepository}
import OutputHistoryRetentionService.PartResult
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
 *  advisory lock, so a second instance or a restart only costs a redundant cheap pass.
 *
 *  HEL-1343: a part skipped because the advisory lock was held (`LockBusy`) is not a failure; if no
 *  part failed, the claimed slot is shortened (CAS on the exact claimed instance) so the next pass is
 *  due after `config.lockRetry` instead of `purgeInterval`. A failure keeps the full interval.
 *
 *  HEL-1276: after the summary thin/purge, in the same gate, the node-payload retention pass runs
 *  (tier age/count caps, downgraded tiers, payloads no surviving point references). Its failure is
 *  logged and never undoes or fails the summary purge. The payload repo/config are deliberately NOT
 *  defaulted so `Main` cannot compile without wiring them. */
class OutputHistoryRetentionService(
    repo: OutputHistoryRepository,
    config: OutputHistoryRetentionConfig,
    clock: Clock,
    payloadRepo: NodePayloadHistoryRepository,
    payloadConfig: PayloadHistoryConfig
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  /** The instant the next pass is due (`None` = due now). Holds the exact `Some` a claim stored, because
   *  the lock-held shortening is a reference-equality compare-and-set on that instance. */
  private val nextDue = new AtomicReference[Option[Instant]](None)

  def tick(): Future[Unit] = tickAt(clock.now())

  def tickAt(now: Instant): Future[Unit] = purgeIfDue(now).map(_ => ())

  /** `Some(deleted)` when the history thin/purge ran and succeeded; `None` when skipped (not due), failed, or
   *  the history part was skipped because another session held the retention lock. Never fails.
   *
   *  HEL-1343: when a part was lock-held and no part failed, the next pass is due after `lockRetry` rather
   *  than `purgeInterval`; a genuine failure keeps the full interval. */
  def purgeIfDue(now: Instant): Future[Option[Int]] =
    claim(now) match {
      case None => Future.successful(None)
      case Some(claimed) =>
        Future.delegate(repo.thinAndPurge(now, config.policy, config.maxAgeByTier))
          .map { outcome =>
            outcome match {
              case Purged(deleted) =>
                if (deleted > 0) log.info("Output history retention deleted {} point(s)", deleted)
                (PartResult.Ran(Option(deleted)): PartResult)
              case LockBusy => PartResult.Busy
            }
          }
          .recover { case NonFatal(e) =>
            log.error("Output history retention purge failed", e)
            PartResult.Failed
          }
          .flatMap { history =>
            purgePayloads(now).map { payload =>
              val failed = history == PartResult.Failed || payload == PartResult.Failed
              val busy   = history == PartResult.Busy || payload == PartResult.Busy
              if (busy && !failed) {
                log.debug("Output history retention skipped (lock held); retrying in {}", config.lockRetry)
                nextDue.compareAndSet(claimed, Some(now.plus(config.lockRetry)))
              }
              history match {
                case PartResult.Ran(result) => result
                case _                      => None
              }
            }
          }
    }

  /** Never fails: a payload-purge error is logged and reported as `Failed`. */
  private def purgePayloads(now: Instant): Future[PartResult] =
    Future.delegate(payloadRepo.purge(now, payloadConfig))
      .map {
        case Purged(deleted) =>
          if (deleted > 0) log.info("Node payload retention deleted {} payload(s)", deleted)
          (PartResult.Ran(None): PartResult)
        case LockBusy => PartResult.Busy
      }
      .recover { case NonFatal(e) =>
        log.error("Node payload retention purge failed", e)
        PartResult.Failed
      }

  /** Claims the slot (due iff `nextDue <= now`) by CAS and returns the exact `Some` stored, or `None`. */
  private def claim(now: Instant): Option[Some[Instant]] = {
    val prev = nextDue.get()
    if (!prev.forall(d => !d.isAfter(now))) None
    else {
      val stored = Some(now.plus(config.purgeInterval))
      if (nextDue.compareAndSet(prev, stored)) Some(stored) else None
    }
  }
}

object OutputHistoryRetentionService {

  /** One part (history thin/purge or payload purge) of a pass. */
  private sealed trait PartResult
  private object PartResult {
    final case class Ran(deleted: Option[Int]) extends PartResult
    case object Busy                           extends PartResult
    case object Failed                         extends PartResult
  }
}
