package com.helio.testsupport

import java.sql.Timestamp
import com.helio.domain.steps.AssertRule
import com.helio.domain.model._
import com.helio.domain.steps.AssertConfig
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1276: seeding for the node-payload specs, on top of the history API harness (embedded
 *  Postgres, a non-BYPASSRLS app pool and a superuser seeding/privileged pool). */
trait NodePayloadFixtures extends OutputHistoryApiHarness {

  /** `optedOutput` is a metric Output carrying the opt-in; `plainOutput` is a table Output on the SAME
   *  node without it. */
  protected final case class PayloadFx(pid: PipelineId, stepId: PipelineStepId, optedOutput: String, plainOutput: String)

  protected val OptedConfig: JsObject =
    JsObject(
      "fieldMapping" -> JsObject("value" -> JsString("amount")),
      "aggregation"  -> JsObject("value" -> JsString("amount"), "agg" -> JsString("sum")),
      "historyPayloads" -> JsBoolean(true)
    )

  protected def defaultRows: Seq[(String, String)] = Seq("a" -> "1", "b" -> "2", "c" -> "3")

  /** A runnable pipeline (dataset source + assert step) owned by `ownerId`. */
  protected def seedPayloadPipeline(
      ownerId: String,
      rows: Seq[(String, String)] = defaultRows,
      optedConfig: JsObject = OptedConfig,
      rules: Vector[AssertRule] = Vector.empty
  ): PayloadFx = {
    implicit val ec: ExecutionContext = harnessEc
    val dsId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    val rowsJson = rows.map { case (l, a) => JsArray(JsString(l), JsString(a)).compactPrint }.mkString("[", ",", "]")
    val payload  = s"""{"columns":[{"name":"label","type":"string"},{"name":"amount","type":"string"}],"rows":$rowsJson}"""
    awaitDb(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', $ownerId::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload),
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'p', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    val pipelineId = PipelineId(pid)
    val step  = awaitDb(stepRepo.insertInternal(pipelineId, "assert", AssertConfig(rules), enabled = true, None, explicitRootId = None))
    val opted = awaitDb(outputRepo.insertInternal(pipelineId, Some(step.id), UserId(ownerId), "opted", OutputKind.Metric, optedConfig, explicitRootId = None))
    val plain = awaitDb(outputRepo.insertInternal(pipelineId, Some(step.id), UserId(ownerId), "plain", OutputKind.Table, explicitRootId = None))
    PayloadFx(pipelineId, step.id, opted.id.value, plain.id.value)
  }

  protected def payloadCount(pipelineId: String): Int =
    awaitDb(db.run(sql"SELECT count(*) FROM node_payload_history WHERE pipeline_id = $pipelineId".as[Int].head))

  protected def totalPayloads(): Int =
    awaitDb(db.run(sql"SELECT count(*) FROM node_payload_history".as[Int].head))

  /** `payload_id` (as text) of each of the Output's points, newest first. */
  protected def payloadLinks(outputId: String): Vector[Option[String]] =
    awaitDb(db.run(
      sql"SELECT payload_id::text FROM output_snapshot_history WHERE output_id = $outputId ORDER BY captured_at DESC, id DESC".as[Option[String]]
    )).toVector

  protected def pointCount(outputId: String): Int = historyCount(outputId)

  /** A raw payload row for a step node (via the superuser seeding pool). */
  protected def seedRawPayload(pipelineId: String, stepId: Option[String], rootId: Option[String], at: Instant, rowsJson: String = """[{"a":1}]"""): String = {
    val id = UUID.randomUUID().toString
    val ts = Timestamp.from(at)
    awaitDb(db.run(
      sqlu"""INSERT INTO node_payload_history (id, pipeline_id, node_step_id, root_id, run_id, trigger_source, captured_at, row_count, byte_size, rows)
             VALUES ($id::uuid, $pipelineId, $stepId, $rootId, 'seed', 'manual', $ts, 1, ${rowsJson.length}, $rowsJson::jsonb)"""
    ))
    id
  }

  /** A summary point for `outputId` linked to `payloadId`. */
  protected def seedLinkedPoint(outputId: String, pipelineId: String, stepId: Option[String], at: Instant, payloadId: Option[String]): String = {
    val id = UUID.randomUUID().toString
    val ts = Timestamp.from(at)
    val rootOpt: Option[String] = if (stepId.isEmpty) Some(pipelineId) else None
    awaitDb(db.run(
      sqlu"""INSERT INTO output_snapshot_history (id, output_id, pipeline_id, node_step_id, root_id, run_id, trigger_source, captured_at, row_count, summary, payload_id)
             VALUES ($id::uuid, $outputId, $pipelineId, $stepId, $rootOpt, 'seed', 'manual', $ts, 1, '{"v":1}'::jsonb, ${payloadId}::uuid)"""
    ))
    id
  }
}
