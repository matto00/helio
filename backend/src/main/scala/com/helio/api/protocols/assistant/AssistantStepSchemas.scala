package com.helio.api.protocols.assistant

import com.helio.domain.model.PipelineStepKind
import com.helio.domain.steps.{AggregateStep, CastStep}
import com.helio.services.pipelines.ProposalStepRules
import spray.json._

/** HEL-1639 D3: the strict step schema the assistant's pipeline tools offer. The step `type` is an enum of the
 *  registry's AUTHORABLE kinds (never a hand list), the nine ops the assistant uses most carry a per-op `config` schema
 *  with `additionalProperties: false` whose `required` keys come from [[ProposalStepRules.RequiredKeys]], and the
 *  `compute` description carries the expression grammar with examples. Every other authorable op keeps a plain
 *  `config` object. `AssistantStepSchemasSpec` pins the enum to the registry, each example to the real validation, and
 *  each `required` list to what the validation actually enforces.
 *
 *  Why the agent-visible text is in this file and not in prose elsewhere: a model that guesses a config shape wastes
 *  tool calls (the 2026-10-16 transcript guessed `passthrough`, `lookup {}`, `record.settings.x` and `'settings.x'`). */
private[protocols] object AssistantStepSchemas {

  private def str(description: String): JsObject = JsObject("type" -> JsString("string"), "description" -> JsString(description))
  private def strings(description: String): JsObject =
    JsObject("type" -> JsString("array"), "items" -> JsObject("type" -> JsString("string")), "description" -> JsString(description))
  private def enumOf(values: Seq[String], description: String): JsObject =
    JsObject("type" -> JsString("string"), "enum" -> JsArray(values.map(JsString(_)).toVector), "description" -> JsString(description))
  private def obj(op: String, description: String, properties: (String, JsValue)*): JsObject =
    JsObject(
      "type"                 -> JsString("object"),
      "description"          -> JsString(description),
      "properties"           -> JsObject(properties.toMap),
      "required"             -> JsArray(ProposalStepRules.RequiredKeys.getOrElse(op, Vector.empty).map(JsString(_))),
      "additionalProperties" -> JsFalse
    )

  /** A lookup/join/union second input: a data source or another lane of the same pipeline. */
  private val SecondaryInput: JsObject = JsObject(
    "description" -> JsString("Where the second input comes from."),
    "oneOf" -> JsArray(
      JsObject(
        "type" -> JsString("object"),
        "properties" -> JsObject(
          "kind"         -> JsObject("type" -> JsString("string"), "enum" -> JsArray(JsString("source"))),
          "dataSourceId" -> str("Id of an existing data source (from find). An Output id is NOT a data source.")
        ),
        "required" -> JsArray(JsString("kind"), JsString("dataSourceId")),
        "additionalProperties" -> JsFalse
      ),
      JsObject(
        "type" -> JsString("object"),
        "properties" -> JsObject(
          "kind"   -> JsObject("type" -> JsString("string"), "enum" -> JsArray(JsString("lane"))),
          "stepId" -> str("Id of a step of the SAME pipeline whose output is the second input.")
        ),
        "required" -> JsArray(JsString("kind"), JsString("stepId")),
        "additionalProperties" -> JsFalse
      )
    )
  )

  /** Compute expression grammar, written once. The examples are executed by the spec. */
  val ComputeGrammar: String =
    "A column is referenced as $name (letters, digits, underscore; a dotted name is allowed: $settings.fpts). Literals are " +
      "numbers and \"double-quoted strings\" (single quotes are NOT valid). Operators: + - * / ( ), comparisons = != < <= > >=, " +
      "and or not, true false; use + to add numbers. Functions: abs add_days ceil coalesce concat date_trunc floor if length lower mod round " +
      "seconds_between substring upper. Examples: `$wins + $ties * 0.5`; `round($settings.fpts + $settings.fpts_decimal / 100, 2)`; " +
      "`if($wins > 8, \"top\", \"rest\")`."

  /** The per-op config schemas, by op. */
  val ConfigSchemas: Map[String, JsObject] = Map(
    "lookup" -> obj("lookup", "Adds the named columns from a second input to every row, matching sourceKey (a column of THIS node) to lookupKey (a column of the second input).",
      "secondaryInput" -> SecondaryInput,
      "sourceKey"      -> str("Column of the incoming rows to match on."),
      "lookupKey"      -> str("Column of the second input to match against."),
      "columns"        -> strings("Columns of the second input to add; the first match wins. A name already present is added as right_<name>.")),
    "compute" -> obj("compute", "Adds ONE new column computed per row. " + ComputeGrammar,
      "column"     -> str("Name of the new column."),
      "expression" -> str(ComputeGrammar),
      "type"       -> str("Optional output type hint; ignored by the engine.")),
    "select" -> obj("select", "Keeps only the listed columns (a name the incoming rows lack is silently dropped).",
      "fields" -> strings("Column names to keep, from the incoming node's outputSchema.")),
    "cast" -> obj("cast", "Converts the listed columns; a value that cannot convert becomes null.",
      "casts" -> JsObject(
        "type" -> JsString("object"),
        "description" -> JsString(s"Column name -> target type, one of ${CastStep.SupportedTargets.mkString(", ")}."),
        "additionalProperties" -> enumOf(CastStep.SupportedTargets, "Target type."))),
    "rename" -> obj("rename", "Renames columns.",
      "renames" -> JsObject(
        "type" -> JsString("object"),
        "description" -> JsString("Old column name -> new column name."),
        "additionalProperties" -> JsObject("type" -> JsString("string")))),
    "filter" -> obj("filter", "Keeps the rows that satisfy the conditions.",
      "combinator" -> enumOf(Seq("AND", "OR"), "How the conditions combine; default AND."),
      "conditions" -> JsObject(
        "type" -> JsString("array"),
        "items" -> JsObject(
          "type" -> JsString("object"),
          "properties" -> JsObject(
            "field"    -> str("Column to test."),
            "operator" -> enumOf(Seq("=", "!=", ">", ">=", "<", "<=", "contains", "is null", "is not null"), "Comparison."),
            "value"    -> str("Comparison value as text; omit for is null / is not null.")),
          "required" -> JsArray(JsString("field"), JsString("operator")),
          "additionalProperties" -> JsFalse))),
    "sort" -> obj("sort", "Sorts the rows (nulls last in both directions).",
      "sortBy" -> JsObject(
        "type" -> JsString("array"),
        "items" -> JsObject(
          "type" -> JsString("object"),
          "properties" -> JsObject("field" -> str("Column to sort by."), "direction" -> enumOf(Seq("asc", "desc"), "Sort direction.")),
          "required" -> JsArray(JsString("field"), JsString("direction")),
          "additionalProperties" -> JsFalse))),
    "limit" -> obj("limit", "Keeps the first count rows (use after sort for a top-N).",
      "count" -> JsObject("type" -> JsString("integer"), "minimum" -> JsNumber(1), "description" -> JsString("Number of rows to keep."))),
    "aggregate" -> obj("aggregate", "Groups the rows and emits one row per group with one column per aggregation.",
      "groupBy" -> JsObject(
        "type" -> JsString("array"),
        "description" -> JsString("Columns to group by; empty groups all rows together. type is the column's type from the incoming outputSchema."),
        "items" -> JsObject(
          "type" -> JsString("object"),
          "properties" -> JsObject("name" -> str("Column to group by."), "type" -> str("The column's type, e.g. string.")),
          "required" -> JsArray(JsString("name"), JsString("type")),
          "additionalProperties" -> JsFalse)),
      "aggregations" -> JsObject(
        "type" -> JsString("array"),
        "items" -> JsObject(
          "type" -> JsString("object"),
          "properties" -> JsObject(
            "alias" -> str("Name of the output column."),
            "fn"    -> enumOf(AggregateStep.SupportedFunctions, "Aggregation function."),
            "field" -> str("Column to aggregate (for count, any column)."),
            "p"     -> JsObject("type" -> JsString("number"), "description" -> JsString("Percentile 0-100; only with fn percentile."))),
          "required" -> JsArray(JsString("alias"), JsString("fn"), JsString("field")),
          "additionalProperties" -> JsFalse)))
  )

  /** A valid example config per op (executed against the real validation by `AssistantStepSchemasSpec`). */
  val Examples: Map[String, JsValue] = Map(
    "lookup"    -> """{"secondaryInput":{"kind":"source","dataSourceId":"ds_example_from_find"},"sourceKey":"owner_id","lookupKey":"user_id","columns":["display_name"]}""",
    "compute"   -> """{"column":"points_for","expression":"round($settings.fpts + $settings.fpts_decimal / 100, 2)"}""",
    "select"    -> """{"fields":["display_name","points_for"]}""",
    "cast"      -> """{"casts":{"revenue":"integer"}}""",
    "rename"    -> """{"renames":{"settings.wins":"wins"}}""",
    "filter"    -> """{"combinator":"AND","conditions":[{"field":"wins","operator":">","value":"5"}]}""",
    "sort"      -> """{"sortBy":[{"field":"revenue","direction":"desc"}]}""",
    "limit"     -> """{"count":3}""",
    "aggregate" -> """{"groupBy":[{"name":"region","type":"string"}],"aggregations":[{"alias":"total_revenue","fn":"sum","field":"revenue"}]}"""
  ).view.mapValues(_.parseJson).toMap

  /** The `oneOf` of per-op variants a step is validated against: each narrows `type` to one op and `config` to that
   *  op's schema. The ops without a per-op schema share one variant that keeps `config` a plain object. The step's other
   *  properties and `additionalProperties: false` live on the step schema itself (`AssistantProposalToolSchemas`). */
  val stepVariants: JsArray = {
    val typed = ConfigSchemas.toVector.sortBy(_._1).map { case (op, schema) =>
      JsObject(
        "properties" -> JsObject(
          "type"   -> JsObject("type" -> JsString("string"), "enum" -> JsArray(JsString(op))),
          "config" -> schema
        )
      ): JsValue
    }
    val others = (PipelineStepKind.Authorable -- ConfigSchemas.keySet).toVector.sorted
    JsArray(typed :+ JsObject(
      "properties" -> JsObject(
        "type"   -> JsObject("type" -> JsString("string"), "enum" -> JsArray(others.map(JsString(_)))),
        "config" -> JsObject("type" -> JsString("object"), "description" -> JsString("Config for this op; copy the shape of an existing step of the same type from get_resource."))
      )
    ))
  }
}
