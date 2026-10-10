package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId, StepGroup}
import com.helio.domain.engine.PipelineRowJson
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Typed config for the `window` step (HEL-376). `partitionBy` names source
 *  columns to partition rows by (a `null` value at a partition field is a
 *  valid partition key, mirroring `aggregate`'s `groupBy`/`pivot`'s `index`
 *  semantics; an empty `partitionBy` collapses every row into one partition,
 *  parity with `aggregate`'s empty-`groupBy` behavior). `orderBy` reuses
 *  `SortStep`'s `SortKey` shape to order rows within each partition. `function`
 *  selects one of six supported window functions (`row_number`/`rank`/
 *  `dense_rank`/`running_sum`/`lag`/`lead`); `field` is the source column
 *  required by `running_sum`/`lag`/`lead` (ignored by the rank family).
 *  `outputColumn` names the appended column. `offset` is used by `lag`/`lead`
 *  (defaults to `1` when absent; must be a positive `Int`). */
final case class WindowConfig(
    partitionBy: Vector[String],
    orderBy: Vector[SortKey],
    function: String,
    field: Option[String],
    outputColumn: String,
    offset: Option[Int]
)

object WindowConfig {
  implicit val format: RootJsonFormat[WindowConfig] = jsonFormat6(WindowConfig.apply)

  def decode(raw: String): WindowConfig = {
    val obj          = StepCodecUtil.asObject(raw)
    val partitionBy  = StepCodecUtil.stringArray(obj, "partitionBy")
    val orderBy      = StepCodecUtil.typedArray[SortKey](obj, "orderBy", "an array of {field, direction} objects")
    val function     = StepCodecUtil.str(obj, "function", "")
    val field        = StepCodecUtil.strOpt(obj, "field")
    val outputColumn = StepCodecUtil.str(obj, "outputColumn", "")
    val offset       = StepCodecUtil.intOpt(obj, "offset")
    WindowConfig(partitionBy, orderBy, function, field, outputColumn, offset)
  }
}

/** Window step — partitions rows by `partitionBy`, orders within each
 *  partition by `orderBy` (reusing `SortStep`'s comparator semantics), and
 *  appends one derived `outputColumn` per row via `function`. Unlike
 *  `aggregate`/`pivot`, `window` preserves row count and the *original input
 *  row order*: the partition-ordered view is only used to compute each
 *  function's value, then the computed values are merged back onto rows by
 *  their original index and re-emitted in original order (design.md
 *  decision 3).
 *
 *  Tie-breaking within a partition's `orderBy` is by each row's original
 *  input index — `WindowStep` builds its own explicit `Ordering` that
 *  includes the index as a final comparison key, rather than delegating to
 *  `SortStep.apply` (which would leave the tie-break undefined for equal
 *  `orderBy` keys).
 *
 *  Supported functions: `row_number` (1-based sequential position),
 *  `rank`/`dense_rank` (standard SQL tie semantics — `rank` skips by tie
 *  count, `dense_rank` never skips), `running_sum` (cumulative numeric sum
 *  of `field`, reusing `AggregateStep`'s sum coercion — non-numeric/absent
 *  values contribute `0`), `lag`/`lead` (raw, un-coerced `field` value from
 *  `offset` positions before/after; `null` at partition edges). An
 *  unsupported `function`, a `running_sum`/`lag`/`lead` missing `field`, or a
 *  non-positive `offset` fails at execute time with a descriptive error
 *  (mirrors `AggregateStep`/`PivotStep`'s unsupported-function error shape). */
final case class WindowStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: WindowConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = WindowStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(WindowStep.apply(rows, config))
}

object WindowStep {
  val Kind: String = "window"

  // HEL-859 (design.md Decision 5): not `private` — see StringOpsStep.SupportedOperations.
  val SupportedFunctions: Vector[String] = Vector("row_number", "rank", "dense_rank", "running_sum", "lag", "lead")
  val FieldRequired: Set[String]         = Set("running_sum", "lag", "lead")

  /** The one message for an unsupported function, shared by write, analyze and run. */
  def unsupportedFunctionMessage(function: String): String =
    s"Unsupported window function: '$function'. Supported: ${SupportedFunctions.mkString(", ")}"

  /** HEL-1416: the single enum/offset rule. A non-empty `function` outside [[SupportedFunctions]], or a
   *  `lag`/`lead` with an explicit `offset` <= 0, is clearly invalid. An empty function is a draft (not a
   *  problem here; analyze and `apply` still refuse it); an absent offset defaults to 1; `offset` on any other
   *  function is ignored by run, so it is not rejected. Shared by `validateRawConfig`, analyze and `apply`
   *  (which runs it after the missing-`field` check, HEL-1422). */
  def enumProblems(cfg: WindowConfig): Vector[String] =
    if (cfg.function.nonEmpty && !SupportedFunctions.contains(cfg.function))
      Vector(unsupportedFunctionMessage(cfg.function))
    else if ((cfg.function == "lag" || cfg.function == "lead") && cfg.offset.exists(_ <= 0))
      Vector(s"window function '${cfg.function}' requires a positive 'offset', got ${cfg.offset.get}")
    else Vector.empty

