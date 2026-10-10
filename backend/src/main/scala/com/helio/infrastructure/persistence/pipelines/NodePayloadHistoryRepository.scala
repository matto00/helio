package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.history.{PayloadHistoryConfig, PayloadTierLimit}
import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.DbContext
import org.slf4j.LoggerFactory
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.charset.StandardCharsets
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** A stored node payload: the full row set of one materialized node at one run. */
final case class NodePayload(
    id: UUID,
    pipelineId: String,
    nodeStepId: Option[String],
    rootId: Option[String],
    runId: Option[String],
    triggerSource: String,
    capturedAt: Instant,
    rowCount: Int,
    rows: JsArray
)

/** Persistence for `node_payload_history` (V116, HEL-1276). Every method runs on the privileged pool:
 *  callers authorize the Output first (`OutputRepository.findById`), exactly as for `node_snapshots`
 *  and `output_snapshot_history` reads. `writeAction` is composable (it never runs itself) so it
 *  shares the node snapshot replace's transaction (D9). */
class NodePayloadHistoryRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import NodePayloadHistoryRepository._

  private val log = LoggerFactory.getLogger(getClass)

  /** The pipeline owner's tier limit, or None when the owner/tier is unknown. */
  private def ownerLimit(pipelineId: String, config: PayloadHistoryConfig): DBIO[Option[PayloadTierLimit]] =
    sql"SELECT u.tier FROM pipelines p JOIN users u ON u.id = p.owner_id WHERE p.id = $pipelineId".as[String].headOption.map {
      _.flatMap(t => UserTier.fromString(t).toOption).map(config.limitFor)
    }

  /** HEL-1331: whether each pipeline's OWNER keeps at least one payload run (the same
   *  `pipelines`->`users` join and `PayloadTierLimit.allowsPayloads` the writer uses, so the flag
   *  and the writer cannot disagree). One batched query on the privileged pool. An unknown
   *  pipeline or an unparseable tier maps to false, never throws. Callers pass only pipeline ids of
   *  Outputs they have already authorized, so nothing leaks. */
  def payloadsAvailableFor(pipelineIds: Set[String], config: PayloadHistoryConfig): Future[Map[String, Boolean]] =
    if (pipelineIds.isEmpty) Future.successful(Map.empty)
    else {
      val inList = pipelineIds.toSeq.map(i => sql"$i").reduce((a, b) => a.concat(sql", ").concat(b))
      val query = sql"SELECT p.id, u.tier FROM pipelines p JOIN users u ON u.id = p.owner_id WHERE p.id IN (".concat(inList).concat(sql")")
      ctx.withSystemContext(query.as[(String, String)]).map { rows =>
        val found = rows.map { case (id, tier) =>
          id -> UserTier.fromString(tier).toOption.exists(t => config.limitFor(t).allowsPayloads)
        }.toMap
        pipelineIds.map(id => id -> found.getOrElse(id, false)).toMap
      }
    }

  /** Stores this node's payload when the owner's tier allows it and the rows are within BOTH caps,
   *  then trims at most ONE payload (the single oldest beyond the node's newest N) so the run
   *  transaction never multi-row deletes. The trim runs only if the transaction can take the HEL-1272
   *  purge advisory lock SHARED (try, never waits; see `insertAndTrim`); while the retention pass
   *  holds it exclusive the trim is skipped and the next purge removes the excess. Returns the new payload id, or None when nothing was
   *  stored. Order matters: tier first (a tier that stores nothing never serializes and never
   *  warns), then the row cap (a node over it is never serialized), then the compact-JSON byte cap
   *  (UTF-8 bytes, not `String.length`). Over either cap logs a WARN: the caller still writes the
   *  summary, and a payload is never truncated. */
  def writeAction(
      pipelineId: String,
      nodeStepId: Option[String],
      rootId: Option[String],
      runId: Option[String],
      triggerSource: String,
      capturedAt: Instant,
      rows: Vector[JsObject],
      config: PayloadHistoryConfig
  ): DBIO[Option[UUID]] =
    ownerLimit(pipelineId, config).flatMap {
      case Some(limit) if limit.allowsPayloads =>
        if (rows.size > config.maxRows) {
          log.warn(
            "Node payload not stored for pipeline {} node {}: {} rows exceeds PAYLOAD_HISTORY_MAX_ROWS ({})",
            pipelineId, nodeLabel(nodeStepId, rootId), Int.box(rows.size), Int.box(config.maxRows)
          )
          DBIO.successful(None)
        } else {
          val json  = JsArray(rows).compactPrint
          val bytes = json.getBytes(StandardCharsets.UTF_8).length
          if (bytes > config.maxBytes) {
            log.warn(
              "Node payload not stored for pipeline {} node {}: {} bytes exceeds PAYLOAD_HISTORY_MAX_BYTES ({})",
              pipelineId, nodeLabel(nodeStepId, rootId), Int.box(bytes), Int.box(config.maxBytes)
            )
            DBIO.successful(None)
          } else insertAndTrim(pipelineId, nodeStepId, rootId, runId, triggerSource, capturedAt, rows.size, bytes, json, limit.maxRuns).map(Some(_))
        }
      case _ => DBIO.successful(None)
    }

  private def insertAndTrim(
      pipelineId: String, nodeStepId: Option[String], rootId: Option[String], runId: Option[String],
      triggerSource: String, capturedAt: Instant, rowCount: Int, byteSize: Int, json: String, keep: Int
  ): DBIO[UUID] = {
    val id    = UUID.randomUUID()
    val idStr = id.toString
    val ts = Timestamp.from(capturedAt)
    // The rows are user data and travel only as a bound parameter, never as SQL text.
    val insert =
      sqlu"""INSERT INTO node_payload_history
               (id, pipeline_id, node_step_id, root_id, run_id, trigger_source, captured_at, row_count, byte_size, rows)
             VALUES (CAST($idStr AS uuid), $pipelineId, $nodeStepId, $rootId, $runId, $triggerSource, $ts, $rowCount, $byteSize, CAST($json AS jsonb))"""
    // Always pipeline-scoped and never a bare `IS NULL`: a root-bound node matches its own root only.
    val trim = nodeStepId match {
      case Some(step) =>
        sqlu"""DELETE FROM node_payload_history WHERE id = (
                 SELECT id FROM node_payload_history WHERE pipeline_id = $pipelineId AND node_step_id = $step
                 ORDER BY captured_at DESC, id DESC OFFSET $keep LIMIT 1)"""
      case None =>
        val root = rootId.getOrElse("")
        sqlu"""DELETE FROM node_payload_history WHERE id = (
                 SELECT id FROM node_payload_history WHERE pipeline_id = $pipelineId AND node_step_id IS NULL AND root_id = $root
                 ORDER BY captured_at DESC, id DESC OFFSET $keep LIMIT 1)"""
    }
    // HEL-1333: the trim's ON DELETE SET NULL cascade row-locks the summary points linked to the
    // victim payload, which the retention pass (thinPass / purge) also row-locks in its own
    // order -- a deadlock cycle in which the run could be the victim. The retention pass holds the
    // HEL-1272 key EXCLUSIVE for its whole transaction, so the run takes the SAME key SHARED, with a
    // TRY, immediately before the trim: shared/exclusive conflict (no trim while retention runs),
    // shared/shared do not (concurrent runs never serialize), and neither side ever waits on the
    // key. On false the trim is skipped and a later purge removes the excess; the run never waits.
    val guardedTrim = sql"SELECT pg_try_advisory_xact_lock_shared(${OutputHistoryRepository.PurgeAdvisoryLockKey})".as[Boolean].head.flatMap {
      case true => trim
      case false =>
        log.debug("Node payload trim skipped for pipeline {} node {}: the history retention pass holds the purge lock", pipelineId, nodeLabel(nodeStepId, rootId))
        DBIO.successful(0)
    }
    insert.andThen(guardedTrim).map(_ => id)
  }

  def findById(id: UUID): Future[Option[NodePayload]] = {
    val idStr = id.toString
    ctx.withSystemContext(
      sql"""SELECT id::text, pipeline_id, node_step_id, root_id, run_id, trigger_source, captured_at, row_count, rows::text
            FROM node_payload_history WHERE id = CAST($idStr AS uuid)"""
        .as[(String, String, Option[String], Option[String], Option[String], String, Timestamp, Int, String)].headOption
    ).map(_.map { case (pid, pipe, step, root, run, trig, at, count, rowsJson) =>
      rowsJson.parseJson match {
        case arr: JsArray => NodePayload(UUID.fromString(pid), pipe, step, root, run, trig, at.toInstant, count, arr)
        case other        => throw new IllegalStateException(s"node_payload_history $pid: rows is not a JSON array (${other.getClass.getSimpleName})")
      }
    })
  }

  /** Enforces the payload retention policy, returning `Purged(n)` (payloads deleted) or `LockBusy`
   *  (nothing run; another session holds the key). One transaction under the SAME advisory lock as
   *  `OutputHistoryRepository.thinPass` (so the two never contend across instances; a lock-held
   *  skip is retried by the service after its short lock-retry window).
   *  Deletes, in order: payloads of any owner tier that stores none (zero runs/age, or a tier the
   *  config does not name, which fails closed and also covers downgrades); payloads older than the
   *  owner tier's age limit; payloads beyond the per-node newest-N; and payloads no
   *  `output_snapshot_history.payload_id` references (a thinned-away or trimmed summary point).
   *  Lock contract (HEL-1333): holds the advisory key EXCLUSIVE for the whole transaction; a run's
   *  write-time trim takes it SHARED (try) first, so the two never interleave row locks. */
  def purge(now: Instant, config: PayloadHistoryConfig): Future[RetentionPassOutcome] = {
    val allowed = config.byTier.filter(_._2.allowsPayloads).toSeq
    val allowedCsv = allowed.map(t => UserTier.asString(t._1)).mkString(",")
    val disallowed =
      sqlu"""DELETE FROM node_payload_history h WHERE NOT EXISTS (
               SELECT 1 FROM pipelines p JOIN users u ON u.id = p.owner_id
               WHERE p.id = h.pipeline_id AND u.tier = ANY (string_to_array($allowedCsv, ',')))"""
    val perTier = allowed.flatMap { case (tier, limit) =>
      val tierName = UserTier.asString(tier)
      val cutoff   = Timestamp.from(now.minus(limit.maxAge))
      val keep     = limit.maxRuns
      Seq(
        sqlu"""DELETE FROM node_payload_history h USING pipelines p, users u
               WHERE h.pipeline_id = p.id AND p.owner_id = u.id AND u.tier = $tierName AND h.captured_at < $cutoff""",
        sqlu"""DELETE FROM node_payload_history WHERE id IN (
                 SELECT id FROM (
                   SELECT h.id, row_number() OVER (
                     PARTITION BY h.pipeline_id, h.node_step_id, h.root_id ORDER BY h.captured_at DESC, h.id DESC) AS rn
                   FROM node_payload_history h
                   JOIN pipelines p ON p.id = h.pipeline_id JOIN users u ON u.id = p.owner_id
                   WHERE u.tier = $tierName) ranked
                 WHERE rn > $keep)"""
      )
    }
    val unreferenced =
      sqlu"""DELETE FROM node_payload_history h WHERE NOT EXISTS (
               SELECT 1 FROM output_snapshot_history o WHERE o.payload_id = h.id)"""
    val steps = DBIO.sequence((disallowed +: perTier) :+ unreferenced).map(_.sum)

    val guarded = sql"SELECT pg_try_advisory_xact_lock(${OutputHistoryRepository.PurgeAdvisoryLockKey})".as[Boolean].head.flatMap {
      case true => steps.map(RetentionPassOutcome.Purged(_))
      case false =>
        log.debug("Node payload purge skipped: another session holds the purge lock")
        DBIO.successful(RetentionPassOutcome.LockBusy)
    }
    ctx.withSystemContext(guarded.transactionally)
  }
}

object NodePayloadHistoryRepository {
  private def nodeLabel(nodeStepId: Option[String], rootId: Option[String]): String =
    nodeStepId.map(s => s"step $s").orElse(rootId.map(r => s"root $r")).getOrElse("?")
}
