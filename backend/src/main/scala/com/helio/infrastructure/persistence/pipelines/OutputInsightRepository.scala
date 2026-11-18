package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.insights._
import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.{GetResult, SetParameter}
import spray.json._

import java.sql.{Timestamp, Types}
import java.time.{Duration, Instant}
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for `output_insights` (V145). Every read runs on the privileged pool via
 *  `withSystemContext`: callers authorize the Output first (`OutputRepository.findById`), exactly as
 *  for `output_snapshot_history`; the RLS policy is defense in depth. Reads issue SELECT only.
 *  "Latest" is `created_at DESC, id DESC` so ties are deterministic. */
class OutputInsightRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import OutputInsightRepository._

  private val Columns =
    "id, output_id, pipeline_id, run_id, trigger, status, markdown, citations::text, input_digest, model, " +
      "input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_micros, created_at"

  /** Composable (never runs itself); the write seam for the trigger leaf (L4). `citations` is bound as
   *  text and cast, never interpolated. */
  def insertAction(e: OutputInsightInsert): DBIO[Unit] = {
    val citations = StoredInsightCitation.toJsonArray(e.citations).compactPrint
    sqlu"""INSERT INTO output_insights
             (output_id, pipeline_id, run_id, trigger, status, markdown, citations, input_digest, model,
              input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_micros, created_at)
           VALUES (${e.outputId}, ${e.pipelineId}, ${e.runId}, ${e.trigger.wire}, ${e.status.wire},
                   ${e.markdown}, $citations::jsonb, ${e.inputDigest}, ${e.model},
                   ${e.inputTokens}, ${e.outputTokens}, ${e.cacheCreationTokens}, ${e.cacheReadTokens}, ${e.costMicros},
                   ${Timestamp.from(e.createdAt)})""".map(_ => ())
  }

  /** The newest `ok` render, or `None`. */
  def latestOk(outputId: String): Future[Option[OutputInsightRecord]] =
    ctx.withSystemContext(
      sql"""SELECT #$Columns FROM output_insights WHERE output_id = $outputId AND status = 'ok'
            ORDER BY created_at DESC, id DESC LIMIT 1""".as[OutputInsightRecord]
    ).map(_.headOption)

  /** The newest row of any status, or `None`. */
  def latestAttempt(outputId: String): Future[Option[OutputInsightRecord]] =
    ctx.withSystemContext(
      sql"""SELECT #$Columns FROM output_insights WHERE output_id = $outputId
            ORDER BY created_at DESC, id DESC LIMIT 1""".as[OutputInsightRecord]
    ).map(_.headOption)

  /** Newest first, every status. `since` (inclusive) is applied in SQL BEFORE `limit`. */
  def listRecent(outputId: String, limit: Int, since: Option[Instant]): Future[Vector[OutputInsightRecord]] = {
    val sinceTs = Timestamp.from(since.getOrElse(Instant.EPOCH))
    ctx.withSystemContext(
      sql"""SELECT #$Columns FROM output_insights WHERE output_id = $outputId AND created_at >= $sinceTs
            ORDER BY created_at DESC, id DESC LIMIT $limit""".as[OutputInsightRecord]
    ).map(_.toVector)
  }

  /** Deletes rows older than the age cap of the PIPELINE owner's tier (a tier absent from the map uses
   *  the strictest cap; an empty map purges nothing), EXCEPT each Output's newest `ok` row and its
   *  newest row of any status. One DELETE: volumes are small (at most one on_run render per Output
   *  per hour plus daily/manual). Idempotent. Returns the number deleted. */
  def purge(now: Instant, maxAgeByTier: Map[UserTier, Duration]): Future[Int] =
    if (maxAgeByTier.isEmpty) Future.successful(0)
    else {
      val entries   = maxAgeByTier.toSeq
      val tiers     = entries.map { case (t, _) => UserTier.asString(t) }
      val cutoffs   = entries.map { case (_, d) => Timestamp.from(now.minus(d)) }
      val strictest = Timestamp.from(now.minus(maxAgeByTier.values.min))
      ctx.withSystemContext(
        sqlu"""DELETE FROM output_insights i
               USING pipelines p, users u
               WHERE i.pipeline_id = p.id AND p.owner_id = u.id
                 AND i.created_at < $strictest
                 AND i.created_at < COALESCE(($cutoffs::timestamptz[])[array_position($tiers::text[], u.tier)], $strictest)
                 AND EXISTS (SELECT 1 FROM output_insights n
                             WHERE n.output_id = i.output_id AND (n.created_at, n.id) > (i.created_at, i.id))
                 AND NOT (i.status = 'ok' AND NOT EXISTS (
                           SELECT 1 FROM output_insights n
                           WHERE n.output_id = i.output_id AND n.status = 'ok' AND (n.created_at, n.id) > (i.created_at, i.id)))"""
      )
    }
}

object OutputInsightRepository {

  private implicit val setTextArray: SetParameter[Seq[String]] = SetParameter { (v, pp) =>
    pp.setObject(pp.ps.getConnection.createArrayOf("text", v.toArray[AnyRef]), Types.ARRAY)
  }
  private implicit val setTimestampArray: SetParameter[Seq[Timestamp]] = SetParameter { (v, pp) =>
    pp.setObject(pp.ps.getConnection.createArrayOf("timestamptz", v.toArray[AnyRef]), Types.ARRAY)
  }

  /** The two closed sets are CHECK-constrained, so an unknown value is unreachable; it fails loud
   *  rather than being coerced. */
  private implicit val getRecord: GetResult[OutputInsightRecord] = GetResult { r =>
    val id          = UUID.fromString(r.nextString())
    val outputId    = r.nextString()
    val pipelineId  = r.nextString()
    val runId       = r.nextStringOption()
    val triggerRaw  = r.nextString()
    val statusRaw   = r.nextString()
    val markdown    = r.nextStringOption()
    val citations   = StoredInsightCitation.fromJsonArray(r.nextString().parseJson)
    val digest      = r.nextStringOption()
    val model       = r.nextStringOption()
    val inTok       = r.nextIntOption()
    val outTok      = r.nextIntOption()
    val cacheCreate = r.nextIntOption()
    val cacheRead   = r.nextIntOption()
    val cost        = r.nextLongOption()
    val createdAt   = r.nextTimestamp().toInstant
    OutputInsightRecord(
      id, outputId, pipelineId, runId,
      InsightTrigger.fromString(triggerRaw).getOrElse(throw new IllegalStateException(s"unknown insight trigger '$triggerRaw'")),
      InsightStatus.fromString(statusRaw).getOrElse(throw new IllegalStateException(s"unknown insight status '$statusRaw'")),
      markdown, citations, digest, model, inTok, outTok, cacheCreate, cacheRead, cost, createdAt
    )
  }
}
