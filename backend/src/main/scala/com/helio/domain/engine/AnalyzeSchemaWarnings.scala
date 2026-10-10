package com.helio.domain.engine

import com.helio.domain.engine.PipelineAnalyzeService.{AnalyzedStep, NodeStepInput}
import com.helio.domain.steps.{
  AggregateConfig, CastConfig, CastStep, ComputeConfig, DateBucketConfig, DedupeConfig, FillNullConfig, FilterConfig, GroupByConfig, JoinColumnNaming, JoinConfig,
  LookupConfig, RenameConfig, SelectConfig, SortConfig, StringOpsConfig, WindowConfig, WindowStep
}

import scala.collection.mutable
import scala.util.Try

/** HEL-1235: schema-only, NON-BLOCKING analyze warnings.
 *
 *  Silent-wrong-result shapes HEL-1069 found that analyze reported nothing for:
 *  a step referencing a field absent from its projected input schema, a join (or, HEL-1414, lookup) whose key types
 *  differ between the two inputs (or whose lookup key is absent from the secondary), and a join/lookup column that collides with an input column
 *  (the right one is renamed `right_<name>`, HEL-1236/HEL-1250). HEL-1403 adds a fourth, for
 *  `compute`: a text/boolean field (e.g. an uncast CSV column) used as a numeric-function argument or
 *  a `-`/`*`/`/`/unary-`-` operand nulls every non-null row at run time
 *  (`numeric-op-on-text-field`, only from type-trusted input schemas).
 *
 *  Design constraints (see the change's design.md):
 *   - A SEPARATE pure pass over the projections `PipelineAnalyzeService.analyzeNodes` already
 *     produced (after `UpsertTargetAnalysis.overlay`). Nothing in analyze, validation, the cost
 *     verdict or the auto-run gate (`stepConfigProblem`) reads its output, so a warning can never
 *     block anything.
 *   - Stored inferred schemas can be stale (HEL-1280), so messages state the evidence base, never
 *     existence.
 *   - `analyzeNodes` silently produces structurally incomplete schemas (empty root, unresolved
 *     secondary, identity fallback after an error, `pivot`'s data-derived columns). A warning is
 *     emitted only from a projection known to be complete: see [[Flags]].
 *
 *  Ops that already report an unknown field as a blocking `validationError` (compute -- whose
 *  only warning here is the numeric-use-of-text-field check, never an unknown-field one --,
 *  convertformat, analyzewithai, generatetext, splittext, extractheadings, chunkbytokencount,
 *  pivot, unpivot, assert) have no row in [[referencedFields]] and so are never double-reported. */
object AnalyzeSchemaWarnings {

  val FieldNotInInputSchema: String = "field-not-in-input-schema"
  val JoinKeyTypeMismatch: String   = "join-key-type-mismatch"
  val JoinColumnRenamed: String     = "join-column-renamed"
  val NumericOpOnTextField: String  = "numeric-op-on-text-field"

  final case class Warning(stepId: String, code: String, message: String)

  /** Completeness of a node's OUTPUT (or of the root, for an input). `names`: every column name
   *  that exists at run time is in the projection. `types`: the projected types equal the
   *  run-time value classes (positively defined: only [[typeTrusted]] ops preserve it). */
  private final case class Flags(names: Boolean, types: Boolean)
  private final case class Secondary(schema: Vector[SchemaField], flags: Flags, viaLane: Boolean)

  private val Incomplete = Flags(names = false, types = false)
  private val MaxListedFields = 20

  /** Ops whose projected output types equal the run-time classes they produce (pass-through, or
   *  authoritative at run time). Confirmed against each op's runtime step (task 1.3). `compute`
   *  (its projected type comes from `ExpressionEvaluator.inferType`, which is not proven to equal
   *  the evaluator's run-time value class -- e.g. numeric coercion in `+`), `fillnull` (a
   *  `constant` fill writes the raw string; mean/median write a Double), `datebucket`, `window`,
   *  `aggregate`/`groupby` (group-by `type` is informational), `union`, `pivot`/`unpivot` and every
   *  AI/text op are deliberately NOT trusted. `cast` is trusted per-config ([[castTrusted]]),
   *  `join`/`lookup` per-secondary. */
  private val typeTrusted: Set[String] =
    Set("filter", "sort", "limit", "dedupe", "select", "rename", "stringops", "assert", "upsertsource")

