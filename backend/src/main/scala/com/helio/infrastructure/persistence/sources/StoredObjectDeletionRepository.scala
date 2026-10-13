package com.helio.infrastructure.persistence.sources

import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** One claimed `stored_object_deletions` row: the queue id and the storage key to remove. */
final case class QueuedObjectDeletion(id: Long, storageKey: String)

/** Persistence for the stored-object deletion queue (HEL-1434, V128). Triggers on `image_uploads` / `data_sources`
 *  enqueue the key of every deleted row; [[com.helio.services.sources.StoredObjectDeletionService]] drains it.
 *
 *  Every access is `DbContext.withSystemContext` (the privileged pool): the queue table is FORCE ROW LEVEL SECURITY
 *  with NO policy, so only a BYPASSRLS role can read or write it -- the app pool sees nothing by design.
 *
 *  No transaction stays open across a storage call: [[claim]] is one short statement that stamps a `claimed_at` lease
 *  (`FOR UPDATE SKIP LOCKED` inside the claim only), so two instances never double-process a row. */
class StoredObjectDeletionRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  /** Claims up to `limit` rows, oldest first: below the attempt cap, not leased (`claimed_at` null or older than
   *  `leaseExpiredBefore`), and past their exponential backoff (60 s x 2^(attempts-1), capped at 1 h, measured from
   *  `last_attempt_at`; a never-attempted row is due at once). */
  def claim(now: Instant, leaseExpiredBefore: Instant, maxAttempts: Int, limit: Int): Future[Vector[QueuedObjectDeletion]] = {
    val nowTs   = Timestamp.from(now)
    val staleTs = Timestamp.from(leaseExpiredBefore)
    ctx.withSystemContext(
      sql"""UPDATE stored_object_deletions
            SET claimed_at = $nowTs
            WHERE id IN (
              SELECT id FROM stored_object_deletions
              WHERE attempts < $maxAttempts
                AND (claimed_at IS NULL OR claimed_at < $staleTs)
                AND (last_attempt_at IS NULL
                     OR last_attempt_at <= ($nowTs)::timestamptz - LEAST(3600.0, 60.0 * power(2, attempts - 1)) * interval '1 second')
              ORDER BY id
              LIMIT $limit
              FOR UPDATE SKIP LOCKED)
            RETURNING id, storage_key"""
        .as[(Long, String)]
    ).map(_.map { case (id, key) => QueuedObjectDeletion(id, key) }.toVector)
  }

  /** True when a surviving `image_uploads` row or file-backed `data_sources` row still references `key`. The key
   *  expression is the trigger's own (`path`, legacy csv `filePath` fallback). */
  def isReferenced(key: String): Future[Boolean] =
    ctx.withSystemContext(
      sql"""SELECT EXISTS (SELECT 1 FROM image_uploads WHERE storage_key = $key)
               OR EXISTS (SELECT 1 FROM data_sources
                          WHERE source_type IN ('csv', 'text', 'pdf', 'image')
                            AND COALESCE(NULLIF(config ->> 'path', ''), NULLIF(config ->> 'filePath', '')) = $key)"""
        .as[Boolean]
    ).map(_.head)

  /** Removes a processed row. */
  def dequeue(id: Long): Future[Unit] =
    ctx.withSystemContext(sqlu"DELETE FROM stored_object_deletions WHERE id = $id").map(_ => ())

  /** Records a failed storage delete: bumps `attempts`, stamps `last_attempt_at`, and clears the lease. */
  def recordFailure(id: Long, now: Instant): Future[Unit] = {
    val nowTs = Timestamp.from(now)
    ctx.withSystemContext(
      sqlu"""UPDATE stored_object_deletions
             SET attempts = attempts + 1, last_attempt_at = $nowTs, claimed_at = NULL
             WHERE id = $id"""
    ).map(_ => ())
  }
}
