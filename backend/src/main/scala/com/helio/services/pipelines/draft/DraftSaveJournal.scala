package com.helio.services.pipelines.draft

import com.helio.infrastructure.persistence.pipelines.DefinitionRows
import spray.json._

import scala.util.Try

/** The journaled shape of a draft save (HEL-1629, design D7): ONE `pipelineDefinition` edit whose `priorState` is the
 *  fingerprinted definition the save replaced plus the raw step and Output rows (the fingerprint omits an Output's root and
 *  a step's timestamps, which a faithful restore needs), and whose `resultingState` is the fingerprint after the save, the
 *  `baseFingerprint` of the restore. */
object DraftSaveJournal {

  val TargetKind = "pipelineDefinition"
  val Op         = "save"

  def priorState(pipelineId: String, definition: JsObject, rows: DefinitionRows): JsObject =
    JsObject(
      "pipelineId" -> JsString(pipelineId),
      "definition" -> definition,
      "roots"      -> JsArray(rows.rootIds.map(JsString(_))),
      // HEL-1734: the roots with their sources and positions, so undo can recreate a removed root under its original id.
      "rootDefs"   -> JsArray(rootDefsOf(definition, rows)),
      "steps"      -> JsArray(rows.steps.map(s =>
        JsObject(
          "id" -> JsString(s.id), "type" -> JsString(s.op), "config" -> parsedOrText(s.config), "enabled" -> JsBoolean(s.enabled),
          "parentStepId" -> s.parentStepId.fold[JsValue](JsNull)(JsString(_)), "rootId" -> s.rootId.fold[JsValue](JsNull)(JsString(_)),
          "position" -> JsNumber(s.position)
        )
      )),
      "outputs"    -> JsArray(rows.outputs.map(o =>
        JsObject(
          "id" -> JsString(o.id), "name" -> JsString(o.name), "kind" -> JsString(o.kind),
          "nodeStepId" -> o.nodeStepId.fold[JsValue](JsNull)(JsString(_)), "rootId" -> o.rootId.fold[JsValue](JsNull)(JsString(_)),
          "config" -> o.config, "position" -> JsNumber(o.position)
        )
      ))
    )

  private def rootDefsOf(definition: JsObject, rows: DefinitionRows): Vector[JsValue] =
    definition.fields.get("roots").collect { case JsArray(rs) => rs }.getOrElse(Vector.empty).zipWithIndex.collect {
      case (r: JsObject, idx) if r.fields.contains("id") && r.fields.contains("dataSourceId") =>
        JsObject("id" -> r.fields("id"), "dataSourceId" -> r.fields("dataSourceId"), "position" -> JsNumber(idx))
    }

  def resultingState(pipelineId: String, fingerprint: String): JsObject =
    JsObject("pipelineId" -> JsString(pipelineId), "fingerprint" -> JsString(fingerprint))

  private def parsedOrText(config: String): JsValue = Try(config.parseJson).getOrElse(JsString(config))
}