  /** `CastStep.castValue` produces a value of the projected class for every supported target
   *  (HEL-1436); a stored legacy target passes through and is not trusted. */
  private val castRuntimeTargets: Set[String] = CastStep.SupportedTargets.toSet

  /** Runtime-equality families of the declared canonical types, as `JoinStep` indexes them (a raw
   *  `Map[Any, _]` lookup: a `String` never equals a number, while Int/Long/Double/BigDecimal match
   *  each other -- probed in `AnalyzeSchemaWarningsSpec`). `None` = run-time class not pinned
   *  (`timestamp` may be a String or an instant, `binary-ref`): never warn. */
  private def family(t: String): Option[String] = t match {
    case "string" | "string-body" => Some("string")
    case "integer" | "float"      => Some("numeric")
    case "boolean"                => Some("boolean")
    case _                        => None
  }

  def compute(
      steps:                  Vector[NodeStepInput],
      projections:            Map[String, AnalyzedStep],
      secondarySourceSchemas: Map[String, Vector[SchemaField]]
  ): Vector[Warning] = {
    val byId = steps.map(s => s.id -> s).toMap
    val memo = mutable.Map.empty[String, Flags]

    def inputFlags(step: NodeStepInput, a: AnalyzedStep): Flags =
      step.parentStepId.flatMap(p => if (projections.contains(p)) byId.get(p) else None) match {
        case Some(parent) => outFlags(parent)
        case None         => Flags(a.inputSchema.nonEmpty, a.inputSchema.nonEmpty)
      }

    def secondaryOf(step: NodeStepInput): Option[Secondary] =
      PipelineAnalyzeService.laneDependencyOf(step.op, step.config).flatMap(l => projections.get(l).flatMap(p => byId.get(l).map(lane => Secondary(p.outputSchema, outFlags(lane), viaLane = true))))
        .orElse(PipelineAnalyzeService.secondarySourceIdOf(step.op, step.config).flatMap(secondarySourceSchemas.get).map(s => Secondary(s, Flags(names = true, types = true), viaLane = false)))

    def outFlags(step: NodeStepInput): Flags =
      memo.getOrElseUpdate(step.id, {
        projections.get(step.id) match {
          case None => Incomplete
          case Some(a) =>
            val in = inputFlags(step, a)
            if (!step.enabled) in
            else if (a.validationError.isDefined) Incomplete
            else {
              val sec = secondaryOf(step)
              val names = step.op match {
                case "join" | "union"      => in.names && sec.exists(_.flags.names)
                case "pivot"               => false
                case "aggregate" | "groupby" => true
                case _                     => in.names
              }
              val types = names && in.types && typesPreserved(step, sec)
              Flags(names, types)
            }
        }
      })

    def typesPreserved(step: NodeStepInput, sec: Option[Secondary]): Boolean = step.op match {
      case op if typeTrusted.contains(op) => true
      case "cast"                         => castTrusted(step.config)
      case "join"                         => sec.exists(_.flags.types)
      // A source-secondary lookup's projection used placeholder column types (analyzeNodes does not
      // see the source schema), so only a lane secondary keeps the output type-trusted.
      case "lookup"                       => sec.exists(s => s.viaLane && s.flags.types && lookupColumnsResolved(step.config, s.schema))
      case _                              => false
    }

    val out = Vector.newBuilder[(Int, Warning)]
    steps.foreach { step =>
      projections.get(step.id).filter(a => step.enabled && a.validationError.isEmpty).foreach { a =>
        val in  = inputFlags(step, a)
        val sec = secondaryOf(step)
        val inputNames = a.inputSchema.map(_.name).toSet

        // 1. field-not-in-input-schema (input side)
        if (in.names) {
          referencedFields(step.op, step.config).filterNot(inputNames.contains).distinct.foreach { fieldName =>
            out += a.position -> Warning(step.id, FieldNotInInputSchema, missingMessage(step.op, fieldName, a.inputSchema, "this step's inferred input schema"))
          }
        }

        if (step.op == "join") joinWarnings(step, a, in, sec).foreach(w => out += a.position -> w)
        if (step.op == "lookup") {
          lookupKeyWarnings(step, a, in, sec).foreach(w => out += a.position -> w)
          lookupRenames(step, a, in, sec).foreach(w => out += a.position -> w)
        }
        // Gated on trusted input TYPES: after a compute/fillnull/aggregate/untrusted cast the
        // projected type may not equal the run-time class, and a guess would be a false positive.
        if (step.op == "compute" && in.types) computeNumericWarnings(step, a).foreach(w => out += a.position -> w)
      }
    }
    out.result().sortBy { case (pos, w) => (pos, w.stepId, w.code, w.message) }.map(_._2)
  }

