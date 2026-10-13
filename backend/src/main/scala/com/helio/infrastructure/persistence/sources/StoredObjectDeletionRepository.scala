package com.helio.infrastructure.persistence.sources

import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsArray, JsString}

import java.sql.Timestamp
import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** One claimed `stored_object_deletions` row: the queue id and the storage key to remove. */
final case class QueuedObjectDeletion(id: Long, storageKey: String)

/** Live queue sizes for the owner admin view: every queued row, and those at the attempt cap (HEL-1531). */
final case class QueueCounts(queued: Long, stuck: Long)

/** What still references a queued key (HEL-1530, design.md D5).
 *
 *  - [[Authoritative]]: a row whose own delete re-queues this exact key, so the entry is dequeued without deleting.
 *  - [[DerivedOnly]]: only a copy (a `binary_refs` row, a snapshot / history / alert payload, or a dataset row that
 *    names the key outside what its delete would queue). The entry stays queued, deferred, and is re-checked later:
 *    dropping it would leak the object for good, because nothing re-queues the key when the copy goes.
 *  - [[Unreferenced]]: nothing holds the key; the object is deleted. */
sealed trait KeyReference
object KeyReference {
  case object Authoritative extends KeyReference
  case object DerivedOnly   extends KeyReference
  case object Unreferenced  extends KeyReference
}

/** Persistence for the stored-object deletion queue (HEL-1434, V128; extended by HEL-1530, V132). Triggers on
 *  `image_uploads` / `data_sources` / `dataset_rows` / `assistant_conversations` (and TRUNCATE of each) enqueue the key
 *  of every deleted row; [[com.helio.services.sources.StoredObjectDeletionService]] drains it.
 *
 *  Every access is `DbContext.withSystemContext` (the privileged pool): the queue table is FORCE ROW LEVEL SECURITY
 *  with NO policy, so only a BYPASSRLS role can read or write it -- the app pool sees nothing by design.
 *
 *  Two kinds of queue row share the table (V132, design.md D6). LEGACY rows (V128's two triggers; `not_before` null)
 *  are leased through `claimed_at`. NEW-STYLE rows (V132's triggers, [[enqueue]], and every deferral; `not_before`
 *  non-null) carry `claimed_at = 'infinity'` for good, so V128-era claim SQL in an older revision can never match
 *  them, and are leased through `lease_until` and held back through `not_before`.
 *
 *  No transaction stays open across a storage call: [[claim]] is one short statement that stamps a lease
 *  (`FOR UPDATE SKIP LOCKED` inside the claim only), so two instances never double-process a row. */
class StoredObjectDeletionRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  /** Claims up to `limit` rows, oldest first, below the attempt cap.
   *  LEGACY: not leased (`claimed_at` null or older than `leaseExpiredBefore`) and past the exponential backoff
   *  (60 s x 2^(attempts-1), capped at 1 h, from `last_attempt_at`; a never-attempted row is due at once).
   *  NEW-STYLE: `not_before` reached and no live `lease_until`; the lease is stamped to `now + leaseSeconds`. */
  def claim(now: Instant, leaseExpiredBefore: Instant, leaseSeconds: Long, maxAttempts: Int, limit: Int): Future[Vector[QueuedObjectDeletion]] = {
    val nowTs    = Timestamp.from(now)
    val staleTs  = Timestamp.from(leaseExpiredBefore)
    val leaseTs  = Timestamp.from(now.plusSeconds(leaseSeconds))
    ctx.withSystemContext(
      sql"""UPDATE stored_object_deletions
            SET claimed_at  = CASE WHEN not_before IS NULL THEN $nowTs ELSE claimed_at END,
                lease_until = CASE WHEN not_before IS NULL THEN lease_until ELSE $leaseTs END
            WHERE id IN (
              SELECT id FROM stored_object_deletions
              WHERE attempts < $maxAttempts
                AND ((not_before IS NULL
                      AND (claimed_at IS NULL OR claimed_at < $staleTs)
                      AND (last_attempt_at IS NULL
                           OR last_attempt_at <= ($nowTs)::timestamptz - LEAST(3600.0, 60.0 * power(2, attempts - 1)) * interval '1 second'))
                  OR (not_before IS NOT NULL
                      AND claimed_at = 'infinity'
                      AND not_before <= ($nowTs)::timestamptz
                      AND (lease_until IS NULL OR lease_until < ($nowTs)::timestamptz)))
              ORDER BY id
              LIMIT $limit
              FOR UPDATE SKIP LOCKED)
            RETURNING id, storage_key"""
        .as[(Long, String)]
    ).map(_.map { case (id, key) => QueuedObjectDeletion(id, key) }.toVector)
  }

  /** Re-arms rows stuck at the attempt cap whose last attempt is at or before `cutoff` (HEL-1531, design.md D1):
   *  `attempts` back to 0 and the lease cleared, so the normal claim and backoff apply again. A new-style row
   *  (`not_before` non-null) keeps `claimed_at = 'infinity'`; a legacy row's `claimed_at` is cleared. A capped row
   *  with no `last_attempt_at` is left stuck (hand SQL only; the drain always stamps it). Returns rows re-armed. */
  def rearm(cutoff: Instant, maxAttempts: Int): Future[Int] = {
    val cutoffTs = Timestamp.from(cutoff)
    ctx.withSystemContext(
      sqlu"""UPDATE stored_object_deletions
             SET attempts    = 0,
                 claimed_at  = CASE WHEN not_before IS NULL THEN NULL ELSE claimed_at END,
                 lease_until = NULL
             WHERE attempts >= $maxAttempts
               AND last_attempt_at IS NOT NULL
               AND last_attempt_at <= $cutoffTs"""
    )
  }

  /** Queue size and the number of rows at the attempt cap, in one statement. Privileged pool: the app pool would
   *  read 0 rows (FORCE RLS, no policy) without any error. */
  def queueCounts(maxAttempts: Int): Future[QueueCounts] =
    ctx.withSystemContext(
      sql"""SELECT count(*), count(*) FILTER (WHERE attempts >= $maxAttempts) FROM stored_object_deletions"""
        .as[(Long, Long)].head
    ).map { case (queued, stuck) => QueueCounts(queued, stuck) }

  /** Classifies each of `keys` once for the whole claimed batch (one statement per table family, not per key).
   *  Authoritative holders are `image_uploads`, file-backed `data_sources` (the trigger's own key expression),
   *  `assistant_conversations.gcs_body_ref`, and a `dataset_rows` row whose delete would queue the key (V132's
   *  `lax $.**.storageKey` extraction + form-upload regex). Derived holders are `binary_refs.storage_key` and a quoted
   *  occurrence of the key in `node_snapshots.data`, `node_payload_history.rows`, `alert_events.value` or any other
   *  `dataset_rows.data` text. Keys are UUID-unique, so a substring false positive only delays a delete. */
  def classify(keys: Seq[String]): Future[Map[String, KeyReference]] =
    if (keys.isEmpty) Future.successful(Map.empty)
    else {
      val keysJson = JsArray(keys.distinct.map(JsString(_)).toVector).compactPrint
      ctx.withSystemContext(
        for {
          authoritative <- authoritativeAction(keysJson)
          remaining      = keys.distinct.filterNot(authoritative.contains)
          derived       <- if (remaining.isEmpty) DBIO.successful(Set.empty[String])
                           else derivedAction(JsArray(remaining.map(JsString(_)).toVector).compactPrint)
        } yield keys.distinct.map { k =>
          k -> (if (authoritative.contains(k)) KeyReference.Authoritative
                else if (derived.contains(k)) KeyReference.DerivedOnly
                else KeyReference.Unreferenced)
        }.toMap
      )
    }

  private def authoritativeAction(keysJson: String): DBIO[Set[String]] =
    sql"""WITH wanted(k) AS (SELECT jsonb_array_elements_text(($keysJson)::jsonb))
          SELECT k FROM wanted
          WHERE EXISTS (SELECT 1 FROM image_uploads WHERE storage_key = k)
             OR EXISTS (SELECT 1 FROM data_sources
                        WHERE source_type IN ('csv', 'text', 'pdf', 'image')
                          AND COALESCE(NULLIF(config ->> 'path', ''), NULLIF(config ->> 'filePath', '')) = k)
             OR EXISTS (SELECT 1 FROM assistant_conversations WHERE gcs_body_ref = k)
          UNION
          SELECT DISTINCT v #>> '{}'
          FROM dataset_rows r
          CROSS JOIN LATERAL jsonb_path_query(r.data, 'lax $$.**.storageKey') AS v
          WHERE strpos(r.data::text, 'form-uploads/') > 0
            AND jsonb_typeof(v) = 'string'
            AND (v #>> '{}') IN (SELECT k FROM wanted)
            AND (v #>> '{}') ~ '^form-uploads/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]{1,16}$$'"""
      .as[String].map(_.toSet)

  /** One scan per JSONB table. The row text is computed once per row (LATERAL, `OFFSET 0` pins it) and is first
   *  tested against the few distinct key prefixes of the batch (`"images`, `"form-uploads`, ...); only a row that
   *  mentions a prefix is compared with every wanted quoted key. Without the prefix gate the join runs
   *  rows x keys substring searches (measured: 39 s against 1.6 M snapshot rows and 100 keys, 2.4 s with it; see
   *  this change's measurements.md). A key is quoted, so `"<prefix>` is a necessary condition of a hit. */
  private def derivedAction(keysJson: String): DBIO[Set[String]] = {
    def scan(table: String, column: String): String =
      s"""SELECT hit.k FROM $table t
         |  CROSS JOIN LATERAL (SELECT t.$column::text AS txt OFFSET 0) x
         |  CROSS JOIN LATERAL (SELECT q.k FROM quoted q WHERE strpos(x.txt, q.q) > 0) hit
         |  WHERE EXISTS (SELECT 1 FROM prefixes pf WHERE strpos(x.txt, pf.p) > 0)""".stripMargin
    val scans = Seq(("node_snapshots", "data"), ("node_payload_history", "rows"), ("alert_events", "value"), ("dataset_rows", "data"))
      .map { case (t, c) => scan(t, c) }.mkString("\n UNION\n ")
    // Table and column names are constants above, never caller input.
    sql"""WITH wanted(k) AS (SELECT jsonb_array_elements_text(($keysJson)::jsonb)),
               quoted(k, q) AS (SELECT k, '"' || k || '"' FROM wanted),
               prefixes(p) AS (SELECT DISTINCT '"' || split_part(k, '/', 1) FROM wanted)
          SELECT k FROM wanted WHERE EXISTS (SELECT 1 FROM binary_refs WHERE storage_key = k)
          UNION
          #$scans"""
      .as[String].map(_.toSet)
  }

  /** Removes a processed row. */
  def dequeue(id: Long): Future[Unit] =
    ctx.withSystemContext(sqlu"DELETE FROM stored_object_deletions WHERE id = $id").map(_ => ())

  /** Holds a claimed row back until `notBefore` without counting an attempt (a derived copy still holds the key).
   *  A legacy row is converted to a new-style one (`claimed_at = 'infinity'`), so it stays unclaimable by V128-era
   *  SQL and is not claimed again by its old lease path. Clears the lease. */
  def defer(id: Long, notBefore: Instant): Future[Unit] = {
    val ts = Timestamp.from(notBefore)
    ctx.withSystemContext(
      sqlu"""UPDATE stored_object_deletions
             SET not_before = $ts, claimed_at = 'infinity', lease_until = NULL
             WHERE id = $id"""
    ).map(_ => ())
  }

  /** Records a failed storage delete: bumps `attempts`, stamps `last_attempt_at`, and clears the lease. A legacy row
   *  is released through `claimed_at` (V128's backoff, measured from `last_attempt_at`); a new-style row moves
   *  `not_before` out by the same backoff formula and never touches `claimed_at`. */
  def recordFailure(id: Long, now: Instant): Future[Unit] = {
    val nowTs = Timestamp.from(now)
    ctx.withSystemContext(
      sqlu"""UPDATE stored_object_deletions
             SET attempts        = attempts + 1,
                 last_attempt_at = $nowTs,
                 claimed_at      = CASE WHEN not_before IS NULL THEN NULL ELSE claimed_at END,
                 lease_until     = NULL,
                 not_before      = CASE WHEN not_before IS NULL THEN NULL
                                        ELSE ($nowTs)::timestamptz + LEAST(3600.0, 60.0 * power(2, attempts)) * interval '1 second' END
             WHERE id = $id"""
    ).map(_ => ())
  }

  /** Queues `keys` as new-style rows that the drain may take no earlier than `notBefore` (HEL-1530 D7: a form
   *  submit whose append future failed). The drain's guard still decides at that time whether a committed row holds
   *  the key. */
  def enqueue(keys: Seq[String], sourceTable: String, notBefore: Instant): Future[Unit] =
    if (keys.isEmpty) Future.unit
    else {
      val ts = Timestamp.from(notBefore)
      ctx.withSystemContext(
        DBIO.sequence(keys.distinct.map(k =>
          sqlu"""INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
                 VALUES ($k, $sourceTable, 'infinity', $ts)"""
        ))
      ).map(_ => ())
    }
}
