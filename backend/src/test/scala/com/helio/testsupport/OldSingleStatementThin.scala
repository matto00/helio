package com.helio.testsupport

import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.pipelines.HistoryThinningPolicy
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.{Duration, Instant}
import scala.concurrent.ExecutionContext

/** HEL-1435: the pre-batching `OutputHistoryRepository.thinAndPurge` SQL (origin/main 22f4c1fd3), copied VERBATIM
 *  as a test-only oracle. Its SQL text must not be edited: it is the definition of "which rows survive" that the
 *  batched thin is proven equal to. */
object OldSingleStatementThin {

  def run(now: Instant, policy: HistoryThinningPolicy, maxAgeByTier: Map[UserTier, Duration], protectedNewest: Int)
         (implicit ec: ExecutionContext): DBIO[Int] = {
    val named = maxAgeByTier.toSeq.map { case (tier, maxAge) =>
      val tierName = UserTier.asString(tier)
      val cutoff   = Timestamp.from(now.minus(maxAge))
      sqlu"""DELETE FROM output_snapshot_history h
             USING pipelines p, users u
             WHERE h.pipeline_id = p.id AND p.owner_id = u.id AND u.tier = $tierName AND h.captured_at < $cutoff"""
    }
    val strictest = if (maxAgeByTier.isEmpty) None else Some(maxAgeByTier.values.min)
    val unnamed = strictest.toSeq.map { cap =>
      val namedCsv = maxAgeByTier.keys.map(UserTier.asString).mkString(",")
      val cutoff   = Timestamp.from(now.minus(cap))
      sqlu"""DELETE FROM output_snapshot_history h
             USING pipelines p, users u
             WHERE h.pipeline_id = p.id AND p.owner_id = u.id
               AND u.tier <> ALL (string_to_array($namedCsv, ',')) AND h.captured_at < $cutoff"""
    }
    val purgeByAge = DBIO.sequence(named ++ unnamed).map(_.sum)

    val nowTs        = Timestamp.from(now)
    val recentSecs   = policy.recentWindow.getSeconds
    val midSecs      = policy.midWindow.getSeconds
    val recentBucket = policy.recentBucket.getSeconds
    val midBucket    = policy.midBucket.getSeconds
    val oldBucket    = policy.oldBucket.getSeconds
    val thin =
      sqlu"""DELETE FROM output_snapshot_history WHERE id IN (
               SELECT id FROM (
                 SELECT id, row_number() OVER (
                   PARTITION BY output_id, age_class, floor(epoch / bucket_secs)
                   ORDER BY captured_at DESC, id DESC) AS rn
                 FROM (
                   SELECT id, output_id, captured_at,
                          extract(epoch FROM captured_at) AS epoch,
                          CASE WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $recentSecs THEN 0
                               WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $midSecs THEN 1
                               ELSE 2 END AS age_class,
                          CASE WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $recentSecs THEN $recentBucket
                               WHEN extract(epoch FROM ($nowTs::timestamptz - captured_at)) < $midSecs THEN $midBucket
                               ELSE $oldBucket END AS bucket_secs
                   FROM (
                     SELECT id, output_id, captured_at,
                            row_number() OVER (PARTITION BY output_id ORDER BY captured_at DESC, id DESC) AS recency
                     FROM output_snapshot_history
                   ) recent
                   WHERE recency > $protectedNewest
                 ) classed
               ) ranked WHERE rn > 1)"""
    purgeByAge.flatMap(a => thin.map(_ + a))
  }
}