  private def joinWarnings(step: NodeStepInput, a: AnalyzedStep, in: Flags, sec: Option[Secondary]): Vector[Warning] =
    Try(JoinConfig.decode(step.config)).toOption.fold(Vector.empty[Warning]) { cfg =>
      val key = cfg.joinKey
      sec.filter(_ => key.nonEmpty).fold(Vector.empty[Warning]) { s =>
        val ws = Vector.newBuilder[Warning]
        val leftField  = a.inputSchema.find(_.name == key)
        val rightField = s.schema.find(_.name == key)
        // The left key is reported by the generic reference pass (joinKey is in referencedFields);
        // only the right side is specific to the secondary input here.
        if (s.flags.names && rightField.isEmpty)
          ws += Warning(step.id, FieldNotInInputSchema, missingMessage("join", key, s.schema, "this step's inferred secondary input schema", secondary = true))
        for {
          l <- leftField
          r <- rightField
          if in.types && s.flags.types
          lf <- family(l.`type`)
          rf <- family(r.`type`)
          if lf != rf
        } ws += Warning(
          step.id,
          JoinKeyTypeMismatch,
          s"join: key '$key' is ${l.`type`} on the input but ${r.`type`} on the secondary input; values of different types never match, so the join may return no rows (types are from the inferred schemas)"
        )
        if (in.names && s.flags.names) {
          val mapping = JoinColumnNaming.resolve(a.inputSchema.map(_.name), s.schema.map(_.name), key)
          s.schema.map(_.name).distinct.foreach { col =>
            mapping.get(col).filter(_ != col).foreach { renamed =>
              ws += Warning(step.id, JoinColumnRenamed, renameMessage("join", col, renamed))
            }
          }
        }
        ws.result()
      }
    }

  /** HEL-1414: the lookup twin of [[joinWarnings]]' key checks. `LookupStep` indexes the secondary rows
   *  by the raw `lookupKey` value and probes with the raw `sourceKey` value, the same `Map[Any, _]`
   *  equality [[family]] models for join. The input-side `sourceKey` is covered by [[referencedFields]]. */
  private def lookupKeyWarnings(step: NodeStepInput, a: AnalyzedStep, in: Flags, sec: Option[Secondary]): Vector[Warning] =
    Try(LookupConfig.decode(step.config)).toOption.fold(Vector.empty[Warning]) { cfg =>
      sec.filter(_ => cfg.sourceKey.nonEmpty && cfg.lookupKey.nonEmpty).fold(Vector.empty[Warning]) { s =>
        val ws = Vector.newBuilder[Warning]
        val leftField  = a.inputSchema.find(_.name == cfg.sourceKey)
        val rightField = s.schema.find(_.name == cfg.lookupKey)
        if (s.flags.names && rightField.isEmpty)
          ws += Warning(step.id, FieldNotInInputSchema, missingMessage("lookup", cfg.lookupKey, s.schema, "this step's inferred secondary input schema", secondary = true))
        for {
          l <- leftField
          r <- rightField
          if in.types && s.flags.types
          lf <- family(l.`type`)
          rf <- family(r.`type`)
          if lf != rf
        } ws += Warning(
          step.id,
          JoinKeyTypeMismatch,
          s"lookup: source key '${cfg.sourceKey}' is ${l.`type`} on the input but lookup key '${cfg.lookupKey}' is ${r.`type`} on the secondary input; values of different types never match, so no row will find a match (types are from the inferred schemas)"
        )
        ws.result()
      }
    }

