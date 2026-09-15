package com.helio.domain.steps

import spray.json._

/** HEL-1106 (design.md D1): the `analyzewithai` step declares an ORDERED output schema --
 *  `outputSchema` is a JSON ARRAY of `{name, type}`, never an object, specifically so column
 *  order survives spray-json's `JsObject` key sorting (HEL-1105's own hazard, see
 *  `ConvertFormatStep`'s scaladoc on `jsonMapper`). `type` is a strict subset of
 *  `DataFieldType.CanonicalWireValues` -- `string | integer | float | boolean` -- timestamp/
 *  string-body/binary-ref are excluded as not reliably producible by a model (design.md D1). */
final case class AnalyzeWithAiOutputField(name: String, `type`: String)

object AnalyzeWithAiOutputField extends DefaultJsonProtocol {
  implicit val format: RootJsonFormat[AnalyzeWithAiOutputField] = jsonFormat2(AnalyzeWithAiOutputField.apply)
}

/** Tolerant READ-path decode (HEL-814/HEL-860 contract, mirrors every other step's tolerant
 *  decoder): every key defaults when absent so a partially-configured or legacy row still opens/
 *  loads. A PRESENT-but-wrong-typed key (e.g. `outputSchema` holding a string, or an element
 *  missing `name`/`type`) still raises [[StepConfigTypeMismatch]]. */
final case class AnalyzeWithAiConfig(inputField: String, instruction: String, outputSchema: Vector[AnalyzeWithAiOutputField])

object AnalyzeWithAiConfig {

  /** design.md D1 -- the strict subset of `DataFieldType.CanonicalWireValues` a model can
   *  reliably produce. Shared by the write-path validator ([[validate]]) and analyze inference
   *  (`PipelineAnalyzeService.inferAnalyzeWithAi`), so the two surfaces cannot diverge. */
  val AllowedOutputTypes: Set[String] = Set("string", "integer", "float", "boolean")

  val MaxOutputSchemaEntries: Int = 50

  def decode(raw: String): AnalyzeWithAiConfig = {
    val obj          = StepCodecUtil.asObject(raw)
    val inputField    = StepCodecUtil.str(obj, "inputField", "")
    val instruction   = StepCodecUtil.str(obj, "instruction", "")
    val outputSchema  = StepCodecUtil.typedArray[AnalyzeWithAiOutputField](
      obj, "outputSchema", "an array of {name, type} objects"
    )
    AnalyzeWithAiConfig(inputField, instruction, outputSchema)
  }

  /** Custom format (rather than a bare `jsonFormatN`), mirroring `ConvertFormatConfig`'s own
   *  convention: `read` delegates to the shared tolerant [[decode]] so every reader (wire and
   *  persisted-row) agrees. `write` emits `outputSchema` as a `JsArray` (never `JsObject`) so
   *  spray-json's alphabetical key-sorting never touches it (design.md D1). */
  implicit val format: RootJsonFormat[AnalyzeWithAiConfig] = new RootJsonFormat[AnalyzeWithAiConfig] {
    def write(c: AnalyzeWithAiConfig): JsValue =
      JsObject(
        "inputField"   -> JsString(c.inputField),
        "instruction"  -> JsString(c.instruction),
        "outputSchema" -> JsArray(c.outputSchema.map(_.toJson))
      )
    def read(json: JsValue): AnalyzeWithAiConfig = decode(json.compactPrint)
  }

  /** WRITE-path validation (design.md D1): non-empty `inputField`/`instruction`; 1..50
   *  `outputSchema` entries; names non-empty, unique, and not equal to `inputField`; types in
   *  [[AllowedOutputTypes]]. Shared verbatim by the write-path validator ([[pairError]]-style
   *  callers) and analyze-time config validation ([[com.helio.domain.engine.PipelineAnalyzeService]]),
   *  so the two surfaces cannot diverge. Returns `None` when the config is valid. */
  def validate(cfg: AnalyzeWithAiConfig): Option[String] = {
    val problems = Vector.newBuilder[String]
    if (cfg.inputField.trim.isEmpty) problems += "'inputField' must not be empty"
    if (cfg.instruction.trim.isEmpty) problems += "'instruction' must not be empty"
    if (cfg.outputSchema.isEmpty) problems += "'outputSchema' must declare at least one field"
    if (cfg.outputSchema.length > MaxOutputSchemaEntries)
      problems += s"'outputSchema' must declare at most $MaxOutputSchemaEntries fields, got ${cfg.outputSchema.length}"
    val emptyNames = cfg.outputSchema.filter(_.name.trim.isEmpty)
    if (emptyNames.nonEmpty) problems += "'outputSchema' entries must have a non-empty 'name'"
    val names          = cfg.outputSchema.map(_.name)
    val duplicateNames = names.diff(names.distinct).distinct
    if (duplicateNames.nonEmpty) problems += s"'outputSchema' names must be unique, duplicate(s): ${duplicateNames.mkString(", ")}"
    val collidesWithInput = cfg.outputSchema.filter(f => f.name == cfg.inputField && cfg.inputField.nonEmpty)
    if (collidesWithInput.nonEmpty) problems += s"'outputSchema' entry '${cfg.inputField}' must not equal 'inputField'"
    val invalidTypes = cfg.outputSchema.filterNot(f => AllowedOutputTypes.contains(f.`type`))
    if (invalidTypes.nonEmpty)
      problems += s"'outputSchema' type(s) must be one of ${AllowedOutputTypes.toSeq.sorted.mkString(", ")}, got: " +
        invalidTypes.map(f => s"'${f.name}': '${f.`type`}'").mkString(", ")
    val joined = problems.result()
    if (joined.isEmpty) None else Some(s"Invalid 'analyzewithai' config: ${joined.mkString("; ")}")
  }
}
