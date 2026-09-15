package com.helio.domain.engine

/** HEL-1092: a pure, IO-free classifier of a persisted pipeline's cheapness for auto-running.
 *  `PipelineService.analyze` gathers `CostInput` from the DB and calls `estimate`; this object
 *  decides. Deny-by-default (design.md D1-D5): every branch the estimator cannot positively
 *  classify as cheap denies, never allows.
 *
 *  Downstream consumers: HEL-1093 (auto-run on dataset write) keys on `autoRunnable`; HEL-1108
 *  (AI steps never auto-runnable + tier gating) keys on the `ai-step` reason code specifically,
 *  which is why that arm is checked before the general allowlist and carries its own code rather
 *  than falling through to `unclassified-op`. */
object PipelineCostEstimator {

  /** Max estimated row count for a pipeline to be considered cheap. One place to loosen. */
  val MaxAutoRunRows: Long = 10000L

  /** Max enabled step count for a pipeline to be considered cheap. One place to loosen. */
  val MaxAutoRunSteps: Int = 20

  /** AI ops: always denied with their own `ai-step` code, checked BEFORE the general allowlist
   *  so HEL-1108 can key on the reason code alone without re-deriving classification. Neither op
   *  is implemented/registered (HEL-1106/1107) -- classified by op-name string only, per
   *  tasks.md C3. */
  val AiOps: Set[String] = Set("analyzewithai", "generatetext")

  /** Write-back ops: denied because auto-running a writer would cascade into further auto-runs
   *  of downstream pipelines reading what it just wrote -- conservative until that interaction is
   *  designed (HEL-1093 territory, not this ticket). */
  val WriteBackOps: Set[String] = Set("upsertsource")

  /** HEL-1105 (design.md D7): content-conversion ops are denied with their own `content-
   *  conversion` code, checked after AI/write-back and before the general allowlist -- the
   *  estimator's cheapness bounds are row/step-count only, and `convertformat`'s cost scales
   *  with bytes per content cell (a single row can hold a multi-MB document), which `CostInput`
   *  cannot see. A distinct code (rather than `unclassified-op`) records that this was classified
   *  deliberately, not silently missed, and lets HEL-1093 relax it later with a content-size
   *  signal. */
  val ContentConversionOps: Set[String] = Set("convertformat")

  /** Explicit, HAND-MAINTAINED allowlist of ops considered cheap to auto-run (skeptic-final-1.md
   *  CR1). Deliberately NOT derived from `PipelineStep.Registry.keySet` -- a derived formula would
   *  make every future `Registry` addition automatically cheap the moment it's registered, with
   *  no review attention on the cheapness question and no code change in this file.
   *  `PipelineCostEstimatorSpec`'s "op coverage" describe block enforces the converse invariant
   *  this hand-maintained set depends on: every op in `Registry.keySet` must appear in exactly one
   *  of `CheapOps`/`AiOps`/`WriteBackOps`/`ContentConversionOps`, so an op arriving in `Registry`
   *  without a matching entry here fails loudly instead of silently defaulting to allow. */
  val CheapOps: Set[String] = Set(
    "rename", "filter", "join", "compute", "groupby", "cast", "select", "limit", "sort",
    "aggregate", "splittext", "extractheadings", "chunkbytokencount", "datebucket", "pivot",
    "window", "unpivot", "dedupe", "fillnull", "stringops", "union", "lookup", "assert"
  )

  /** Source kinds recognized well enough to reason about remote-ness. Anything outside this set
   *  (or an unresolved root) is `unclassified-source`. */
  private val KnownLocalKinds: Set[String] = Set("csv", "text", "pdf", "image", "dataset")
  private val RemoteKinds: Set[String]     = Set("rest_api", "sql")

  /** One enabled step's op, as gathered by the caller (enabled steps only -- disabled steps
   *  never execute and are neither counted nor classified). */
  final case class StepInput(stepId: String, op: String)

  /** One pipeline root's resolved source, as gathered by the caller. `kind = None` means the
   *  root could not be resolved (e.g. `findByIdOwned` returned `None` for a shared viewer) --
   *  treated identically to an unknown kind. */
  final case class RootCost(rootId: String, kind: Option[String], hasSourceUrl: Boolean, datasetRowCount: Option[Long])

  /** Everything the estimator needs, gathered by IO in `PipelineService.analyze`. `steps` is
   *  enabled steps only. */
  final case class CostInput(steps: Vector[StepInput], roots: Vector[RootCost], lastRunRowCount: Option[Long])