  private def lookupRenames(step: NodeStepInput, a: AnalyzedStep, in: Flags, sec: Option[Secondary]): Vector[Warning] =
    Try(LookupConfig.decode(step.config)).toOption.fold(Vector.empty[Warning]) { cfg =>
      if (!(in.names && sec.exists(_.flags.names))) Vector.empty
      else {
        val requested = cfg.columns.distinct
        val keyOpt    = if (cfg.sourceKey == cfg.lookupKey) Some(cfg.lookupKey) else None
        val mapping   = JoinColumnNaming.resolveWithKey(a.inputSchema.map(_.name), requested, keyOpt)
        requested.flatMap(col => mapping.get(col).filter(_ != col).map(renamed => Warning(step.id, JoinColumnRenamed, renameMessage("lookup", col, renamed))))
      }
    }

  private def computeNumericWarnings(step: NodeStepInput, a: AnalyzedStep): Vector[Warning] =
    Try(ComputeConfig.decode(step.config)).toOption.fold(Vector.empty[Warning]) { cfg =>
      val types = a.inputSchema.map(sf => sf.name -> sf.`type`).toMap
      ExpressionEvaluator.numericContextTextFields(cfg.expression, types).map { case (field, contexts) =>
        Warning(
          step.id,
          NumericOpOnTextField,
          s"compute: field '$field' is ${types(field)} in this step's inferred input schema but is used with ${contexts.mkString(", ")}; " +
            "every non-null row will compute null at run time -- add a cast step before this step to convert it to a number"
        )
      }
    }

  private def renameMessage(op: String, col: String, renamed: String): String =
    s"$op: right-side column '$col' collides with an input column and will appear as '$renamed' (per the inferred schemas)"

  private def missingMessage(op: String, field: String, schema: Vector[SchemaField], where: String, secondary: Boolean = false): String = {
    val names     = schema.map(_.name)
    val listed    = names.take(MaxListedFields).mkString(", ") + (if (names.size > MaxListedFields) ", …" else "")
    val what      = if (secondary && (op == "join" || op == "lookup")) s"key '$field'" else s"field '$field'"
    s"$op: $what not found in $where (available: $listed)"
  }

  private def castTrusted(config: String): Boolean =
    Try(CastConfig.decode(config)).toOption.exists(_.casts.values.forall(castRuntimeTargets.contains))

  private def lookupColumnsResolved(config: String, secondary: Vector[SchemaField]): Boolean =
    Try(LookupConfig.decode(config)).toOption.exists(_.columns.forall(c => secondary.exists(_.name == c)))

  /** The input-field reference table (task 1.2): for each checked op, the config paths that name
   *  an INPUT column. Output-only names (aliases, `outputColumn`, new names) are never included,
   *  and "no field" values (empty string, a `count` without a field) are filtered out. A config
   *  that cannot be decoded yields nothing (the existing config-error path owns it). `join`'s
   *  `joinKey` is the left-side reference; its right side is handled in [[joinWarnings]]. */
  private[engine] def referencedFields(op: String, config: String): Vector[String] =
    Try(op match {
      case "filter"     => FilterConfig.decode(config).conditions.map(_.field)
      case "sort"       => SortConfig.decode(config).sortBy.map(_.field)
      case "dedupe"     => DedupeConfig.decode(config).keys
      case "select"     => SelectConfig.decode(config).fields
      case "rename"     => RenameConfig.decode(config).renames.keys.toVector.sorted
      case "cast"       => CastConfig.decode(config).casts.keys.toVector.sorted
      case "datebucket" => Vector(DateBucketConfig.decode(config).field)
      case "window" =>
        val c = WindowConfig.decode(config)
        c.partitionBy ++ c.orderBy.map(_.field) ++ (if (WindowStep.FieldRequired.contains(c.function)) c.field.toVector else Vector.empty)
      case "fillnull" => FillNullConfig.decode(config).columns
      case "stringops" =>
        val c = StringOpsConfig.decode(config)
        if (c.operation == "concat") c.fields.getOrElse(Vector.empty) else Vector(c.field)
      case "aggregate" =>
        val c = AggregateConfig.decode(config)
        c.groupBy.map(_.name) ++ c.aggregations.map(_.field)
      case "groupby" =>
        val c = GroupByConfig.decode(config)
        c.groupBy :+ c.aggColumn
      case "lookup" => Vector(LookupConfig.decode(config).sourceKey)
      case "join"   => Vector(JoinConfig.decode(config).joinKey)
      case _        => Vector.empty[String]
    }).getOrElse(Vector.empty[String]).filter(_.nonEmpty)
}
