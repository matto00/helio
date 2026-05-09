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

  /** compute — append user-declared output fields to the existing schema. */
  private def inferCompute(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("compute", config) { json =>
      val outputs = json.fields("outputs").convertTo[Vector[JsValue]]
      val newFields = outputs.map { v =>
        val obj = v.asJsObject
        SchemaField(
          name  = obj.fields("name").convertTo[String],
          `type` = obj.fields("type").convertTo[String]
        )
      }
      inputSchema ++ newFields
    } (inputSchema)

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
