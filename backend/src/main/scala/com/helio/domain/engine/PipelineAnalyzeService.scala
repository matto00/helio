package com.helio.domain.engine

import com.helio.domain.model.{DataFieldType, PipelineStep}
import com.helio.domain.steps.{
  AggregateConfig, AggregateStep, FillNullConfig, FillNullStep, GroupByConfig, GroupByStep,
  JoinConfig, JoinStep, LookupConfig, PivotConfig, PivotStep, SecondaryInput, StringOpsConfig, StringOpsStep,
  UnionConfig, UnionStep, WindowConfig, WindowStep
}
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._


/** HEL-906 cycle 5 (coordinator ruling, AC-3 "real structural guard"): `require` in the
 *  primary constructor is the ONE choke point every `SchemaField(...)` construction site in the
 *  whole codebase passes through, whichever of the 31+ sites it is -- there is no way to build a
 *  `SchemaField` with a non-canonical `type` string without an immediate `IllegalArgumentException`
 *  at construction time. This is deliberately a hard failure (not a silent `Either`/`Option`
 *  return), because a `SchemaField` with a bad type is a programming error at every INTERNAL
 *  call site (they should already be canonical, e.g. via `DataFieldType.asString`/
 *  `canonicalizeLegacy`) -- the two BOUNDARY call sites that accept a raw, unvalidated
 *  caller-supplied `type` string over the wire (`DataSourceService.createStatic`,
 *  `PipelineAnalyzeService.inferAggregate`'s `groupBy`) validate with `DataFieldType.fromString`
 *  and return a clean 400 BEFORE ever reaching this constructor, so a malformed request never
 *  hits this `require` in practice -- it exists to catch any FUTURE producer that skips that
 *  boundary check, converting the old silent-`case other => other`-passthrough gap
 *  `canonicalizeLegacy` still has into a fail-loud bug instead of a silently-corrupted row.
 *  `SchemaFieldStructuralGuardSpec` asserts this directly (constructing a `SchemaField` with a
 *  garbage type throws), so a future refactor that removes this `require` fails a test, not just
 *  a review. */
final case class SchemaField(name: String, `type`: String) {
  require(
    DataFieldType.fromString(`type`).isDefined,
    s"SchemaField: '${`type`}' is not a canonical DataFieldType wire value for field '$name'. " +
      s"Valid values: ${DataFieldType.CanonicalWireValues.mkString(", ")}"
  )
}


object PipelineAnalyzeService {

  private val log = LoggerFactory.getLogger(getClass)

