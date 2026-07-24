package com.helio.domain

import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._

// ── Shared schema field type (wire-format compatible) ─────────────────────────

final case class SchemaField(name: String, `type`: String)

// ── PipelineAnalyzeService — pure schema-math inference for all 8 ops ─────────

object PipelineAnalyzeService {

  private val log = LoggerFactory.getLogger(getClass)

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
      case "filter" | "limit" | "sort" | "dedupe" => (inputSchema, None)
      case "select"                     => inferSelect(config, inputSchema)
      case "rename"                     => inferRename(config, inputSchema)
      case "cast"                       => inferCast(config, inputSchema)
      case "compute"                    => inferCompute(config, inputSchema)
      case "aggregate"                  => inferAggregate(config, inputSchema)
      case "splittext"                  => inferSplitText(config, inputSchema)
      case "extractheadings"            => inferExtractHeadings(config, inputSchema)
      case "chunkbytokencount"          => inferChunkByTokenCount(config, inputSchema)
      case "datebucket"                 => inferDateBucket(config, inputSchema)
      case "pivot"                      => inferPivot(config, inputSchema)
      case "window"                     => inferWindow(config, inputSchema)
      case "unpivot"                    => inferUnpivot(config, inputSchema)
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
        // HEL-311: keep the "<op> config error" category (signals which step
        // is misconfigured), drop the raw exception tail; log the detail.
        log.warn("compute config error", ex)
        (inputSchema, Some("compute config error"))
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
        // HEL-311: keep the "<op> config error" category, drop the raw
        // exception tail; log the detail.
        log.warn("chunkbytokencount config error", ex)
        (inputSchema, Some("chunkbytokencount config error"))
    }

  /** datebucket (HEL-378) — output schema = input schema with the resolved
   *  output field (`outputColumn` if present and non-blank, else `field`)
   *  typed `date`: replace-in-place if the resolved name already exists in
   *  `inputSchema`, append if new (design.md decision 4 — `filterNot` + `:+`,
   *  the same collision-safe shape `inferSplitText`/`inferExtractHeadings`/
   *  `inferChunkByTokenCount` use, not `inferCompute`'s unconditional
   *  append). No field-existence/type validation is performed on `field`
   *  itself — `datebucket` (unlike the string-body text ops) accepts any
   *  scalar field and null-coerces unparseable values at execute time. */
  private def inferDateBucket(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("datebucket", config) { json =>
      val field        = json.fields("field").convertTo[String]
      val outputColumn = json.fields.get("outputColumn").collect { case JsString(s) if s.nonEmpty => s }
      val resolvedName = outputColumn.getOrElse(field)
      inputSchema.filterNot(_.name == resolvedName) :+ SchemaField(name = resolvedName, `type` = "date")
    } (inputSchema)

  /** pivot (HEL-375) — design.md decision 5: the output schema is *only* the
   *  `index` fields (types looked up by name in `inputSchema`); the dynamic
   *  `<values>_<v>` columns are NOT enumerated because their names depend on
   *  runtime data, which this schema-only pass never accesses. This is
   *  expected behavior, not an error — `validationError` stays `None` as
   *  long as `index`/`column`/`values` all name fields present in
   *  `inputSchema`.
   *
   *  If any `index` field, or `column`, or `values` names a field absent
   *  from `inputSchema`, a real `validationError` identifies the missing
   *  field(s) and the output schema falls back to `inputSchema` unchanged
   *  (identity fallback, matching every other op's failure contract — same
   *  pattern as `inferSplitText`'s unknown-field check). */
  private def inferPivot(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json   = config.parseJson.asJsObject
      val index  = json.fields.get("index").map(_.convertTo[Vector[String]]).getOrElse(Vector.empty[String])
      val column = json.fields.get("column").map(_.convertTo[String]).getOrElse("")
      val values = json.fields.get("values").map(_.convertTo[String]).getOrElse("")

      val schemaByName = inputSchema.map(f => f.name -> f).toMap
      val missing = index.filterNot(schemaByName.contains) ++
        Vector(column).filterNot(schemaByName.contains) ++
        Vector(values).filterNot(schemaByName.contains)

      if (missing.nonEmpty) {
        (inputSchema, Some(s"Unknown field(s): ${missing.map(m => s"'$m'").mkString(", ")}"))
      } else {
        (index.map(name => SchemaField(name = name, `type` = schemaByName(name).`type`)), None)
      }
    } catch {
      case ex: Exception =>
        // HEL-311: keep the "<op> config error" category, drop the raw
        // exception tail; log the detail.
        log.warn("pivot config error", ex)
        (inputSchema, Some("pivot config error"))
    }

  /** window (HEL-376) — design.md decision 6: output schema = input schema
   *  with `outputColumn` appended (or replaced in place if it collides with
   *  an existing field name — same collision rule `datebucket`/`splittext`
   *  apply, `filterNot` + `:+`). The output type is fully determined by
   *  `function` + the input schema, with no data sampling: `integer` for the
   *  rank family, `number` for `running_sum`, the same declared type as
   *  `field`'s entry in `inputSchema` for `lag`/`lead` (falling back to
   *  `string` if `field` is absent from `inputSchema`). An unrecognized
   *  `function` string degrades gracefully rather than erroring, falling
   *  back to `string` — the same catch-all precedent `aggResultType` uses
   *  for an unrecognized aggregation function below. */
  private def inferWindow(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("window", config) { json =>
      val function     = json.fields("function").convertTo[String]
      val field        = json.fields.get("field").collect { case JsString(s) => s }
      val outputColumn = json.fields("outputColumn").convertTo[String]
      val outputType = function match {
        case "row_number" | "rank" | "dense_rank" => "integer"
        case "running_sum"                        => "number"
        case "lag" | "lead" =>
          field.flatMap(f => inputSchema.find(_.name == f)).map(_.`type`).getOrElse("string")
        case _ => "string"
      }
      inputSchema.filterNot(_.name == outputColumn) :+ SchemaField(name = outputColumn, `type` = outputType)
    } (inputSchema)

  /** unpivot (HEL-380) — design.md decisions 6-8: unlike `pivot`, the output
   *  schema is fully static (no data sampling) — exactly `idVars` (types
   *  looked up in `inputSchema`), followed by `varName` typed `string`,
   *  followed by `valueName` typed per the common-type rule below, each
   *  append replacing an existing same-named field in place rather than
   *  duplicating it (`filterNot` + `:+`, the same collision-safe shape
   *  `inferDateBucket`/`inferSplitText` use — the `Vector[SchemaField]`
   *  equivalent of the execution path's `Map ++`).
   *
   *  `valueName`'s type is the shared declared type of every `valueVars`
   *  field if all identical; otherwise (including the empty-`valueVars`
   *  case) it falls back to `"string"`.
   *
   *  If any `idVars` or `valueVars` field name is absent from `inputSchema`,
   *  a real `validationError` identifies the missing field(s) and the output
   *  schema falls back to `inputSchema` unchanged (identity fallback, same
   *  pattern as `inferPivot`'s `index`/`column`/`values` existence check). */
  private def inferUnpivot(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json      = config.parseJson.asJsObject
      val idVars    = json.fields.get("idVars").map(_.convertTo[Vector[String]]).getOrElse(Vector.empty[String])
      val valueVars = json.fields.get("valueVars").map(_.convertTo[Vector[String]]).getOrElse(Vector.empty[String])
      val varName   = json.fields.get("varName").collect { case JsString(s) => s }.getOrElse("variable")
      val valueName = json.fields.get("valueName").collect { case JsString(s) => s }.getOrElse("value")

      val schemaByName = inputSchema.map(f => f.name -> f).toMap
      val missing      = (idVars ++ valueVars).filterNot(schemaByName.contains)

      if (missing.nonEmpty) {
        (inputSchema, Some(s"Unknown field(s): ${missing.map(m => s"'$m'").mkString(", ")}"))
      } else {
        val idFields   = idVars.map(name => SchemaField(name = name, `type` = schemaByName(name).`type`))
        val valueTypes = valueVars.map(v => schemaByName(v).`type`).distinct
        val valueType  = if (valueTypes.size == 1) valueTypes.head else "string"

        val withVar   = idFields.filterNot(_.name == varName) :+ SchemaField(name = varName, `type` = "string")
        val withValue = withVar.filterNot(_.name == valueName) :+ SchemaField(name = valueName, `type` = valueType)
        (withValue, None)
      }
    } catch {
      case ex: Exception =>
        // HEL-311: keep the "<op> config error" category, drop the raw
        // exception tail; log the detail.
        log.warn("unpivot config error", ex)
        (inputSchema, Some("unpivot config error"))
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
        // HEL-311: keep the "<op> config error" category, drop the raw
        // exception tail; log the detail.
        log.warn(s"$op config error", ex)
        (fallback, Some(s"$op config error"))
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
