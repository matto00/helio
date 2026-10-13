package com.helio.services.sources

import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.sources.{KeyReference, QueuedObjectDeletion, StoredObjectDeletionRepository}
import com.helio.infrastructure.storage.FileSystem
import org.slf4j.LoggerFactory

import java.util.concurrent.atomic.AtomicBoolean
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** HEL-1434 / HEL-1530: drains the `stored_object_deletions` queue (V128, V132), one bounded pass per scheduler tick.
 *  Triggers enqueue the storage key of every deleted `image_uploads` / file-backed `data_sources` /
 *  `dataset_rows` (form-upload keys) / `assistant_conversations` row, including by TRUNCATE, so the object of a row
 *  removed by ANY path (a `users` cascade, raw SQL, a service delete) is eventually deleted. The queue only ever names
 *  keys of rows that were deleted (or, for a failed form append, keys no committed row holds), so a pass can never
 *  remove an object mid-upload.
 *
 *  A pass claims at most `batchSize` rows (short claim, lease, no transaction open across a storage call), classifies
 *  their keys once ([[StoredObjectDeletionRepository.classify]]) and then, per row:
 *   - authoritatively referenced (a row whose own delete re-queues the key): dequeued WITHOUT deleting;
 *   - referenced only by a derived copy (`binary_refs`, a snapshot / history / alert payload, a loosely matching
 *     dataset row): kept queued and deferred by `deferSeconds`, with no attempt counted, because nothing re-queues the
 *     key when the copy goes;
 *   - unreferenced: `FileSystem.delete` (idempotent), dequeued only after it succeeds.
 *  A failed delete keeps the row, bumps `attempts` (exponential backoff, attempt cap) and is logged by key and
 *  exception class only. [[runPass]] never fails; an in-flight guard keeps at most one pass running per process. */
final class StoredObjectDeletionService(
    repo: StoredObjectDeletionRepository,
    fileSystem: FileSystem,
    clock: Clock,
    batchSize: Int = StoredObjectDeletionService.DefaultBatchSize,
    maxAttempts: Int = StoredObjectDeletionService.DefaultMaxAttempts,
    leaseSeconds: Long = StoredObjectDeletionService.DefaultLeaseSeconds,
    deferSeconds: Long = StoredObjectDeletionService.DefaultDeferSeconds
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val inFlight = new AtomicBoolean(false)

  /** One pass; completes with the number of objects deleted. A pass already running in this process makes this a
   *  no-op returning 0. Never fails. */
  def runPass(): Future[Int] =
    if (!inFlight.compareAndSet(false, true)) Future.successful(0)
    else
      Future.unit
        .flatMap(_ => pass())
        .recover { case NonFatal(e) =>
          log.error(s"Stored-object deletion pass failed: ${ImplicitConnectorCleanup.describeFailure(e)}")
          0
        }
        .andThen { case _ => inFlight.set(false) }

  private def pass(): Future[Int] = {
    val now = clock.now()
    repo.claim(now, now.minusSeconds(leaseSeconds), leaseSeconds, maxAttempts, batchSize).flatMap { claimed =>
      if (claimed.isEmpty) Future.successful(0)
      else
        repo.classify(claimed.map(_.storageKey)).flatMap { references =>
          claimed.foldLeft(Future.successful(0)) { (acc, row) =>
            acc.flatMap(count => process(row, references(row.storageKey)).map(deleted => if (deleted) count + 1 else count))
          }
        }
    }
  }

  /** `true` when this call deleted the object. A failure on one row is recorded and never stops its siblings. */
  private def process(row: QueuedObjectDeletion, reference: KeyReference): Future[Boolean] =
    (reference match {
      case KeyReference.Authoritative => repo.dequeue(row.id).map(_ => false)
      case KeyReference.DerivedOnly   => repo.defer(row.id, clock.now().plusSeconds(deferSeconds)).map(_ => false)
      case KeyReference.Unreferenced  => fileSystem.delete(row.storageKey).flatMap(_ => repo.dequeue(row.id)).map(_ => true)
    }).recoverWith { case NonFatal(e) =>
      log.warn(s"Stored-object deletion failed for ${row.storageKey}: ${ImplicitConnectorCleanup.describeFailure(e)}")
      repo.recordFailure(row.id, clock.now()).recover { case NonFatal(_) => () }.map(_ => false)
    }
}

object StoredObjectDeletionService {
  val DefaultBatchSize: Int     = 100
  val DefaultMaxAttempts: Int   = 10
  val DefaultLeaseSeconds: Long = 300L
  val DefaultDeferSeconds: Long = 3600L
}
