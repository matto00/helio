package com.helio.services.pipelines

import com.helio.domain.util.Clock
import com.helio.domain.history.{HistoryBaselineLimits, PayloadHistoryConfig}
import com.helio.infrastructure.persistence.pipelines.RetentionPassOutcome.{LockBusy, Purged}
import com.helio.infrastructure.persistence.pipelines.{HistoryPassOutcome, NodePayloadHistoryRepository, OutputHistoryRepository}
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
    payloadConfig: PayloadHistoryConfig,
    /** HEL-1285: newest points per Output thinning never deletes. Fixed by default; tests pass a smaller value. */
    protectedNewest: Int = HistoryBaselineLimits.ProtectedNewestPoints
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  /** Where the current thin cycle resumes (the last Output thinned); `None` = from the start. */
  private val cursor = new AtomicReference[Option[String]](None)

  /** The instant the next pass is due (`None` = due now). Holds the exact `Some` a claim stored, because
   *  the lock-held shortening is a reference-equality compare-and-set on that instance. */
  private val nextDue = new AtomicReference[Option[Instant]](None)

  def tick(): Future[Unit] = tickAt(clock.now())

  def tickAt(now: Instant): Future[Unit] = purgeIfDue(now).map(_ => ())

  /** `Some(deleted)` when the history part ran and succeeded (a complete cycle or a budget-exhausted pass);
   *  `None` when skipped (not due), failed, or the history part was skipped because another session held the
   *  retention lock. Never fails.
   *
   *  Next-due PRECEDENCE over every part of the pass (HEL-1435): any part failed, the full `purgeInterval`
   *  (HEL-1343); else any part lock-held, `lockRetry`; else the thin budget exhausted with Outputs remaining,
   *  the next scheduler tick; else (cycle complete) `purgeInterval` and the cursor resets. The cursor
   *  (last Output thinned this cycle) is in-process, like `nextDue`; a restart restarts the cycle (idempotent). */
  def purgeIfDue(now: Instant): Future[Option[Int]] =
    claim(now) match {
      case None => Future.successful(None)
      case Some(claimed) =>
        Future.delegate(repo.thinPass(now, config.policy, config.maxAgeByTier, config.thinLimits, cursor.get(), protectedNewest))
          .map { outcome =>
            outcome match {
              case HistoryPassOutcome.Completed(deleted) =>
                cursor.set(None)
                logDeleted(deleted)
                (PartResult.Ran(Option(deleted), moreWork = false): PartResult)
              case HistoryPassOutcome.MoreWork(deleted, at) =>
                cursor.set(Some(at))
                logDeleted(deleted)
                PartResult.Ran(Option(deleted), moreWork = true)
              case HistoryPassOutcome.LockHeld(_, at) =>
                cursor.set(at)
                PartResult.Busy
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
              val more   = history match {
                case PartResult.Ran(_, moreWork) => moreWork
                case _                           => false
              }
              if (busy && !failed) {
                log.debug("Output history retention skipped (lock held); retrying in {}", config.lockRetry)
                nextDue.compareAndSet(claimed, Some(now.plus(config.lockRetry)))
              } else if (more && !failed) {
                nextDue.compareAndSet(claimed, Some(now))
              }
              history match {
                case PartResult.Ran(result, _) => result
                case _                         => None
              }
            }
          }
    }

  private def logDeleted(deleted: Int): Unit =
    if (deleted > 0) log.info("Output history retention deleted {} point(s)", deleted)

  /** Never fails: a payload-purge error is logged and reported as `Failed`. */
  private def purgePayloads(now: Instant): Future[PartResult] =
    Future.delegate(payloadRepo.purge(now, payloadConfig))
      .map {
        case Purged(deleted) =>
          if (deleted > 0) log.info("Node payload retention deleted {} payload(s)", deleted)
          (PartResult.Ran(None, moreWork = false): PartResult)
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
    final case class Ran(deleted: Option[Int], moreWork: Boolean) extends PartResult
    case object Busy                           extends PartResult
    case object Failed                         extends PartResult
  }
}
