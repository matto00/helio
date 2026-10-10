package com.helio.domain.engine

import com.helio.domain.model.DataFieldType
import com.helio.domain.steps.{JoinConfig, LookupConfig, SecondaryInput, UnionConfig}
import org.slf4j.LoggerFactory
import scala.util.Try
import spray.json._
import spray.json.DefaultJsonProtocol._

import StepConfigValidation.validateStepConfig



object PipelineAnalyzeService {

  private val log = LoggerFactory.getLogger(getClass)

  /** HEL-1266/HEL-1279: the single `CostReason.code` for an enabled step whose config is certain to
   *  fail. Referenced by `PipelineService.toCostVerdictResponse` (analyze) and
   *  `AutoRunTriggerService` (dataset-write auto-run) so the two surfaces cannot drift. */
  val StepConfigInvalidCode: String = "step-config-invalid"

  /** HEL-1279: public entry point to the schema-INDEPENDENT config validator -- the exact function
   *  `analyzeNodes` runs for every enabled node (before inference). Reads only `(op, rawConfig)`,
   *  never a schema, so it cannot inherit the stored-inferred-schema false positives of HEL-1280. */
  def stepConfigProblem(op: String, rawConfig: String): Option[String] = StepConfigValidation.validateStepConfig(op, rawConfig)

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
   *  `PipelineRunExecutor.onRunSuccess`'s baseline capture, etc.) would throw `SchemaField`'s
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
  /** `rootId` (HEL-913 task 5.9) defaults to `None`, matching the pre-multi-root convention every
   *  existing call site relies on: a `None`-rootId, `None`-parentStepId node resolves against the
   *  single-root [[analyzeNodes]] overload's one `sourceSchema`, keyed internally under
   *  `DefaultRootKey`. A caller resolving a genuine multi-root pipeline's per-node projection
   *  supplies `rootId` explicitly and calls the `Map[String, Vector[SchemaField]]` overload. */
  /** `enabled` (HEL-913 task 7.2c fold-in) defaults `true` so every pre-existing call site
   *  (none of which pre-date a disabled-step concept in this walk) keeps compiling unchanged.
   *  A caller building `steps` by pre-filtering OUT disabled steps before constructing
   *  `NodeStepInput`s (as `PipelineService.analyze` did until this fix) breaks `isReady` for
   *  any child whose `parentStepId` names the now-absent disabled step -- that child is never
   *  reachable and silently vanishes from the result map. The fix is to keep EVERY step
   *  (enabled or not) in `steps`, set `enabled` per step, and let [[analyzeNodes]] make a
   *  disabled node transparent itself (mirrors `InProcessPipelineEngine.evalNode`'s own
   *  `if (step.enabled) ... else Future.successful(currentRows)` pass-through exactly) —
   *  filtering disabled entries OUT of the RESPONSE, not out of the WALK, is the caller's job
   *  (design.md Decision 3, boundary iii: "the analyze response contains entries for enabled
   *  steps only"). */
  final case class NodeStepInput(
      id:           String,
      parentStepId: Option[String],
      position:     Int,
      op:           String,
      config:       String,
      rootId:       Option[String] = None,
      enabled:      Boolean = true
  )

  /** Internal key `sourceSchemasByRoot` uses for a node with no explicit `rootId` (the
   *  single-root/pre-multi-root convention). Never surfaced on the wire. */
  private val DefaultRootKey = ""

  /** HEL-1414: the data-source id a `join` OR `lookup` step's `source`-kind secondary names. Used ONLY
   *  to pre-resolve schemas for [[AnalyzeSchemaWarnings]]; [[sourceDependencyOf]] stays join-only so
   *  `analyzeNodes` projections (a source-secondary lookup's documented placeholder types) do not change. */
  def secondarySourceIdOf(op: String, config: String): Option[String] =
    Try(op match {
      case "join"   => Some(JoinConfig.decode(config).secondaryInput)
      case "lookup" => Some(LookupConfig.decode(config).secondaryInput)
      case _        => None
    }).toOption.flatten.collect { case SecondaryInput.Source(dsId) if dsId.nonEmpty => dsId }

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
  private[engine] def laneDependencyOf(op: String, config: String): Option[String] = {
    def laneId(si: SecondaryInput): Option[String] = si match {
      case SecondaryInput.Lane(id) => Some(id)
      case _                       => None
    }
    Try(op match {
      case "union"  => laneId(UnionConfig.decode(config).secondaryInput)
      case "join"   => laneId(JoinConfig.decode(config).secondaryInput)
      case "lookup" => laneId(LookupConfig.decode(config).secondaryInput)
      case _        => None
    }).getOrElse(None)
  }

