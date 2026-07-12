package com.helio.domain

import spray.json._
import spray.json.DefaultJsonProtocol._

// ── Shared schema field type (wire-format compatible) ─────────────────────────

final case class SchemaField(name: String, `type`: String)

// ── PipelineAnalyzeService — pure schema-math inference for all 8 ops ─────────

object PipelineAnalyzeService {

  /** Minimal step input consumed by inference — decoupled from infrastructure row types. */
  final case class PipelineStepInput(
      id:       String,
      position: Int,
      op:       String,
      config:   String
  )

  final case class AnalyzedStep(
      id:              String,
      position:        Int,
      op:              String,
      config:          String,
      inputSchema:     Vector[SchemaField],
      outputSchema:    Vector[SchemaField],
      validationError: Option[String]
  )

  /** Propagate schemas through the ordered step list.
   *
   *  Step 0's inputSchema == sourceSchema.
   *  Step N's inputSchema == step (N-1)'s outputSchema.
   *  If a step has a validationError, its outputSchema equals its inputSchema (identity fallback)
   *  so that downstream steps continue with a meaningful schema. */
  def analyze(steps: Vector[PipelineStepInput], sourceSchema: Vector[SchemaField]): Vector[AnalyzedStep] = {
    var currentSchema = sourceSchema
    steps.map { step =>
      val (output, err) = inferOutputSchema(step.op, step.config, currentSchema)
      val analyzed = AnalyzedStep(
        id              = step.id,
        position        = step.position,
        op              = step.op,
        config          = step.config,
        inputSchema     = currentSchema,
        outputSchema    = output,
        validationError = err
      )
      currentSchema = output
      analyzed
    }
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  private def inferOutputSchema(
      op:          String,
      config:      String,
      inputSchema: Vector[SchemaField]
  ): (Vector[SchemaField], Option[String]) =
    op match {
      case "filter" | "limit" | "sort" => (inputSchema, None)
      case "select"                     => inferSelect(config, inputSchema)
      case "rename"                     => inferRename(config, inputSchema)
      case "cast"                       => inferCast(config, inputSchema)
      case "compute"                    => inferCompute(config, inputSchema)
      case "aggregate"                  => inferAggregate(config, inputSchema)
      case "splittext"                  => inferSplitText(config, inputSchema)
      case "extractheadings"            => inferExtractHeadings(config, inputSchema)
      case "chunkbytokencount"          => inferChunkByTokenCount(config, inputSchema)
      case unknown                      =>
        (inputSchema, Some(s"Unknown op: '$unknown'"))
    }

  // ── Per-op inference rules ────────────────────────────────────────────────

  /** select — keep only fields whose names appear in config.fields (in inputSchema order). */
  private def inferSelect(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("select", config) { json =>
      val fields = json.fields("fields").convertTo[Vector[String]]
      inputSchema.filter(f => fields.contains(f.name))
    } (inputSchema)

  /** rename — replace field names per config.renames map. */
  private def inferRename(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("rename", config) { json =>
      val renames = json.fields("renames").convertTo[Map[String, String]]
      inputSchema.map(f => f.copy(name = renames.getOrElse(f.name, f.name)))
    } (inputSchema)

  /** cast — retype fields per config.casts map (field name → new type string). */
  private def inferCast(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("cast", config) { json =>
      val casts = json.fields("casts").convertTo[Map[String, String]]
      inputSchema.map(f => f.copy(`type` = casts.getOrElse(f.name, f.`type`)))
    } (inputSchema)

  /** compute — append a single derived field to the existing schema.
   *
   *  Config shape: {"column": "outputField", "expression": "$fieldA / $fieldB", "type": "number"}
   *  `expression` is validated with the strict (`$`-required) `ExpressionEvaluator.validate`
   *  and, on success, drives the output field's type via `ExpressionEvaluator.inferType` —
   *  the wire `type` is only a best-effort fallback for a currently-invalid or legacy-style
   *  (bare-identifier) expression (design.md Decision 5). This method wraps the whole
   *  extraction + validation in one `try` so a malformed JSON config (missing/wrong-typed
   *  keys) short-circuits to the generic `Some(s"compute config error: ...")` branch before
   *  any expression-validity logic runs — a JSON-shape error and an expression-validity
   *  error are never confused with each other. */
  private def inferCompute(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json       = config.parseJson.asJsObject
      val column     = json.fields("column").convertTo[String]
      val expression = json.fields("expression").convertTo[String]
      val wireType   = json.fields("type").convertTo[String]
      val fieldNames = inputSchema.map(_.name).toSet

      ExpressionEvaluator.validate(expression, fieldNames) match {
        case Left(validationMsg) =>
          (inputSchema :+ SchemaField(name = column, `type` = wireType), Some(validationMsg))
        case Right(_) =>
          val fieldTypes = inputSchema.map(f => f.name -> f.`type`).toMap
          val outputType = ExpressionEvaluator.inferType(expression, fieldTypes).getOrElse(wireType)
          (inputSchema :+ SchemaField(name = column, `type` = outputType), None)
      }
    } catch {
      case ex: Exception =>
        (inputSchema, Some(s"compute config error: ${ex.getMessage}"))
    }

  /** aggregate — groupBy fields ++ aggregation alias fields.
   *
   *  config.groupBy: Array<{ name, type }>
   *  config.aggregations: Array<{ alias, fn, field }>
   */
  private def inferAggregate(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("aggregate", config) { json =>
      val groupByFields = json.fields("groupBy").convertTo[Vector[JsValue]].map { v =>
        val obj = v.asJsObject
        SchemaField(
          name  = obj.fields("name").convertTo[String],
          `type` = obj.fields("type").convertTo[String]
        )
      }
      val aggFields = json.fields("aggregations").convertTo[Vector[JsValue]].map { v =>
        val obj   = v.asJsObject
        val alias = obj.fields("alias").convertTo[String]
        val fn    = obj.fields("fn").convertTo[String]
        val field = obj.fields("field").convertTo[String]
        SchemaField(name = alias, `type` = aggResultType(fn, field, inputSchema))
      }
      groupByFields ++ aggFields
    } (inputSchema)

  /** splittext (HEL-219) — mirrors `inferCompute`'s validate-then-shape pattern.
   *
   *  Looks up `config.field` in `inputSchema`. If absent, flags an unknown-field
   *  `validationError` and passes the schema through unchanged (identity
   *  fallback). If present but not `"string-body"`, flags a not-a-content-field
   *  `validationError`, likewise passing the schema through unchanged. On
   *  success, appends `indexField` as `"integer"` (replacing any existing field
   *  of the same name — same collision rule `compute` already applies). */
  private def inferSplitText(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
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
        (inputSchema, Some(s"splittext config error: ${ex.getMessage}"))
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
  private def inferExtractHeadings(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
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
        (inputSchema, Some(s"extractheadings config error: ${ex.getMessage}"))
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
  private def inferChunkByTokenCount(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
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
        (inputSchema, Some(s"chunkbytokencount config error: ${ex.getMessage}"))
    }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Safely parse the JSON config and apply the transformation.
   *  On any parse/extraction failure, returns (inputSchema, Some(errorMessage)). */
  private def parseConfig(op: String, config: String)(
      fn: JsObject => Vector[SchemaField]
  )(fallback: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json   = config.parseJson.asJsObject
      val output = fn(json)
      (output, None)
    } catch {
      case ex: Exception =>
        (fallback, Some(s"$op config error: ${ex.getMessage}"))
    }

  /** Determine the output type of an aggregation function applied to `field`. */
  private def aggResultType(fn: String, field: String, inputSchema: Vector[SchemaField]): String =
    fn match {
      case "count"      => "integer"
      case "sum" | "avg" => "number"
      case "min" | "max" => inputSchema.find(_.name == field).map(_.`type`).getOrElse("string")
      case _            => "string"
    }
}
