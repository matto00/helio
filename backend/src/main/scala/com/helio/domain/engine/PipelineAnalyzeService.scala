package com.helio.domain.engine

import com.helio.domain.model.DataType
import com.helio.domain.steps.{
  AggregateConfig, AggregateStep, FillNullConfig, FillNullStep, GroupByConfig, GroupByStep,
  JoinConfig, JoinStep, PivotConfig, PivotStep, StringOpsConfig, StringOpsStep, UnionConfig, UnionStep,
  WindowConfig, WindowStep
}
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._


final case class SchemaField(name: String, `type`: String)


object PipelineAnalyzeService {

  private val log = LoggerFactory.getLogger(getClass)

  /** JSON codec for `SchemaField` (design D2's `{name, type}` shape) — shared
    * by `PipelineRunService` (serializing the run-success baseline into
    * `pipelines.last_source_schema`) and `PipelineService` (tolerant-parsing
    * it back out at analyze time), so both sides of the HEL-462 baseline
    * round-trip through one definition. */
  implicit val schemaFieldJsonFormat: RootJsonFormat[SchemaField] = jsonFormat2(SchemaField.apply)

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

  /** Derive a pipeline's source schema from its source DataType's declared
   *  fields (name + type) — the single derivation both `PipelineService.analyze`
   *  and `PipelineRunService`'s run-success baseline capture use (HEL-462
   *  design D1), so the two provably stay in lockstep and "no drift" is the
   *  guaranteed steady-state for an unchanged source. Mirrors the existing
   *  `sourceDataTypes.headOption.toVector.flatMap(_.fields)` shape: a source
   *  has at most one companion DataType, so only its `.headOption` is used. */
  def deriveSourceSchema(sourceDataTypes: Vector[DataType]): Vector[SchemaField] =
    sourceDataTypes.headOption.toVector.flatMap(_.fields).map(f => SchemaField(f.name, f.dataType))