  /** JSON codec for `SchemaField` (design D2's `{name, type}` shape) — shared
    * by `PipelineRunService` (serializing the run-success baseline into
    * `pipelines.last_source_schema`) and `PipelineService` (tolerant-parsing
    * it back out at analyze time), so both sides of the HEL-462 baseline
    * round-trip through one definition. */
  /** HEL-906 cycle 5 (coordinator ruling, AC-3 "dev DB check" fallout): hand-rolled, not
   *  `jsonFormat2`, so `read` can canonicalize a LEGACY-persisted, non-canonical `type` string
   *  (`"number"`/`"double"`/`"long"`/`"date"`) via `DataFieldType.canonicalizeLegacy` before it
   *  reaches `SchemaField`'s validating constructor. The dev-DB check this ruling required found
   *  real, already-persisted `data_sources.inferred_schema` rows with a `"number"` type (12 of
   *  141 rows, predating this ticket's fixes) -- without this tolerant read, EVERY subsequent
   *  deserialization of one of those rows (`GET /api/pipelines/:id/analyze`,
   *  `PipelineRunService.onRunSuccess`'s baseline capture, etc.) would throw `SchemaField`'s
   *  `require` and 500, converting quietly-wrong data into a hard outage for existing rows this
   *  same ticket already knows about. `write` always emits the canonical form (every
   *  in-process-constructed `SchemaField` is already canonical, by the structural guard).
   *
   *  HEL-906 cycle 6 (evaluation-5.md CR1's residual-hole callout): `canonicalizeLegacy` only
   *  maps the FOUR *known* legacy synonyms (`"number"`/`"double"`/`"long"`/`"date"`) -- a
   *  persisted row carrying a genuinely UNRECOGNIZED type (not one of those four, and not
   *  already canonical) would still reach `SchemaField`'s `require` and throw, 500ing on every
   *  subsequent read. The dev-DB check (HEL-932) found only the known `"number"` case live
   *  today, so this has not been observed in practice -- but leaving an unbounded read path
   *  able to 500 on ANY future stray value is a real, avoidable outage surface for a read-only
   *  deserialization path. Deliberate decision: widen the fallback to `StringType` (the most
   *  conservative canonical type -- never narrows a value that might not fit a numeric/temporal
   *  type) with a loud warning log carrying the row's raw value, rather than throw. This keeps
   *  reads from ever 500ing on stray persisted data while still surfacing the anomaly
   *  operationally (searchable log line) instead of silently normalizing it away. Write is
   *  unaffected -- every in-process value is already canonical by construction. */
  implicit val schemaFieldJsonFormat: RootJsonFormat[SchemaField] = new RootJsonFormat[SchemaField] {
    override def write(f: SchemaField): JsValue = JsObject("name" -> JsString(f.name), "type" -> JsString(f.`type`))
    override def read(json: JsValue): SchemaField = {
      val obj  = json.asJsObject
      val name = obj.fields("name").convertTo[String]
      val raw  = obj.fields("type").convertTo[String]
      val canonicalized = DataFieldType.canonicalizeLegacy(raw)
      val resolvedType = DataFieldType.fromString(canonicalized) match {
        case Some(_) => canonicalized
        case None =>
          log.warn(
            "schemaFieldJsonFormat.read: field '{}' carries unrecognized persisted type '{}' " +
              "(canonicalized to '{}', still not a canonical DataFieldType) -- falling back to " +
              "'{}' rather than 500ing on read. Valid types: {}",
            name, raw, canonicalized, DataFieldType.asString(DataFieldType.StringType),
            DataFieldType.CanonicalWireValues.mkString(", ")
          )
          DataFieldType.asString(DataFieldType.StringType)
      }
      SchemaField(name = name, `type` = resolvedType)
    }
  }

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

  // HEL-904 cycle 29: `deriveSourceSchema` (took `Vector[DataType]`, the retired per-source
  // companion-DataType derivation) deleted outright -- zero callers anywhere in main or test
  // (confirmed by grep before deletion); `PipelineService`/`PipelineRunService` derive the
  // source schema from `DataSource.inferredSchema` directly since task 2.x, not through this
  // dead path.

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

  /** Tree-shaped input for [[analyzeNodes]] — like [[PipelineStepInput]] plus
   *  `parentStepId` (`None` = child of the pipeline's raw source), the same
   *  adjacency `InProcessPipelineEngine`'s tree walk uses at runtime. */
  final case class NodeStepInput(
      id:           String,
      parentStepId: Option[String],
      position:     Int,
      op:           String,
      config:       String
  )

  /** Per-node (trunk + every tail) schema projection — the HEL-905 task 6.4
   *  handoff. Unlike [[analyze]] (a single ordered chain), this walks the
   *  `parentStepId` tree so a tail's projection is computed from ITS OWN
   *  ancestor chain back to the source, independent of any sibling tail or
   *  of the trunk continuing past the tail's branch point. Returns every
   *  node's [[AnalyzedStep]] keyed by step id; the pipeline's raw source
   *  schema itself (node id `None`) is `sourceSchema`, not present in the
   *  map — callers needing the source's own "projection" use `sourceSchema`
   *  directly, mirroring `NodeRef.stepId = None` meaning "the source" (see
   *  `com.helio.domain.model.NodeRef`).
   *
   *  HEL-911: this is a pure schema-propagation function that tolerates
   *  whatever `steps` shape it is given -- a step with an unresolvable
   *  `parentStepId`, or (since this ticket) an unresolvable/cyclic `lane`-kind
   *  `secondaryInput.stepId`, is simply never reached (see `isReady` below)
   *  and is absent from the result map, which the `capabilities?stepId=`
   *  route reports as its own "unknown stepId" 404 rather than a crash here. */
  /** HEL-911 (design.md Engine contract item 12, evaluation-1.md CR3): a `join`/`union`/
   *  `lookup` node whose `secondaryInput` is `lane`-kind names ANOTHER node in this same
   *  `steps` list -- and unlike a `source`-kind secondary input (a `DataSource` this layer
   *  genuinely cannot resolve, no repo access), that referenced node's projected schema IS
   *  computable here, from the very same `steps` this call already has. Decoded from the
   *  raw config text (mirroring `validateStepConfig`'s own raw-text dispatch) rather than
   *  the typed config, so a malformed config degrades to `None` (no secondary-schema
   *  derivation) instead of throwing -- `inferOutputSchema`'s existing `parseConfig` /
   *  `validateStepConfig` machinery is still what reports a malformed config as an error;
   *  this helper only ever WIDENS what a well-formed config can additionally project. */
  private def laneDependencyOf(op: String, config: String): Option[String] = {
    def laneId(si: SecondaryInput): Option[String] = si match {
      case SecondaryInput.Lane(id) => Some(id)
      case _                       => None
    }
    scala.util.Try(op match {
      case "union"  => laneId(UnionConfig.decode(config).secondaryInput)
      case "join"   => laneId(JoinConfig.decode(config).secondaryInput)
      case "lookup" => laneId(LookupConfig.decode(config).secondaryInput)
      case _        => None
    }).getOrElse(None)
  }

