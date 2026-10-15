package com.helio.services.pipelines

import spray.json._

import scala.util.Try

/** HEL-1579 (design.md D9): the per-step row counts of a run (step id -> count), stored as compact JSON text in
 *  `pipeline_runs.step_row_counts` / `pipelines.last_run_step_row_counts` and exposed as an object on the wire. */
object PipelineStepRowCounts {

  /** The engine's `stepCounts` as the compact JSON text the two columns store. */
  def toJson(stepCounts: Map[String, Long]): String =
    JsObject(stepCounts.map { case (stepId, count) => stepId -> JsNumber(count) }).compactPrint

  /** The stored text as a map; an unparseable or non-object value reads as "not recorded". */
  def parse(json: String): Option[Map[String, Long]] =
    Try(json.parseJson.asJsObject.fields.collect { case (k, JsNumber(n)) => k -> n.toLong }).toOption
}