  /** Propagate schemas through the ordered step list.
   *
   *  Step 0's inputSchema == sourceSchema.
   *  Step N's inputSchema == step (N-1)'s outputSchema.
   *  If a step has a validationError, its outputSchema equals its inputSchema (identity fallback)
   *  so that downstream steps continue with a meaningful schema. */
  def analyze(steps: Vector[PipelineStepInput], sourceSchema: Vector[SchemaField]): Vector[AnalyzedStep] = {
    var currentSchema = sourceSchema
    steps.map { step =>
      // HEL-859 (design.md Decision 4): the config-validation hook runs
      // BEFORE the per-kind infer* dispatch. On a validation failure the
      // output schema falls back to identity (same contract a validation
      // error from infer* itself already used) and infer* is never called
      // for this step — validation and inference are deliberately kept
      // separate (inference stays tolerant, validation is strict).
      val (output, err) = validateStepConfig(step.op, step.config) match {
        case Some(msg) => (currentSchema, Some(msg))
        case None      => inferOutputSchema(step.op, step.config, currentSchema)
      }
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

  /** HEL-859 (design.md Decisions 4/5/6/7): analyze-time validation of step
   *  config values that today are checked only at execution. Dispatched by
   *  `kind`, taking the RAW config string (not a decoded typed config) —
   *  design.md Decision 7's constraint for HEL-860, which needs to see keys
   *  the typed decoder silently drops. Each per-kind validator decodes the
   *  config with that step's own tolerant `*Config.decode` and re-checks the
   *  same `SupportedX` val the engine's own runtime check uses (Decision 5),
   *  so this can never reject a value the engine accepts.
   *
   *  Scope is exactly Decision 6's enum-valued-config list; every other step
   *  kind returns `None` unconditionally. Multiple failures for one step are
   *  joined into a single message (Decision 7's corollary, task 3.3) rather
   *  than one silently winning — the corollary HEL-860 must also respect. */
  private def validateStepConfig(kind: String, config: String): Option[String] = {
    // A malformed (non-JSON / wrong-shape) config is NOT this hook's concern
    // — that is exactly the "<op> config error" category the existing
    // `inferOutputSchema`/`parseConfig` try/catch already reports, and this
    // hook runs BEFORE that dispatch (Decision 4). Swallow any decode
    // exception here so a malformed config falls through to the unchanged
    // downstream handling rather than this hook reporting a different
    // (untyped, unaudited) validationError for the same root cause.
    val problems: Vector[String] =
      try {
        kind match {
          case StringOpsStep.Kind => validateStringOps(config)
          case FillNullStep.Kind  => validateFillNull(config)
          case WindowStep.Kind    => validateWindow(config)
          case AggregateStep.Kind => validateAggregate(config)
          case GroupByStep.Kind   => validateGroupBy(config)
          case PivotStep.Kind     => validatePivot(config)
          case UnionStep.Kind     => validateUnion(config)
          case JoinStep.Kind      => validateJoin(config)
          case _                  => Vector.empty
        }
      } catch {
        case _: Exception => Vector.empty
      }
    if (problems.isEmpty) None else Some(problems.mkString("; "))
  }

  private def validateStringOps(config: String): Vector[String] = {
    val cfg = StringOpsConfig.decode(config)
    if (StringOpsStep.SupportedOperations.contains(cfg.operation)) Vector.empty
    else Vector(s"Unsupported stringops operation: '${cfg.operation}'. Supported: ${StringOpsStep.SupportedOperations.mkString(", ")}")
  }

  private def validateFillNull(config: String): Vector[String] = {
    val cfg = FillNullConfig.decode(config)
    if (!FillNullStep.SupportedStrategies.contains(cfg.strategy))
      Vector(s"Unsupported fillnull strategy: '${cfg.strategy}'. Supported: ${FillNullStep.SupportedStrategies.mkString(", ")}")
    else if (cfg.strategy == "constant" && cfg.value.isEmpty)
      Vector("fillnull strategy 'constant' requires 'value'")
    else Vector.empty
  }

  private def validateWindow(config: String): Vector[String] = {
    val cfg = WindowConfig.decode(config)
    if (!WindowStep.SupportedFunctions.contains(cfg.function))
      Vector(s"Unsupported window function: '${cfg.function}'. Supported: ${WindowStep.SupportedFunctions.mkString(", ")}")
    else {
      val fieldProblem =
        if (WindowStep.FieldRequired.contains(cfg.function) && cfg.field.isEmpty)
          Some(s"window function '${cfg.function}' requires 'field'")
        else None
      val offsetProblem =
        if ((cfg.function == "lag" || cfg.function == "lead") && cfg.offset.exists(_ <= 0))
          Some(s"window function '${cfg.function}' requires a positive 'offset', got ${cfg.offset.get}")
        else None
      Vector(fieldProblem, offsetProblem).flatten
    }
  }

  private def validateAggregate(config: String): Vector[String] = {
    val cfg = AggregateConfig.decode(config)
    cfg.aggregations.flatMap { agg =>
      val fn = agg.fn.toLowerCase
      if (AggregateStep.SupportedFunctions.contains(fn)) None
      else Some(s"Unsupported aggregation function: '$fn'. Supported: ${AggregateStep.SupportedFunctions.mkString(", ")}")
    }
  }

  private def validateGroupBy(config: String): Vector[String] = {
    val cfg = GroupByConfig.decode(config)
    val fn  = cfg.aggFunction.toLowerCase
    if (GroupByStep.SupportedFunctions.contains(fn)) Vector.empty
    else Vector(s"Unsupported aggregation function: '$fn'. Supported: ${GroupByStep.SupportedFunctions.mkString(", ")}")
  }

  private def validatePivot(config: String): Vector[String] = {
    val cfg = PivotConfig.decode(config)
    if (PivotStep.SupportedAggs.contains(cfg.agg)) Vector.empty
    else Vector(s"Unsupported pivot aggregation function: '${cfg.agg}'. Supported: ${PivotStep.SupportedAggs.mkString(", ")}")
  }

  private def validateUnion(config: String): Vector[String] = {
    val cfg = UnionConfig.decode(config)
    if (UnionStep.SupportedModes.contains(cfg.mode)) Vector.empty
    else Vector(s"Unsupported union mode: '${cfg.mode}'. Supported: ${UnionStep.SupportedModes.mkString(", ")}")
  }

  private def validateJoin(config: String): Vector[String] = {
    val cfg             = JoinConfig.decode(config)
    val normalizedType = cfg.joinType.toLowerCase
    if (JoinStep.SupportedJoinTypes.contains(normalizedType)) Vector.empty
    else Vector(s"Unsupported join type: '$normalizedType'. Supported: ${JoinStep.SupportedJoinTypes.mkString(", ")}")
  }


  private def inferOutputSchema(
      op:          String,
      config:      String,
      inputSchema: Vector[SchemaField]
  ): (Vector[SchemaField], Option[String]) =
    op match {
      // "union" (HEL-384, design.md Decision 6): documented best-effort
      // passthrough — the other source's schema isn't resolvable here (this
      // layer has no repo access), so output schema = input schema
      // unchanged. A real dispatch case, not the unknown-op fallback below,
      // so analyze_pipeline never emits a false validationError for a union
      // step (unlike JoinStep, which has no case here at all).
      case "filter" | "limit" | "sort" | "dedupe" | "fillnull" | "union" => (inputSchema, None)
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
      case "stringops"                  => inferStringOps(config, inputSchema)
      case "lookup"                     => inferLookup(config, inputSchema)
      case "assert"                     => inferAssert(config, inputSchema)
      case unknown                      =>
        (inputSchema, Some(s"Unknown op: '$unknown'"))
    }


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
  private def inferStringOps(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("stringops", config) { json =>
      val outputColumn = json.fields("outputColumn").convertTo[String]
      inputSchema.filterNot(_.name == outputColumn) :+ SchemaField(name = outputColumn, `type` = "string")
    } (inputSchema)

  /** lookup (HEL-386) — design.md Decision 7: additive, family-(b) best-effort
   *  typing (like `stringops`/`window`'s fallback case) rather than the
   *  identity-passthrough group `join`/`union` belong to. The reference
   *  source's schema isn't resolvable at this layer (no repo access, same
   *  limitation `union` already documents), so each name in `config.columns`
   *  is appended typed `string`, replacing any existing same-named field in
   *  place (`filterNot` + `:+` per column, generalizing the single-output-
   *  column collision-safe shape `inferStringOps`/`inferWindow` use to a
   *  `Vector[String]` of output columns). No field-existence validation is
   *  performed on `sourceKey` — like `stringops`/`datebucket`, `lookup`
   *  accepts any field name and null-coerces at execute time — so this
   *  dedicated dispatch case never emits a false `validationError`. */
  private def inferLookup(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    parseConfig("lookup", config) { json =>
      val columns = json.fields.get("columns").map(_.convertTo[Vector[String]]).getOrElse(Vector.empty[String])
      columns.foldLeft(inputSchema) { (schema, col) =>
        schema.filterNot(_.name == col) :+ SchemaField(name = col, `type` = "string")
      }
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
  private def inferAssert(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
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
