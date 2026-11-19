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

/** Persistence for `output_insights` (V145). Every read (and, since HEL-1743, the render service's writes) runs on the privileged pool via
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

  /** HEL-1743: inserts one attempt and returns its generated id (for the `InsightRendered` event). Privileged: the render
   *  service runs on scheduler and run paths with no request user; it authorized the Output before getting here. */
  def insertReturningId(e: OutputInsightInsert): Future[UUID] = {
    val citations = StoredInsightCitation.toJsonArray(e.citations).compactPrint
    ctx.withSystemContext(
      sql"""INSERT INTO output_insights
              (output_id, pipeline_id, run_id, trigger, status, markdown, citations, input_digest, model,
               input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_micros, created_at)
            VALUES (${e.outputId}, ${e.pipelineId}, ${e.runId}, ${e.trigger.wire}, ${e.status.wire},
                    ${e.markdown}, $citations::jsonb, ${e.inputDigest}, ${e.model},
                    ${e.inputTokens}, ${e.outputTokens}, ${e.cacheCreationTokens}, ${e.cacheReadTokens}, ${e.costMicros},
                    ${Timestamp.from(e.createdAt)})
            RETURNING id::text""".as[String].head
    ).map(UUID.fromString)
  }

  /** HEL-1743 D4: a no-model outcome with the same status as the newest attempt updates that row instead of adding one.
   *  `GREATEST` so a render that STARTED earlier than the row's stamp (an overlapping one) never moves the stamp backwards.
   *  Only the stamp, trigger, run id and digest change: the status, model, tokens and cost are never touched. */
  def coalesce(id: UUID, start: Instant, trigger: InsightTrigger, runId: Option[String], digest: Option[String]): Future[Int] =
    ctx.withSystemContext(
      sqlu"""UPDATE output_insights
             SET created_at = GREATEST(created_at, ${Timestamp.from(start)}), trigger = ${trigger.wire},
                 run_id = $runId, input_digest = $digest
             WHERE id = ${id.toString}::uuid"""
    )

  /** The newest attempt that made a model call (`model IS NOT NULL`), or `None`: the hourly throttle's clock. */
  def lastModelCallAt(outputId: String): Future[Option[Instant]] =
    ctx.withSystemContext(
      sql"""SELECT created_at FROM output_insights WHERE output_id = $outputId AND model IS NOT NULL
            ORDER BY created_at DESC, id DESC LIMIT 1""".as[Timestamp]
    ).map(_.headOption.map(_.toInstant))

  /** Every `daily` or `on_run` insight Output with the instants the tick pass's predicates read. Privileged: a background
   *  pass with no user. A missing `refresh` key is `on_run` (the default; defaults are never stored). */
  def listCandidates(): Future[Vector[InsightCandidate]] =
    ctx.withSystemContext(
      sql"""SELECT o.id, o.pipeline_id, COALESCE(o.config->>'refresh', 'on_run'), o.created_at,
                   (SELECT i.created_at FROM output_insights i WHERE i.output_id = o.id ORDER BY i.created_at DESC, i.id DESC LIMIT 1),
                   (SELECT max(i.created_at) FROM output_insights i WHERE i.output_id = o.id AND i.model IS NOT NULL),
                   p.last_run_at
            FROM outputs o JOIN pipelines p ON p.id = o.pipeline_id
            WHERE o.kind = 'insight' AND COALESCE(o.config->>'refresh', 'on_run') IN ('daily', 'on_run')""".as[InsightCandidate]
    ).map(_.toVector)

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
   *  newest row of any status. One DELETE: volumes are small (HEL-1743: at most about one model-call row per Output per hour,
   *  because an automatic render is throttled to one model call an hour, plus ONE row per status change, because a no-model
   *  outcome with the status of the newest attempt updates that row instead of adding one, see [[coalesce]]). Idempotent.
   *  Returns the number deleted. */
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

  private implicit val getCandidate: GetResult[InsightCandidate] = GetResult { r =>
    InsightCandidate(
      r.nextString(), r.nextString(), r.nextString(), r.nextTimestamp().toInstant,
      r.nextTimestampOption().map(_.toInstant), r.nextTimestampOption().map(_.toInstant), r.nextTimestampOption().map(_.toInstant)
    )
  }

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
