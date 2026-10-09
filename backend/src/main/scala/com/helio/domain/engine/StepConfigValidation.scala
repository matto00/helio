package com.helio.domain.engine

import com.helio.domain.model.PipelineStep
import com.helio.domain.steps.{AggregateConfig, AggregateStep, FillNullConfig, FillNullStep, GroupByConfig, GroupByStep, JoinConfig, JoinStep, PivotConfig, PivotStep, StringOpsConfig, StringOpsStep, UnionConfig, UnionStep, WindowConfig, WindowStep}

/** HEL-1385: step-config validation split out of `PipelineAnalyzeService`; reached only through
 *  `PipelineAnalyzeService.stepConfigProblem` and the analyze walk. */
private[engine] object StepConfigValidation {

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
  private[engine] def validateStepConfig(kind: String, config: String): Option[String] = {
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
    // HEL-1416: the shared rule reports a non-empty unknown strategy; the empty draft is reported here.
    val strategyProblem = FillNullStep.strategyProblem(cfg)
    if (strategyProblem.isDefined) strategyProblem.toVector
    else if (cfg.strategy.isEmpty) Vector(FillNullStep.unsupportedStrategyMessage(cfg.strategy))
    else if (cfg.strategy == "constant" && cfg.value.isEmpty)
      Vector("fillnull strategy 'constant' requires 'value'")
    else Vector.empty
  }

  private def validateWindow(config: String): Vector[String] = {
    val cfg = WindowConfig.decode(config)
    // HEL-1416: enum/offset rule shared with write and run; the empty-function draft is reported here.
    if (cfg.function.isEmpty) Vector(WindowStep.unsupportedFunctionMessage(cfg.function))
    else {
      val fieldProblem =
        if (WindowStep.FieldRequired.contains(cfg.function) && cfg.field.isEmpty)
          Some(s"window function '${cfg.function}' requires 'field'")
        else None
      fieldProblem.toVector ++ WindowStep.enumProblems(cfg)
    }
  }

  private def validateAggregate(config: String): Vector[String] = {
    // HEL-1310: one shared rule (also the write-time `validateRawConfig` override and `apply`).
    AggregateConfig.decode(config).aggregations.flatMap(AggregateStep.aggregationProblem)
  }

  private def validateGroupBy(config: String): Vector[String] = {
    val cfg = GroupByConfig.decode(config)
    val fn  = cfg.aggFunction.toLowerCase
    if (GroupByStep.SupportedFunctions.contains(fn)) Vector.empty
    else Vector(s"Unsupported aggregation function: '$fn'. Supported: ${GroupByStep.SupportedFunctions.mkString(", ")}")
  }

  private def validatePivot(config: String): Vector[String] = {
    val cfg = PivotConfig.decode(config)
    // HEL-1416: one shared rule; the empty-agg draft is still reported, with the same message.
    if (cfg.agg.isEmpty) Vector(PivotStep.unsupportedAggMessage(cfg.agg))
    else PivotStep.aggProblem(cfg).toVector
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
}
