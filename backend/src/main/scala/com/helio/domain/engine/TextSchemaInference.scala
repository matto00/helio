package com.helio.domain.engine

import com.helio.domain.steps.{AnalyzeWithAiConfig, ConvertFormatStep, GenerateTextConfig}
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._

/** HEL-1385: text/AI per-op schema inference (convertformat, analyzewithai, generatetext, splittext,
 *  extractheadings, chunkbytokencount). */
private[engine] object TextSchemaInference {

  private val log = LoggerFactory.getLogger(PipelineAnalyzeService.getClass)

  /** splittext (HEL-219) — mirrors `inferCompute`'s validate-then-shape pattern.
   *
   *  Looks up `config.field` in `inputSchema`. If absent, flags an unknown-field
   *  `validationError` and passes the schema through unchanged (identity
   *  fallback). If present but not `"string-body"`, flags a not-a-content-field
   *  `validationError`, likewise passing the schema through unchanged. On
   *  success, appends `indexField` as `"integer"` (replacing any existing field
   *  of the same name — same collision rule `compute` already applies). */
  /** convertformat (HEL-1105, design.md D6) -- mirrors `inferSplitText`'s validate-then-shape
   *  pattern: `field` absent -> unknown-field error; present but not `string-body` -> "not a
   *  content field" error; unsupported `from`/`to` pair -> error. Output schema on success is
   *  the input schema with `outputField` set/added as `string-body` (a 1:1 transform, unlike
   *  `splittext`'s flatMap shape -- no index field is appended). Shares
   *  `ConvertFormatStep.SupportedPairs` with the engine and the write-path validator so the two
   *  surfaces cannot diverge (D6). */
  private[engine] def inferConvertFormat(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json        = config.parseJson.asJsObject
      val field       = json.fields("field").convertTo[String]
      val from        = json.fields.get("from").map(_.convertTo[String]).getOrElse("")
      val to          = json.fields.get("to").map(_.convertTo[String]).getOrElse("")
      val outputField = json.fields.get("outputField").map(_.convertTo[String]).filter(_.nonEmpty).getOrElse(field)

      inputSchema.find(_.name == field) match {
        case None =>
          (inputSchema, Some(s"Unknown field '$field'"))
        case Some(f) if f.`type` != "string-body" =>
          (inputSchema, Some(s"Field '$field' is not a content field (string-body); convertformat requires a string-body field"))
        case Some(_) if !ConvertFormatStep.SupportedPairs.contains((from, to)) =>
          (
            inputSchema,
            Some(
              s"Unsupported convertformat pair: '$from' -> '$to'. Supported: " +
                ConvertFormatStep.SupportedPairs.map { case (a, b) => s"$a->$b" }.mkString(", ")
            )
          )
        case Some(_) =>
          val without = inputSchema.filterNot(_.name == outputField)
          (without :+ SchemaField(name = outputField, `type` = "string-body"), None)
      }
    } catch {
      case ex: Exception =>
        log.warn("convertformat config error", ex)
        (inputSchema, Some("convertformat config error"))
    }

  /** analyzewithai (HEL-1106, design.md D7) -- never calls the model. Checks `inputField` exists
   *  in the input schema and is `string`/`string-body` (the only types the model-content prompt
   *  can be built from), and that the config itself is valid (shared `AnalyzeWithAiConfig
   *  .validate`, the same check the write path/`requiredConfigProblems` runs -- the two surfaces
   *  cannot diverge). On success, output = input schema plus the declared columns IN DECLARED
   *  ORDER; a name colliding with an existing input column is replaced in place (same "declared
   *  columns win" rule `compute`/`convertformat` already apply), matching the engine's own
   *  documented overwrite behavior (design.md D6). */
  private[engine] def inferAnalyzeWithAi(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val cfg = AnalyzeWithAiConfig.decode(config)
      AnalyzeWithAiConfig.validate(cfg) match {
        case Some(msg) => (inputSchema, Some(msg))
        case None =>
          inputSchema.find(_.name == cfg.inputField) match {
            case None =>
              (inputSchema, Some(s"Unknown field '${cfg.inputField}'"))
            case Some(f) if f.`type` != "string-body" && f.`type` != "string" =>
              (inputSchema, Some(s"Field '${cfg.inputField}' is not a string field; analyzewithai requires 'string' or 'string-body'"))
            case Some(_) =>
              val declaredNames = cfg.outputSchema.map(_.name).toSet
              val without       = inputSchema.filterNot(f => declaredNames.contains(f.name))
              val declared      = cfg.outputSchema.map(f => SchemaField(name = f.name, `type` = f.`type`))
              (without ++ declared, None)
          }
      }
    } catch {
      case ex: Exception =>
        log.warn("analyzewithai config error", ex)
        (inputSchema, Some("analyzewithai config error"))
    }

  /** generatetext (HEL-1107, design.md D6) -- never calls the model. Checks `inputField` exists
   *  in the input schema and is `string`/`string-body` (the only types the model-content prompt
   *  can be built from), and that the config itself is valid (shared `GenerateTextConfig
   *  .validate`, the same check the write path/`requiredConfigProblems` runs). On success, output
   *  = input schema with `outputField` set/added as `string-body`, using the SAME collision
   *  pattern as `inferConvertFormat` (`filterNot(_.name == outputField) :+ ...`) rather than
   *  `inferAnalyzeWithAi`'s multi-column replace -- `generatetext` only ever adds one column. */
  private[engine] def inferGenerateText(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val cfg = GenerateTextConfig.decode(config)
      GenerateTextConfig.validate(cfg) match {
        case Some(msg) => (inputSchema, Some(msg))
        case None =>
          inputSchema.find(_.name == cfg.inputField) match {
            case None =>
              (inputSchema, Some(s"Unknown field '${cfg.inputField}'"))
            case Some(f) if f.`type` != "string-body" && f.`type` != "string" =>
              (inputSchema, Some(s"Field '${cfg.inputField}' is not a string field; generatetext requires 'string' or 'string-body'"))
            case Some(_) =>
              val without = inputSchema.filterNot(_.name == cfg.outputField)
              (without :+ SchemaField(name = cfg.outputField, `type` = "string-body"), None)
          }
      }
    } catch {
      case ex: Exception =>
        log.warn("generatetext config error", ex)
        (inputSchema, Some("generatetext config error"))
    }

  private[engine] def inferSplitText(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json       = config.parseJson.asJsObject
      val field      = json.fields("field").convertTo[String]
      val indexField = json.fields.get("indexField").map(_.convertTo[String]).getOrElse("segmentIndex")

      inputSchema.find(_.name == field) match {
        case None =>
          (inputSchema, Some(s"Unknown field '$field'"))
        case Some(f) if f.`type` != "string-body" =>
          (inputSchema, Some(s"Field '$field' is not a content field (string-body); splittext requires a string-body field"))
        case Some(_) =>
          val withoutIndex = inputSchema.filterNot(_.name == indexField)
          (withoutIndex :+ SchemaField(name = indexField, `type` = "integer"), None)
      }
    } catch {
      case ex: Exception =>
        // HEL-311: keep the "<op> config error" category, drop the raw
        // exception tail; log the detail.
        log.warn("splittext config error", ex)
        (inputSchema, Some("splittext config error"))
    }

  /** extractheadings (HEL-220) — mirrors `inferSplitText`'s validate-then-shape
   *  pattern, with two appended fields instead of one.
   *
   *  Looks up `config.field` in `inputSchema`. If absent, flags an unknown-field
   *  `validationError` and passes the schema through unchanged (identity
   *  fallback). If present but not `"string-body"`, flags a not-a-content-field
   *  `validationError`, likewise passing the schema through unchanged. On
   *  success, appends `indexField` and `levelField` as `"integer"` (each
   *  replacing any existing field of the same name — same collision rule
   *  `splittext` already applies). */
  private[engine] def inferExtractHeadings(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json       = config.parseJson.asJsObject
      val field      = json.fields("field").convertTo[String]
      val indexField = json.fields.get("indexField").map(_.convertTo[String]).getOrElse("headingIndex")
      val levelField = json.fields.get("levelField").map(_.convertTo[String]).getOrElse("headingLevel")

      inputSchema.find(_.name == field) match {
        case None =>
          (inputSchema, Some(s"Unknown field '$field'"))
        case Some(f) if f.`type` != "string-body" =>
          (inputSchema, Some(s"Field '$field' is not a content field (string-body); extractheadings requires a string-body field"))
        case Some(_) =>
          val withoutIndexAndLevel = inputSchema.filterNot(f => f.name == indexField || f.name == levelField)
          (withoutIndexAndLevel :+ SchemaField(name = indexField, `type` = "integer") :+ SchemaField(name = levelField, `type` = "integer"), None)
      }
    } catch {
      case ex: Exception =>
        // HEL-311: keep the "<op> config error" category, drop the raw
        // exception tail; log the detail.
        log.warn("extractheadings config error", ex)
        (inputSchema, Some("extractheadings config error"))
    }

  /** chunkbytokencount (HEL-221) — mirrors `inferExtractHeadings`'s
   *  validate-then-shape pattern, appending two fields (index + token count)
   *  instead of one.
   *
   *  Looks up `config.field` in `inputSchema`. If absent, flags an unknown-field
   *  `validationError` and passes the schema through unchanged (identity
   *  fallback). If present but not `"string-body"`, flags a not-a-content-field
   *  `validationError`, likewise passing the schema through unchanged. On
   *  success, appends `indexField` and `tokenCountField` as `"integer"` (each
   *  replacing any existing field of the same name — same collision rule
   *  `splittext`/`extractheadings` already apply). `targetTokenCount`/`encoding`
   *  are step parameters, not data-shape fields, so they don't appear in the
   *  schema. */
  private[engine] def inferChunkByTokenCount(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json            = config.parseJson.asJsObject
      val field           = json.fields("field").convertTo[String]
      val indexField      = json.fields.get("indexField").map(_.convertTo[String]).getOrElse("chunkIndex")
      val tokenCountField = json.fields.get("tokenCountField").map(_.convertTo[String]).getOrElse("tokenCount")

      inputSchema.find(_.name == field) match {
        case None =>
          (inputSchema, Some(s"Unknown field '$field'"))
        case Some(f) if f.`type` != "string-body" =>
          (inputSchema, Some(s"Field '$field' is not a content field (string-body); chunkbytokencount requires a string-body field"))
        case Some(_) =>
          val withoutIndexAndCount = inputSchema.filterNot(f => f.name == indexField || f.name == tokenCountField)
          (withoutIndexAndCount :+ SchemaField(name = indexField, `type` = "integer") :+ SchemaField(name = tokenCountField, `type` = "integer"), None)
      }
    } catch {
      case ex: Exception =>
        // HEL-311: keep the "<op> config error" category, drop the raw
        // exception tail; log the detail.
        log.warn("chunkbytokencount config error", ex)
        (inputSchema, Some("chunkbytokencount config error"))
    }
}