  /** One reason a pipeline is denied auto-run. `stepId` is present when the reason names a
   *  specific step, absent for pipeline-level reasons (row/step-count/root reasons). */
  final case class CostReason(code: String, detail: String, stepId: Option[String] = None)

  /** The verdict. Private constructor: `autoRunnable` is derivable ONLY as `reasons.isEmpty`, so
   *  no caller (in this file or elsewhere) can construct an allow carrying reasons, or an
   *  inconsistent deny with empty reasons -- design.md D5's single point of derivation. */
  final case class CostVerdict private (autoRunnable: Boolean, estimatedRows: Option[Long], stepCount: Int, reasons: Vector[CostReason])
  object CostVerdict {
    private[PipelineCostEstimator] def of(estimatedRows: Option[Long], stepCount: Int, reasons: Vector[CostReason]): CostVerdict =
      CostVerdict(autoRunnable = reasons.isEmpty, estimatedRows, stepCount, reasons)
  }

  /** Classify `input` into a `CostVerdict`. Pure, no IO. Reasons are collected (not first-match)
   *  so the caller sees every problem, not just the first one found. */
  def estimate(input: CostInput): CostVerdict = {
    val stepReasons = input.steps.flatMap(classifyStep)
    val sourceReasons = if (input.roots.isEmpty) {
      Vector(CostReason("no-roots", "Pipeline has no roots"))
    } else {
      input.roots.flatMap(classifyRoot)
    }
    val rowsOpt = estimateRows(input)
    val rowReasons = rowsOpt match {
      case None => Vector(CostReason("row-estimate-unavailable", "No row estimate is available for this pipeline"))
      case Some(rows) if rows > MaxAutoRunRows =>
        Vector(CostReason("rows-above-threshold", s"Estimated $rows rows exceeds the auto-run threshold of $MaxAutoRunRows"))
      case _ => Vector.empty
    }
    val stepCount = input.steps.size
    val stepCountReasons =
      if (stepCount > MaxAutoRunSteps)
        Vector(CostReason("steps-above-bound", s"$stepCount enabled steps exceeds the auto-run bound of $MaxAutoRunSteps"))
      else Vector.empty

    CostVerdict.of(rowsOpt, stepCount, stepReasons ++ sourceReasons ++ rowReasons ++ stepCountReasons)
  }

  private def classifyStep(step: StepInput): Option[CostReason] =
    if (AiOps.contains(step.op))
      Some(CostReason("ai-step", s"Step '${step.stepId}' uses AI op '${step.op}'", Some(step.stepId)))
    else if (WriteBackOps.contains(step.op))
      Some(CostReason("writeback-step", s"Step '${step.stepId}' writes back to a data source ('${step.op}')", Some(step.stepId)))
    else if (ContentConversionOps.contains(step.op))
      Some(CostReason("content-conversion", s"Step '${step.stepId}' converts content format ('${step.op}')", Some(step.stepId)))
    else if (CheapOps.contains(step.op))
      None
    else
      Some(CostReason("unclassified-op", s"Step '${step.stepId}' uses an op not on the cheap allowlist ('${step.op}')", Some(step.stepId)))

  private def classifyRoot(root: RootCost): Option[CostReason] =
    root.kind match {
      case Some(kind) if RemoteKinds.contains(kind) =>
        Some(CostReason("remote-fetch", s"Root '${root.rootId}' is a remote source ('$kind')"))
      case Some(kind) if root.hasSourceUrl =>
        Some(CostReason("remote-fetch", s"Root '${root.rootId}' is a URL-backed source ('$kind')"))
      case Some(kind) if KnownLocalKinds.contains(kind) =>
        None
      case _ =>
        Some(CostReason("unclassified-source", s"Root '${root.rootId}' has an unresolvable or unknown source kind"))
    }

  /** `lastRunRowCount` wins when present (a real measurement, even though it's output not input
   *  rows -- accepted for v1, see design.md Risks). Otherwise, sum `datasetRowCount` across every
   *  root ONLY if every root is a dataset with a known count -- any root without a count makes the
   *  whole estimate unavailable rather than silently undercounting. */
  private def estimateRows(input: CostInput): Option[Long] =
    input.lastRunRowCount.orElse {
      val counts = input.roots.map(_.datasetRowCount)
      if (counts.nonEmpty && counts.forall(_.isDefined)) Some(counts.flatten.sum) else None
    }
}