  /** Per-node (trunk + every tail) schema projection -- see the class doc above.
   *
   *  HEL-911 (design.md Engine contract item 12, evaluation-1.md CR3, cycle 2): generalized
   *  from a single top-down `parentStepId` walk into a topological pass that ALSO honors
   *  each `join`/`union`/`lookup` node's `lane`-kind dependency edge (mirrors
   *  `InProcessPipelineEngine.executeTree`'s own Kahn's-algorithm structure, at the schema
   *  layer rather than the row layer) -- a rejoin node's projection is deferred until its
   *  referenced lane node's OWN projection is available, so `inferOutputSchema` can derive
   *  the rejoin's schema from BOTH inputs (the parent lane's projected schema and the
   *  resolved secondary schema), not the parent lane alone. A node whose parent AND/or lane
   *  dependency never resolves (an unknown `parentStepId`, a dangling/cyclic lane
   *  reference) is simply never reached and is absent from the result map -- unchanged from
   *  this method's pre-existing tolerance, now extended to the lane dependency too, so a
   *  malformed graph degrades gracefully here rather than looping or throwing (this is a
   *  pure schema-propagation function, not the write-time/run-time cycle rejection --
   *  `PipelineService`/`InProcessPipelineEngine` own that). */
  def analyzeNodes(steps: Vector[NodeStepInput], sourceSchema: Vector[SchemaField]): Map[String, AnalyzedStep] = {
    val results = scala.collection.mutable.LinkedHashMap.empty[String, AnalyzedStep]

    def schemaAt(parentId: Option[String]): Vector[SchemaField] =
      parentId.flatMap(results.get).map(_.outputSchema).getOrElse(sourceSchema)

    def isReady(step: NodeStepInput): Boolean =
      step.parentStepId.forall(results.contains) &&
        laneDependencyOf(step.op, step.config).forall(results.contains)

    def processNode(step: NodeStepInput): Unit = {
      val inputSchema     = schemaAt(step.parentStepId)
      val secondarySchema = laneDependencyOf(step.op, step.config).flatMap(results.get).map(_.outputSchema)
      val (output, err) = validateStepConfig(step.op, step.config) match {
        case Some(msg) => (inputSchema, Some(msg))
        case None      => inferOutputSchema(step.op, step.config, inputSchema, secondarySchema)
      }
      results(step.id) = AnalyzedStep(
        id              = step.id,
        position        = step.position,
        op              = step.op,
        config          = step.config,
        inputSchema     = inputSchema,
        outputSchema    = output,
        validationError = err
      )
    }

    var remaining  = steps
    var progressed = true
    while (remaining.nonEmpty && progressed) {
      val (ready, notReady) = remaining.partition(isReady)
      if (ready.isEmpty) progressed = false
      else {
        ready.sortBy(_.position).foreach(processNode)
        remaining = notReady
      }
    }

    results.toMap
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
    val companion = PipelineStep.companionFor(kind).toOption

    // HEL-814: a key that is PRESENT but of the wrong JSON type. Computed
    // FIRST and OUTSIDE the try/catch below, because it is the one problem
    // whose detection must not depend on the config decoding: under D1 the
    // decoder raises for exactly this input, and the catch-all below would
    // swallow that into `Vector.empty`, leaving the caller with no message at
    // all. `validateRawConfig` reads the RAW config and RETURNS the problem
    // rather than throwing, so it survives.
    //
    // This is what keeps the shipped `pipeline-step-config-validation`
    // guarantee true for the PROPOSAL analyze surface — "reports configuration
    // keys which a step's tolerant persistence decoder would silently reduce
    // to an empty default" — now that the decoder rejects them instead of
    // reducing them. The STORED analyze surface never reaches here for such a
    // config, because `rowToDomain` cannot read the row at all; that
    // asymmetry is the delta's "the stored-pipeline analyze surface cannot
    // report such a key" scenario.
    val shapeRejection: Vector[String] = companion.flatMap(_.validateRawConfig(config)).toVector

    val problems: Vector[String] =
      if (shapeRejection.nonEmpty) shapeRejection
      else
      try {
        // HEL-814 D3/D4: the step kind's own required-config + enum/numeric
        // declaration, evaluated against the SAME raw config string the run
        // path evaluates it against (see
        // `InProcessPipelineEngine.requiredConfigProblems`). Combined with the
        // pre-existing per-kind validators below rather than replacing them,
        // so multiple failures on one step still join into a single
        // `validationError` instead of one silently winning.
        val declared: Vector[String] = companion.map(_.requiredConfigProblems(config)).getOrElse(Vector.empty)
        declared ++ (kind match {
          case StringOpsStep.Kind => validateStringOps(config)
          case FillNullStep.Kind  => validateFillNull(config)
          case WindowStep.Kind    => validateWindow(config)
          case AggregateStep.Kind => validateAggregate(config)
          case GroupByStep.Kind   => validateGroupBy(config)
          case PivotStep.Kind     => validatePivot(config)
          case UnionStep.Kind     => validateUnion(config)
          case JoinStep.Kind      => validateJoin(config)
          case _                  => Vector.empty
        })
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
      op:              String,
      config:          String,
      inputSchema:     Vector[SchemaField],
      secondarySchema: Option[Vector[SchemaField]] = None
  ): (Vector[SchemaField], Option[String]) =
    op match {
      case "filter" | "limit" | "sort" | "dedupe" | "fillnull" => (inputSchema, None)
      // HEL-911 (design.md Engine contract item 12, evaluation-1.md CR3): `union`/`join`
      // project a schema derived from BOTH inputs when the secondary input is `lane`-kind
      // and its schema was resolvable (see `analyzeNodes`/`laneDependencyOf`). For a
      // `source`-kind secondary input, `secondarySchema` is always `None` here (this layer
      // has no repo access to resolve a `DataSource`'s schema) -- both fall back to the
      // pre-existing documented best-effort passthrough in that case, unchanged. `join` is
      // a REAL dispatch case now (it had none before this ticket, silently falling to the
      // `unknown`-op arm below and reporting a spurious "Unknown op: 'join'" on every
      // analyze call for a join step -- fixed here as part of implementing this contract
      // item, since design.md's Engine contract item 12 names `join` alongside `union`/
      // `lookup` explicitly).
      case "union"                      => inferUnion(inputSchema, secondarySchema)
      case "join"                       => inferJoin(inputSchema, secondarySchema)
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
      case "lookup"                     => inferLookup(config, inputSchema, secondarySchema)
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
      inputSchema.map(f => f.copy(`type` = casts.get(f.name).map(canonicalizeLegacyType).getOrElse(f.`type`)))
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
          (inputSchema :+ SchemaField(name = column, `type` = canonicalizeLegacyType(wireType)), Some(validationMsg))
        case Right(_) =>
          val fieldTypes = inputSchema.map(f => f.name -> f.`type`).toMap
          val outputType = ExpressionEvaluator.inferType(expression, fieldTypes).getOrElse(canonicalizeLegacyType(wireType))
          (inputSchema :+ SchemaField(name = column, `type` = outputType), None)
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
  private def inferAggregate(config: String, inputSchema: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
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
          val fn    = obj.fields("fn").convertTo[String]
          val field = obj.fields("field").convertTo[String]
          SchemaField(name = alias, `type` = aggResultType(fn, field, inputSchema))
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
   *  typed `timestamp` (HEL-895/638: canonical DataFieldType — `date` is NOT one of the
   *  seven canonical wire values): replace-in-place if the resolved name already exists in
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
   *  rank family, `float` for `running_sum` (HEL-895/638: canonical DataFieldType, not "number"), the same declared type as
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
  private def inferLookup(
      config:          String,
      inputSchema:     Vector[SchemaField],
      secondarySchema: Option[Vector[SchemaField]] = None
  ): (Vector[SchemaField], Option[String]) =
    parseConfig("lookup", config) { json =>
      val columns = json.fields.get("columns").map(_.convertTo[Vector[String]]).getOrElse(Vector.empty[String])
      // HEL-911 (design.md Engine contract item 12, evaluation-1.md CR3): when the secondary
      // input is `lane`-kind and its schema was resolved, type each requested column from
      // the REAL referenced-node field of the same name (both inputs, not the parent lane
      // alone). A requested column absent from the resolved secondary schema, or a
      // `source`-kind secondary input (unresolved -- no repo access), falls back to the
      // pre-existing documented "string" placeholder, unchanged.
      val secondaryTypes: Map[String, String] =
        secondarySchema.map(_.map(f => f.name -> f.`type`).toMap).getOrElse(Map.empty)
      columns.foldLeft(inputSchema) { (schema, col) =>
        val fieldType = secondaryTypes.getOrElse(col, "string")
        schema.filterNot(_.name == col) :+ SchemaField(name = col, `type` = fieldType)
      }
    } (inputSchema)

  /** union (HEL-384, design.md Decision 6) — HEL-911 (design.md Engine contract item 12,
   *  evaluation-1.md CR3): when the secondary input is `lane`-kind and its schema was
   *  resolved (`analyzeNodes`/`laneDependencyOf`), the projected schema is the UNION of
   *  both sides' field names (parent lane's own type wins on a name collision -- runtime
   *  row VALUES carry no notion of a "winning type" either, since `Map[String, Any]` values
   *  are untyped at execution; this is a schema-layer-only convention). For a `source`-kind
   *  secondary input (unresolved -- no repo access to a `DataSource`'s schema), this
   *  degrades to the pre-existing documented best-effort passthrough, unchanged. */
  private def inferUnion(
      inputSchema:     Vector[SchemaField],
      secondarySchema: Option[Vector[SchemaField]]
  ): (Vector[SchemaField], Option[String]) =
    secondarySchema match {
      case Some(secondary) =>
        val existingNames = inputSchema.map(_.name).toSet
        (inputSchema ++ secondary.filterNot(f => existingNames.contains(f.name)), None)
      case None => (inputSchema, None)
    }

  /** join — HEL-911 (design.md Engine contract item 12, evaluation-1.md CR3): `join` had NO
   *  dispatch case at all before this ticket (every analyze call for a `join` step fell to
   *  the `unknown`-op arm below, reporting a spurious "Unknown op: 'join'"). When the
   *  secondary input is `lane`-kind and its schema was resolved, the projected schema
   *  mirrors `JoinStep.evaluate`'s own runtime row shape (`leftRow ++ rightRow`): the union
   *  of both sides' fields, with the SECONDARY (right-hand) side's type winning on a name
   *  collision -- the same "right-hand wins" rule the runtime row merge uses. For a
   *  `source`-kind secondary input (unresolved), this is the same documented best-effort
   *  passthrough every other op in this file uses when it cannot see the second input. */
  private def inferJoin(
      inputSchema:     Vector[SchemaField],
      secondarySchema: Option[Vector[SchemaField]]
  ): (Vector[SchemaField], Option[String]) =
    secondarySchema match {
      case Some(secondary) =>
        val secondaryNames = secondary.map(_.name).toSet
        (inputSchema.filterNot(f => secondaryNames.contains(f.name)) ++ secondary, None)
      case None => (inputSchema, None)
    }

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
      case "sum" | "avg" => "float"
      case "min" | "max" => inputSchema.find(_.name == field).map(_.`type`).getOrElse("string")
      case _            => "string"
    }
}
