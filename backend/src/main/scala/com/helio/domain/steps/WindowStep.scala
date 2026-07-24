package com.helio.domain.steps

import com.helio.domain.{PipelineExecutionContext, PipelineId, PipelineRowJson, PipelineStep, PipelineStepId}
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
    val obj         = StepCodecUtil.asObject(raw)
    val partitionBy = obj.fields.get("partitionBy") match {
      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
      case _                    => Vector.empty[String]
    }
    val orderBy = obj.fields.get("orderBy") match {
      case Some(JsArray(items)) => items.flatMap(it => Try(it.convertTo[SortKey]).toOption)
      case _                    => Vector.empty[SortKey]
    }
    val function     = StepCodecUtil.stringOr(obj, "function", "")
    val field        = obj.fields.get("field").collect { case JsString(s) => s }
    val outputColumn = StepCodecUtil.stringOr(obj, "outputColumn", "")
    val offset = obj.fields.get("offset") match {
      case Some(JsNumber(n)) => Try(n.toIntExact).toOption
      case _                 => None
    }
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
    updatedAt: Instant
) extends PipelineStep {
  val kind: String = WindowStep.Kind

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(WindowStep.apply(rows, config))
}

object WindowStep {
  val Kind: String = "window"

  private val SupportedFunctions = Vector("row_number", "rank", "dense_rank", "running_sum", "lag", "lead")
  private val FieldRequired      = Set("running_sum", "lag", "lead")

  def apply(rows: Seq[PipelineRowJson.Row], cfg: WindowConfig): Seq[PipelineRowJson.Row] = {
    if (!SupportedFunctions.contains(cfg.function))
      throw new IllegalArgumentException(
        s"Unsupported window function: '${cfg.function}'. Supported: ${SupportedFunctions.mkString(", ")}"
      )

    val fieldName =
      if (FieldRequired.contains(cfg.function))
        cfg.field.getOrElse(
          throw new IllegalArgumentException(s"window function '${cfg.function}' requires 'field'")
        )
      else ""

    val offset =
      if (cfg.function == "lag" || cfg.function == "lead") {
        val o = cfg.offset.getOrElse(1)
        if (o <= 0)
          throw new IllegalArgumentException(
            s"window function '${cfg.function}' requires a positive 'offset', got $o"
          )
        o
      } else 0

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
          throw new IllegalArgumentException(s"Unsupported window function: '$other'")
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
    def decodeConfig(raw: String): Any    = WindowConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[WindowConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[WindowConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[WindowConfig].toJson
  }
}
