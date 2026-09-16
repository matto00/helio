package com.helio.domain.steps

import spray.json._

/** HEL-1107 (design.md D2): typed config for the `generatetext` step -- per-row free-text
 *  generation over `inputField`, writing the model's response to `outputField`.
 *
 *  Tolerant READ-path decode (HEL-814/HEL-860 contract, mirrors `AnalyzeWithAiConfig`/
 *  `ConvertFormatConfig`): every key defaults to `""` when absent, so a partially-configured or
 *  legacy row still opens/loads (`PipelineStepRepository.rowToDomain` must never throw). A
 *  PRESENT-but-wrong-typed key still raises [[StepConfigTypeMismatch]].
 *
 *  `outputField` deliberately does NOT default to `inputField` (design.md D2) -- unlike
 *  `ConvertFormatConfig`, where overwriting the source in place is the whole point of a format
 *  conversion, a generator that silently replaced the content it was asked to summarize would
 *  destroy the input. */
final case class GenerateTextConfig(inputField: String, instruction: String, outputField: String)

object GenerateTextConfig {

  def decode(raw: String): GenerateTextConfig = {
    val obj         = StepCodecUtil.asObject(raw)
    val inputField  = StepCodecUtil.str(obj, "inputField", "")
    val instruction = StepCodecUtil.str(obj, "instruction", "")
    val outputField = StepCodecUtil.str(obj, "outputField", "")
    GenerateTextConfig(inputField, instruction, outputField)
  }

  /** Custom format (rather than a bare `jsonFormatN`), mirroring `AnalyzeWithAiConfig`/
   *  `ConvertFormatConfig`'s own convention: `read` delegates to the shared tolerant [[decode]]
   *  so every reader (wire and persisted-row) agrees. */
  implicit val format: RootJsonFormat[GenerateTextConfig] = new RootJsonFormat[GenerateTextConfig] {
    def write(c: GenerateTextConfig): JsValue =
      JsObject(
        "inputField"  -> JsString(c.inputField),
        "instruction" -> JsString(c.instruction),
        "outputField" -> JsString(c.outputField)
      )
    def read(json: JsValue): GenerateTextConfig = decode(json.compactPrint)
  }

  /** WRITE-path validation (design.md D2): all three fields required non-empty. Shared verbatim
   *  by the write-path validator and analyze-time config validation (`inferGenerateText`), so the
   *  two surfaces cannot diverge. Returns `None` when the config is valid. */
  def validate(cfg: GenerateTextConfig): Option[String] = {
    val problems = Vector.newBuilder[String]
    if (cfg.inputField.trim.isEmpty) problems += "'inputField' must not be empty"
    if (cfg.instruction.trim.isEmpty) problems += "'instruction' must not be empty"
    if (cfg.outputField.trim.isEmpty) problems += "'outputField' must not be empty"
    val joined = problems.result()
    if (joined.isEmpty) None else Some(s"Invalid 'generatetext' config: ${joined.mkString("; ")}")
  }
}
