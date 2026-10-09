package com.helio.domain.engine

import com.helio.domain.model.DataFieldType
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._

import StepSchemaInference.parseConfig

/** HEL-1385: reshaping per-op schema inference (datebucket, pivot, window, unpivot, stringops, assert). */
private[engine] object ReshapeSchemaInference {

  private val log = LoggerFactory.getLogger(PipelineAnalyzeService.getClass)

  /** datebucket (HEL-378) — output schema = input schema with the resolved
   *  output field (`outputColumn` if present and non-blank, else `field`)
   *  typed `timestamp` (HEL-895/638: canonical DataFieldType — `date` is NOT one of the
   *  seven canonical wire values): replace-in-place if the resolved name already exists in
   *  `inputSchema`, append if new (design.md decision 4 — `filterNot` + `:+`,
   *  the same collision-safe shape `inferSplitText`/`inferExtractHeadings`/
   *  `inferChunkByTokenCount` use, not `inferCompute`'s unconditional
   *  append). No field-existence/type validation is performed on `field`
   *  itself — `datebucket` (unlike the string-body text ops) accepts any
   *  scalar field and null-coerces unparseable values at execute time. */
  private[engine] def inferDateBucket(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("datebucket", config) { json =>
      val field        = json.fields("field").convertTo[String]
      val outputColumn = json.fields.get("outputColumn").collect { case JsString(s) if s.nonEmpty => s }
      val resolvedName = outputColumn.getOrElse(field)
      inputSchema.filterNot(_.name == resolvedName) :+ SchemaField(name = resolvedName, `type` = "timestamp")
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
  private[engine] def inferPivot(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
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
   *  rank family, `float` for `running_sum` (HEL-895/638: canonical DataFieldType, not "number"), the same declared type as
   *  `field`'s entry in `inputSchema` for `lag`/`lead` (falling back to
   *  `string` if `field` is absent from `inputSchema`). An unrecognized
   *  `function` string degrades gracefully rather than erroring, falling
   *  back to `string` — the same catch-all precedent `aggResultType` uses
   *  for an unrecognized aggregation function below. */
  private[engine] def inferWindow(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("window", config) { json =>
      val function     = json.fields("function").convertTo[String]
      val field        = json.fields.get("field").collect { case JsString(s) => s }
      val outputColumn = json.fields("outputColumn").convertTo[String]
      val outputType = function match {
        case "row_number" | "rank" | "dense_rank" => "integer"
        case "running_sum"                        => "float"
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
  private[engine] def inferUnpivot(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
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

  /** stringops (HEL-389) — design.md decision 8: joins the append-or-replace
   *  family (`datebucket`/`window`) rather than the identity-passthrough
   *  group, since `stringops` always types `outputColumn` as `string`.
   *  Output schema = input schema with `outputColumn` typed `string`:
   *  replace-in-place if `outputColumn` already exists in `inputSchema`
   *  (including the `outputColumn == field` overwrite case), append if new
   *  (`filterNot` + `:+`, the same collision-safe shape `inferDateBucket`/
   *  `inferWindow` use). No field-existence validation is performed on
   *  `field`/`fields` at analyze time — like `datebucket`, `stringops`
   *  accepts any scalar field and null-coerces unparseable/missing values at
   *  execute time rather than rejecting at analyze time. */
  private[engine] def inferStringOps(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("stringops", config) { json =>
      val outputColumn = json.fields("outputColumn").convertTo[String]
      inputSchema.filterNot(_.name == outputColumn) :+ SchemaField(name = outputColumn, `type` = "string")
    } (inputSchema)

  /** assert (HEL-454 / 419-A) — design.md Decision 5: a dedicated dispatch
   *  case (not the blanket identity group `filter`/`limit`/`sort`/`dedupe`/
   *  `fillnull`/`union` share), since `assert` always returns `inputSchema`
   *  unchanged but *can* emit a `validationError` — closer in shape to
   *  `inferPivot`/`inferUnpivot`'s validate-but-stay-identity pattern than to
   *  `splittext`'s validate-and-reshape pattern. Every rule's kind/severity/
   *  field problems are aggregated into one `validationError` message
   *  (matching `inferPivot`/`inferUnpivot`'s multi-field aggregation), not
   *  short-circuited on the first bad rule. `notNull`/`unique`/`range`/
   *  `regex` require `field` and are checked against `inputSchema`;
   *  `rowCountMin`/`rowCountMax` are dataset-level and are never checked
   *  against `field` (design.md Decision 4). No `params` shape validation —
   *  that's 419-B's job (design.md Decision 6). */
  private[engine] def inferAssert(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json       = config.parseJson.asJsObject
      val rules      = json.fields.get("rules").map(_.convertTo[Vector[JsValue]]).getOrElse(Vector.empty[JsValue])
      val fieldNames = inputSchema.map(_.name).toSet

      val problems = rules.zipWithIndex.flatMap { case (ruleJson, idx) =>
        val obj      = ruleJson.asJsObject
        val kind     = obj.fields.get("kind").collect { case JsString(s) => s }.getOrElse("")
        val field    = obj.fields.get("field").collect { case JsString(s) => s }
        val severity = obj.fields.get("severity").collect { case JsString(s) => s }.getOrElse("")

        val kindProblem =
          if (!AssertRuleKinds.contains(kind)) Some(s"rule ${idx + 1}: invalid kind '$kind'") else None
        val severityProblem =
          if (severity != "warn" && severity != "error") Some(s"rule ${idx + 1}: invalid severity '$severity'") else None
        val fieldProblem =
          if (AssertFieldRequiredKinds.contains(kind)) {
            field match {
              case None                               => Some(s"rule ${idx + 1}: missing field")
              case Some(f) if !fieldNames.contains(f) => Some(s"rule ${idx + 1}: unknown field '$f'")
              case _                                  => None
            }
          } else None

        Vector(kindProblem, severityProblem, fieldProblem).flatten
      }

      if (problems.isEmpty) (inputSchema, None)
      else (inputSchema, Some(problems.mkString("; ")))
    } catch {
      case ex: Exception =>
        // HEL-311: keep the "<op> config error" category, drop the raw
        // exception tail; log the detail.
        log.warn("assert config error", ex)
        (inputSchema, Some("assert config error"))
    }

  /** Rule kinds that reference a specific `field` (design.md Decision 4). */
  private val AssertFieldRequiredKinds: Set[String] = Set("notNull", "unique", "range", "regex")

  /** All six v1 assert rule kinds — `AssertFieldRequiredKinds` plus the
   *  dataset-level `rowCountMin`/`rowCountMax`. */
  private val AssertRuleKinds: Set[String] = AssertFieldRequiredKinds ++ Set("rowCountMin", "rowCountMax")
}