  /** HEL-1236: the data-source id a `join` step's `source`-kind secondary input names, if any --
   *  the counterpart of [[laneDependencyOf]]. Only `join` is covered (the only op whose analyzed
   *  schema consumes a source-kind secondary schema today). Same tolerant decode: a malformed
   *  config degrades to `None`. Public so callers can pre-resolve those sources' schemas. */
  def sourceDependencyOf(op: String, config: String): Option[String] =
    if (op != "join") None
    else Try(JoinConfig.decode(config).secondaryInput).toOption.collect {
      case SecondaryInput.Source(dsId) if dsId.nonEmpty => dsId
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
  def analyzeNodes(steps: Vector[NodeStepInput], sourceSchema: Vector[SchemaField]): Map[String, AnalyzedStep] =
    analyzeNodes(steps, Map(DefaultRootKey -> sourceSchema))

  /** HEL-913 task 5.9: multi-root overload. `sourceSchemasByRoot` carries ONE schema per pipeline
   *  root, keyed by `PipelineRoot.id`; a root-level node's `schemaAt` resolution is keyed by
   *  `step.rootId`, never a bare `getOrElse` fallback onto a single implicit schema (design.md
   *  R12: "`node_step_id IS NULL` is not a standalone predicate" applies here too -- a root-level
   *  node's schema source is "THIS root", not "the only root"). A `rootId` naming a root absent
   *  from `sourceSchemasByRoot` resolves to an empty schema (matching this function's existing
   *  tolerant-degradation contract for any other unresolvable reference) rather than silently
   *  falling back to a different root's schema. */
  def analyzeNodes(
      steps:                   Vector[NodeStepInput],
      sourceSchemasByRoot:     Map[String, Vector[SchemaField]],
      secondarySourceSchemas:  Map[String, Vector[SchemaField]] = Map.empty
  ): Map[String, AnalyzedStep] = {
    val results = scala.collection.mutable.LinkedHashMap.empty[String, AnalyzedStep]

    def schemaAt(step: NodeStepInput): Vector[SchemaField] =
      step.parentStepId.flatMap(results.get).map(_.outputSchema)
        .getOrElse(sourceSchemasByRoot.getOrElse(step.rootId.getOrElse(DefaultRootKey), Vector.empty))

    def isReady(step: NodeStepInput): Boolean =
      step.parentStepId.forall(results.contains) &&
        laneDependencyOf(step.op, step.config).forall(results.contains)

    def processNode(step: NodeStepInput): Unit = {
      val inputSchema     = schemaAt(step)
      // HEL-1236: a `join`'s `source`-kind secondary input resolves from the caller-supplied
      // `secondarySourceSchemas` (keyed by data source id) -- this layer has no repo access of its
      // own. Absent from the map -> `None`, the documented left-schema passthrough.
      val secondarySchema = laneDependencyOf(step.op, step.config).flatMap(results.get).map(_.outputSchema)
        .orElse(sourceDependencyOf(step.op, step.config).flatMap(secondarySourceSchemas.get))
      // HEL-913 task 7.2c fold-in: a disabled node is transparent -- never validated, never
      // inferred, its incoming schema passes through unchanged (mirrors the engine's own
      // disabled-node handling, design.md Decision 7 / HEL-905).
      val (output, err) =
        if (!step.enabled) (inputSchema, None)
        else validateStepConfig(step.op, step.config) match {
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

  // HEL-872 (design.md Decision 4): widened from object-private to
  // `private[engine]` for exactly one reason -- the registry-vs-dispatch
  // coverage guard in `PipelineAnalyzeServiceSpec` must call this directly,
  // never through `analyze`/`analyzeNodes` (which short-circuit on
  // `validateStepConfig` and never reach inference on a rejected config).
  // Not a general API; do not widen further or call from outside that guard.
  private[engine] def inferOutputSchema(
      op:              String,
      config:          String,
      inputSchema:     Vector[SchemaField],
      secondarySchema: Option[Vector[SchemaField]] = None
  ): (Vector[SchemaField], Option[String]) =
    StepSchemaInference.inferOutputSchema(op, config, inputSchema, secondarySchema)
}