  def apply(rows: Seq[PipelineRowJson.Row], cfg: WindowConfig): Seq[PipelineRowJson.Row] = {
    // HEL-1422: error order is unsupported function, missing `field`, then a bad offset (the pre-HEL-1416 order,
    // and the order analyze reports): a step with no `field` cannot run whatever its offset is.
    if (cfg.function.nonEmpty && !SupportedFunctions.contains(cfg.function))
      throw new StepConfigError(unsupportedFunctionMessage(cfg.function))
    if (cfg.function.isEmpty) // unconfigured draft: the shared rule only rejects non-empty values
      throw new StepConfigError(unsupportedFunctionMessage(cfg.function))

    val fieldName =
      if (FieldRequired.contains(cfg.function))
        cfg.field.getOrElse(
          throw new StepConfigError(s"window function '${cfg.function}' requires 'field'")
        )
      else ""

    // The function is supported here, so `enumProblems` can only report a non-positive lag/lead offset.
    enumProblems(cfg).headOption.foreach(msg => throw new StepConfigError(msg))

    val offset =
      // Non-positive offsets were refused by `enumProblems` above.
      if (cfg.function == "lag" || cfg.function == "lead") cfg.offset.getOrElse(1) else 0

    // Stage 1: partition rows while retaining each row's original index —
    // the output row order must match the input row order (design.md
    // decision 3), so the index is the mechanism that lets computed values
    // be merged back after being computed over a reordered view.
    val indexed: Seq[(PipelineRowJson.Row, Int)] = rows.zipWithIndex
    val partitioned: Map[Seq[Any], Seq[(PipelineRowJson.Row, Int)]] =
      indexed.groupBy { case (row, _) => cfg.partitionBy.map(name => row.getOrElse(name, null)) }

    // Stage 2: within each partition, produce a sorted-by-orderBy view
    // (index-tie-broken) solely to compute the function value per row.
    val computed: Map[Int, Any] = partitioned.values.flatMap { groupRows =>
      val sorted = groupRows.sorted(rowOrdering(cfg.orderBy))
      cfg.function match {
        case "row_number"  => computeRowNumber(sorted)
        case "rank"         => computeRank(sorted, cfg.orderBy, dense = false)
        case "dense_rank"   => computeRank(sorted, cfg.orderBy, dense = true)
        case "running_sum"  => computeRunningSum(sorted, fieldName)
        case "lag"          => computeLagLead(sorted, fieldName, offset, isLag = true)
        case "lead"         => computeLagLead(sorted, fieldName, offset, isLag = false)
        case other =>
          // Unreachable: cfg.function was validated against SupportedFunctions
          // above. Kept only so the match stays total for the compiler.
          throw new IllegalStateException(s"Unsupported window function: '$other'")
      }
    }.toMap

    // Stage 3: re-emit rows in original input order, appending outputColumn
    // (overwriting any existing field of the same name — design.md decision
    // 5, same last-write-wins precedent as pivot/aggregate).
    rows.zipWithIndex.map { case (row, idx) =>
      row + (cfg.outputColumn -> computed.getOrElse(idx, null))
    }
  }

  /** Total order over `(row, originalIndex)` pairs: compares each `orderBy`
   *  key in turn using the same numeric-if-both-coerce/else-string semantics
   *  as `SortStep` (nulls sort last regardless of direction), then falls
   *  back to the original index. Including the index as the final criterion
   *  makes this an explicit, total, deterministic order — the tie-break does
   *  not depend on any particular sort algorithm's behavior. */
  private def rowOrdering(orderBy: Vector[SortKey]): Ordering[(PipelineRowJson.Row, Int)] =
    (a: (PipelineRowJson.Row, Int), b: (PipelineRowJson.Row, Int)) => {
      val (rowA, idxA) = a
      val (rowB, idxB) = b
      val keyCmp = orderBy.foldLeft(0) { (acc, key) =>
        if (acc != 0) acc
        else {
          val desc = key.direction.equalsIgnoreCase("desc")
          compareValues(rowA.getOrElse(key.field, null), rowB.getOrElse(key.field, null), desc)
        }
      }
      if (keyCmp != 0) keyCmp else idxA.compareTo(idxB)
    }

