package com.helio.domain.engine

import com.helio.domain.model.DataFieldType
import com.helio.domain.steps.{AggregateStep, CastStep, GroupByConfig, GroupByStep}
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._

import StepSchemaInference.parseConfig

/** HEL-1385: column-shaping per-op schema inference (select, rename, cast, compute, aggregate, groupby). */
private[engine] object ColumnSchemaInference {

  private val log = LoggerFactory.getLogger(PipelineAnalyzeService.getClass)

  /** select — keep only fields whose names appear in config.fields (in inputSchema order). */
  private[engine] def inferSelect(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("select", config) { json =>
      val fields = json.fields("fields").convertTo[Vector[String]]
      inputSchema.filter(f => fields.contains(f.name))
    } (inputSchema)

  /** rename — replace field names per config.renames map. */
  private[engine] def inferRename(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("rename", config) { json =>
      val renames = json.fields("renames").convertTo[Map[String, String]]
      inputSchema.map(f => f.copy(name = renames.getOrElse(f.name, f.name)))
    } (inputSchema)

  /** cast — retype fields per config.casts map (field name → new type string). */
  private[engine] def inferCast(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("cast", config) { json =>
      val casts = json.fields("casts").convertTo[Map[String, String]]
      // HEL-1436 D4a: a target outside CastStep.SupportedTargets is the run-time's explicit legacy
      // passthrough, so the field keeps its input type.
      inputSchema.map { f =>
        val projected = casts.get(f.name).filter(CastStep.SupportedTargets.contains).map(canonicalizeLegacyType)
        f.copy(`type` = projected.getOrElse(f.`type`))
      }
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
  private[engine] def inferCompute(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json       = config.parseJson.asJsObject
      val column     = json.fields("column").convertTo[String]
      val expression = json.fields("expression").convertTo[String]
      // HEL-1417: `type` is an optional hint (`ComputeConfig.type`); absent or null both count as
      // no hint. A present non-string value still throws into the generic branch below.
      val wireType   = json.fields.get("type").filter(_ != JsNull).map(_.convertTo[String])
      val hintType   = wireType.map(canonicalizeLegacyType).getOrElse("string")
      val fieldNames = inputSchema.map(_.name).toSet

      ExpressionEvaluator.validate(expression, fieldNames) match {
        case Left(validationMsg) =>
          (inputSchema :+ SchemaField(name = column, `type` = hintType), Some(validationMsg))
        case Right(_) =>
          val fieldTypes = inputSchema.map(f => f.name -> f.`type`).toMap
          // HEL-1423: unknown fields are already rejected by `validate`, so a Left here is the
          // coalesce mixed-type error; keep the wire-type fallback column and surface the message.
          ExpressionEvaluator.inferType(expression, fieldTypes) match {
            case Right(t)  => (inputSchema :+ SchemaField(name = column, `type` = t), None)
            case Left(msg) =>
              (inputSchema :+ SchemaField(name = column, `type` = hintType), Some(msg))
          }
      }
    } catch {
      case ex: Exception =>
        // HEL-311: keep the "<op> config error" category (signals which step
        // is misconfigured), drop the raw exception tail; log the detail.
        log.warn("compute config error", ex)
        (inputSchema, Some("compute config error"))
    }

  /** HEL-906 cycle 3 (evaluation-2.md finding): both `compute`'s config-supplied `type`
   *  fallback and `cast`'s config-supplied `casts` target-type strings are legacy/free-form
   *  caller input (design.md Decision 5's "best-effort fallback" for compute; `cast`'s
   *  `CastStep.castValue` dispatch set for cast) -- normalizes every known non-canonical
   *  synonym (`"number"`/`"double"` -> `"float"`, `"long"` -> `"integer"`, `"date"` ->
   *  `"timestamp"`) to the canonical `DataFieldType` wire value before it lands in a
   *  projected `SchemaField`, so neither path reintroduces the same "silently dropped from
   *  capabilities" bug `aggResultType`/`inferWindow`/`inferDateBucket` had (HEL-895/638).
   *  Any other caller-supplied string (including an already-canonical one) passes through
   *  unchanged -- this is normalization of known synonyms, not full validation. */
  private def canonicalizeLegacyType(wireType: String): String =
    DataFieldType.canonicalizeLegacy(wireType)

  /** aggregate — groupBy fields ++ aggregation alias fields.
   *
   *  config.groupBy: Array<{ name, type }>
   *  config.aggregations: Array<{ alias, fn, field }>
   */
  private[engine] def inferAggregate(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json       = config.parseJson.asJsObject
      val groupByRaw = json.fields("groupBy").convertTo[Vector[JsValue]].map(_.asJsObject)
      // HEL-906 cycle 5 (coordinator ruling, AC-3 "boundary validation"): every `groupBy`
      // entry's caller-supplied `type` must resolve to a canonical DataFieldType, or the
      // whole step is rejected with a validationError naming the offending field(s) and every
      // valid type -- `canonicalizeLegacy` alone (cycle 4) only normalized KNOWN synonyms and
      // silently passed an unrecognized string straight through into the projected schema.
      // Checked explicitly (not via the generic `parseConfig`/`SchemaField`'s `require`
      // catch-all below) so the message names the actual bad value and every valid type,
      // matching this file's existing convention for a targeted business-rule violation
      // (e.g. `inferCompute`'s "Unknown field: X") rather than the generic "<op> config error"
      // category HEL-311 reserves for a genuinely malformed/unparseable config.
      val invalidGroupByTypes = groupByRaw.flatMap { obj =>
        val name    = obj.fields("name").convertTo[String]
        val rawType = obj.fields("type").convertTo[String]
        DataFieldType.validateAndCanonicalize(rawType) match {
          case Left(_)  => Some(name -> rawType)
          case Right(_) => None
        }
      }
      if (invalidGroupByTypes.nonEmpty) {
        val detail = invalidGroupByTypes.map { case (name, badType) => s"'$name': '$badType'" }.mkString(", ")
        (inputSchema, Some(
          s"aggregate: invalid groupBy type(s): $detail. Valid types: ${DataFieldType.CanonicalWireValues.mkString(", ")}"
        ))
      } else {
        val groupByFields = groupByRaw.map { obj =>
          val rawType = obj.fields("type").convertTo[String]
          SchemaField(
            name   = obj.fields("name").convertTo[String],
            `type` = DataFieldType.validateAndCanonicalize(rawType).getOrElse(rawType) // validated above; getOrElse unreachable
          )
        }
        val aggFields = json.fields("aggregations").convertTo[Vector[JsValue]].map { v =>
          val obj   = v.asJsObject
          val alias = obj.fields("alias").convertTo[String]
          val fn    = obj.fields("fn").convertTo[String].toLowerCase
          val field = obj.fields("field").convertTo[String]
          SchemaField(name = alias, `type` = aggregateResultType(fn, field, inputSchema))
        }
        (groupByFields ++ aggFields, None)
      }
    } catch {
      case ex: Exception =>
        // HEL-311: keep the "<op> config error" category, drop the raw exception tail; log
        // the detail. Reserved for genuinely malformed/unparseable JSON -- an invalid groupBy
        // type is handled above with its own specific, actionable message instead.
        log.warn("aggregate config error", ex)
        (inputSchema, Some("aggregate config error"))
    }

  /** groupby (HEL-872, design.md Decisions 1-3) -- `groupby` had NO dispatch case at all
   *  before this ticket (every analyze call for a `groupby` step fell to the `unknown`-op
   *  arm below, reporting a spurious "Unknown op: 'groupby'" on every valid step). Output
   *  is the group-key fields (in config order, typed from `inputSchema` by name -- a key
   *  column absent from `inputSchema` is a documented best-effort `string`, mirroring this
   *  file's existing fallback convention) followed by one aggregate column named via
   *  `GroupByStep.outputColumnName` and typed via `aggResultType`, matching
   *  `GroupByStep.apply`'s runtime shape exactly. `aggFunction` is lowercased ONCE and that
   *  same value feeds both the column name and `aggResultType` -- `aggResultType` matches
   *  the raw string and falls back to `"string"`, while `validateGroupBy` already lowercases
   *  before checking `SupportedFunctions`, so an un-lowercased `"SUM"` would otherwise
   *  project `"string"` instead of `"float"`. */
  private[engine] def inferGroupBy(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("groupby", config) { json =>
      val cfg = GroupByConfig.decode(config)
      val fn  = cfg.aggFunction.toLowerCase
      val keyFields = cfg.groupBy.map { name =>
        // Best-effort `string` when the groupBy column is absent from the input
        // schema (design.md Decision 3) -- never a confident but possibly-wrong type.
        val fieldType = inputSchema.find(_.name == name).map(_.`type`).getOrElse("string")
        SchemaField(name = name, `type` = fieldType)
      }
      val aggField = SchemaField(
        name    = GroupByStep.outputColumnName(cfg),
        `type` = aggResultType(fn, cfg.aggColumn, inputSchema)
      )
      keyFields :+ aggField
    } (inputSchema)

  /** Result type of an `aggregate`-op function. `AggregateStep.apply` computes min/max over
   *  `PipelineRowJson.toDouble`, so it always yields a Double (or null) whatever the field's
   *  declared type; reporting the declared type would be a lie. `groupby` keeps `aggResultType`
   *  because its Spark path preserves the column type. */
  private def aggregateResultType(fn: String, field: String, inputSchema: Vector[SchemaField]): String =
    fn match {
      case "min" | "max" => "float"
      case _             => aggResultType(fn, field, inputSchema)
    }

  /** Determine the output type of an aggregation function applied to `field`. */
  private def aggResultType(fn: String, field: String, inputSchema: Vector[SchemaField]): String =
    fn match {
      case "count" | "count_distinct" => "integer"
      case "sum" | "avg" | "median" | "percentile" => "float"
      case "min" | "max" => inputSchema.find(_.name == field).map(_.`type`).getOrElse("string")
      case _            => "string"
    }
}
