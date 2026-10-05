package com.helio.testsupport

import com.helio.infrastructure.persistence.pipelines.OutputHistoryInsert
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsNumber, JsObject}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1271: raw-SQL seeding of the parents a history row needs (user, pipeline + root, Output).
 *  `seedDb` must be a connection that is not subject to RLS (superuser or `helio_privileged`). */
trait OutputHistoryFixtures {

  protected def seedDb: JdbcBackend.Database

  protected def awaitDb[T](f: Future[T]): T = Await.result(f, 20.seconds)

  protected def seedUser(tier: String = "free"): String = {
    val id = UUID.randomUUID().toString
    awaitDb(seedDb.run(sqlu"""INSERT INTO users (id, email, created_at, tier) VALUES ($id::uuid, ${s"$id@test.local"}, now(), $tier)"""))
    id
  }

  /** A pipeline owned by `ownerId` with one root-bound Output; returns (pipelineId, outputId). */
  protected def seedPipelineWithOutput(ownerId: String, kind: String = "metric", config: String = "{}"): (String, String) = {
    val srcId = UUID.randomUUID().toString
    val pid   = UUID.randomUUID().toString
    val oid   = UUID.randomUUID().toString
    awaitDb(seedDb.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($srcId, 'ds', 'dataset', '{}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $srcId, 0)""",
      sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, root_id)
             VALUES ($oid, $pid, NULL, $ownerId::uuid, 'out', $kind, $config::jsonb, $pid)"""
    )))
    (pid, oid)
  }

  protected def historyEntry(outputId: String, pipelineId: String, at: Instant, runId: String = UUID.randomUUID().toString): OutputHistoryInsert =
    OutputHistoryInsert(
      outputId = outputId, pipelineId = pipelineId, nodeStepId = None, rootId = Some(pipelineId), runId = Some(runId),
      triggerSource = "manual", capturedAt = at, rowCount = 1, summary = JsObject("v" -> JsNumber(1))
    )

  protected def historyCount(outputId: String): Int =
    awaitDb(seedDb.run(sql"SELECT count(*) FROM output_snapshot_history WHERE output_id = $outputId".as[Int].head))
}