  /** Compare two cell values: numeric comparison when both coerce to a
   *  `Double`, else string comparison; `null` sorts last regardless of
   *  `desc` (parity with `SortStep`). */
  private def compareValues(a: Any, b: Any, desc: Boolean): Int =
    (Option(a), Option(b)) match {
      case (None, None) => 0
      case (None, _)    => 1
      case (_, None)    => -1
      case (Some(x), Some(y)) =>
        val cmp = (PipelineRowJson.toDouble(x), PipelineRowJson.toDouble(y)) match {
          case (Some(xd), Some(yd)) => xd.compareTo(yd)
          case _                    => x.toString.compareTo(y.toString)
        }
        if (desc) -cmp else cmp
    }

  /** Whether two rows share the same `orderBy` key values — used by
   *  `rank`/`dense_rank` to detect tied groups. Equality mirrors
   *  `compareValues`'s notion of equal (numeric equality if both coerce,
   *  else string equality); direction is irrelevant to equality. */
  private def orderKeysEqual(a: PipelineRowJson.Row, b: PipelineRowJson.Row, orderBy: Vector[SortKey]): Boolean =
    orderBy.forall(key => compareValues(a.getOrElse(key.field, null), b.getOrElse(key.field, null), desc = false) == 0)

  private def computeRowNumber(sorted: Seq[(PipelineRowJson.Row, Int)]): Map[Int, Any] =
    sorted.zipWithIndex.map { case ((_, origIdx), pos) => origIdx -> (pos + 1) }.toMap

  /** `rank`: 1-based, ties share a rank and the next distinct value's rank
   *  skips by the number of tied rows (standard SQL `RANK()`). `dense_rank`:
   *  ties share a rank but the next distinct value's rank increments by
   *  exactly 1 (standard SQL `DENSE_RANK()`). */
  private def computeRank(
      sorted: Seq[(PipelineRowJson.Row, Int)],
      orderBy: Vector[SortKey],
      dense: Boolean
  ): Map[Int, Any] = {
    var rank      = 0
    var denseRank = 0
    var prevRow: Option[PipelineRowJson.Row] = None
    sorted.zipWithIndex.map { case ((row, origIdx), pos) =>
      val isNewGroup = prevRow.forall(p => !orderKeysEqual(p, row, orderBy))
      if (isNewGroup) {
        rank = pos + 1
        denseRank += 1
      }
      prevRow = Some(row)
      origIdx -> (if (dense) denseRank else rank)
    }.toMap
  }

  /** Cumulative sum of `field`'s numeric-coerced value in partition order.
   *  Non-numeric/absent values contribute `0` (parity with `AggregateStep`'s
   *  `sum`, whose `flatMap(toDouble).sum` silently drops non-coercing
   *  entries rather than erroring). */
  private def computeRunningSum(sorted: Seq[(PipelineRowJson.Row, Int)], field: String): Map[Int, Any] = {
    var cumulative = 0.0
    sorted.map { case (row, origIdx) =>
      cumulative += PipelineRowJson.toDouble(row.getOrElse(field, null)).getOrElse(0.0)
      origIdx -> cumulative
    }.toMap
  }

  /** Raw (un-coerced) `field` value of the row `offset` positions
   *  before (`lag`) or after (`lead`) the current row in partition order.
   *  `null` when that position falls outside the partition. */
  private def computeLagLead(
      sorted: Seq[(PipelineRowJson.Row, Int)],
      field: String,
      offset: Int,
      isLag: Boolean
  ): Map[Int, Any] = {
    val n = sorted.size
    sorted.zipWithIndex.map { case ((_, origIdx), pos) =>
      val targetPos = if (isLag) pos - offset else pos + offset
      val value: Any = if (targetPos >= 0 && targetPos < n) sorted(targetPos)._1.getOrElse(field, null) else null
      origIdx -> value
    }.toMap
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    override def group: Option[StepGroup]     = Some(StepGroup.Aggregate)
    override def catalogDescription: String   = "Compute a windowed value, like a rank or running total, over ordered rows."
    def decodeConfig(raw: String): Any    = WindowConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[WindowConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[WindowConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[WindowConfig].toJson

    /** HEL-814 D3. An empty `outputColumn` appends a field named `""` to
     *  every row — `pipeline-window-op:14-15` declares it as a plain
     *  `string` with no default, unlike the `Option[...]` keys on either side
     *  of it. `function` and its per-function `field`/`offset` requirements
     *  are NOT re-declared: `pipeline-step-config-validation:12-13` already
     *  covers them and both run and analyze already enforce them. */
    override def requiredConfigProblems(raw: String): Vector[String] =
      StepCodecUtil.missingRequired(Kind, "outputColumn" -> WindowConfig.decode(raw).outputColumn)

    /** HEL-1416: write-time rejection of a non-empty unknown `function` and a lag/lead `offset` <= 0 (the
     *  HEL-1310 pattern). Drafts (empty function, missing `field`) stay accepted (HEL-814 D2). */
    override def validateRawConfig(raw: String): Option[String] =
      super.validateRawConfig(raw).orElse {
        Try(WindowConfig.decode(raw)).toOption.flatMap(enumProblems(_).headOption)
      }
  }
}
