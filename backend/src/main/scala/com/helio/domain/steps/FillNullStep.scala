package com.helio.domain.steps

import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.PipelineRowJson
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `fillnull` step (HEL-388) — the sixth leaf of the
 *  HEL-336 Pipeline Op Expansion epic. `columns` names the fields to fill;
 *  `strategy` selects one of `constant`/`forwardFill`/`mean`/`median`/`mode`
 *  (shared by every column in `columns` — per-column strategy mixing is
 *  achieved by chaining multiple `fillnull` steps, design.md decision 1).
 *  `value` is the raw fill string, required only by `constant`. */
final case class FillNullConfig(columns: Vector[String], strategy: String, value: Option[String])

object FillNullConfig {
  implicit val format: RootJsonFormat[FillNullConfig] = jsonFormat3(FillNullConfig.apply)

  /** Tolerant decode: missing `columns` defaults to empty, missing/malformed
   *  `strategy` defaults to `""` (fails at execute time with a descriptive
   *  error, mirroring `WindowConfig.decode`'s missing-`function` handling),
   *  missing `value` defaults to `None`. */
  def decode(raw: String): FillNullConfig = {
    val obj      = StepCodecUtil.asObject(raw)
    val columns  = StepCodecUtil.stringArray(obj, "columns")
    val strategy = StepCodecUtil.str(obj, "strategy", "")
    val value    = StepCodecUtil.strOpt(obj, "value")
    FillNullConfig(columns, strategy, value)
  }
}

/** FillNull step — replaces only null cells (a missing key or an explicit
 *  `null` value; both unify via `row.getOrElse(field, null)`, design.md
 *  decision 2) in `columns` per `strategy`. Schema-preserving: no column is
 *  added or removed, same shape as `CastStep`. Semantics (design.md):
 *
 *    - `constant`: every null cell in `columns` becomes `cfg.value` (raw
 *      string, no coercion). Fails at execute time if `value` is absent.
 *    - `forwardFill`: per column, a single left-to-right pass carries the
 *      last non-null value seen in original row order; a leading null run
 *      (no prior non-null value yet) stays null.
 *    - `mean`/`median`: one value computed per column over the batch's
 *      non-null values, coerced via `PipelineRowJson.toDouble` (numeric-only,
 *      matches `AggregateStep.avg`'s coercion), then used to fill every null
 *      cell in that column. An all-null (or all-non-numeric) column stays
 *      null — never a hard failure.
 *    - `mode`: one value computed per column — the most frequent raw
 *      (un-coerced) non-null value, ties broken by first-encountered order
 *      for determinism. An all-null column stays null.
 *
 *  An unsupported `strategy` fails at execute time with a descriptive error
 *  naming the invalid value and the five supported strategies (mirrors
 *  `WindowStep`/`AggregateStep`/`PivotStep`'s unsupported-function shape). */
final case class FillNullStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: FillNullConfig,
    createdAt: Instant,
    updatedAt: Instant,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = FillNullStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(FillNullStep.apply(rows, config))
}

object FillNullStep {
  val Kind: String = "fillnull"

  // HEL-859 (design.md Decision 5): not `private` — see StringOpsStep.SupportedOperations.
  val SupportedStrategies: Vector[String] = Vector("constant", "forwardFill", "mean", "median", "mode")

  def apply(rows: Seq[PipelineRowJson.Row], cfg: FillNullConfig): Seq[PipelineRowJson.Row] = {
    if (!SupportedStrategies.contains(cfg.strategy))
      throw new IllegalArgumentException(
        s"Unsupported fillnull strategy: '${cfg.strategy}'. Supported: ${SupportedStrategies.mkString(", ")}"
      )

    cfg.strategy match {
      case "constant" =>
        val fillValue = cfg.value.getOrElse(
          throw new IllegalArgumentException("fillnull strategy 'constant' requires 'value'")
        )
        fillConstant(rows, cfg.columns, fillValue)
      case "forwardFill" => fillForward(rows, cfg.columns)
      case "mean"         => fillWithStat(rows, cfg.columns, computeMean)
      case "median"       => fillWithStat(rows, cfg.columns, computeMedian)
      case "mode"         => fillWithStat(rows, cfg.columns, computeMode)
    }
  }

  /** Whether a row's `column` value counts as null for fill purposes: absent
   *  key or an explicit `null`, both surfaced by `getOrElse(column, null)`
   *  (design.md decision 2). */
  private def isNull(row: PipelineRowJson.Row, column: String): Boolean =
    row.getOrElse(column, null) == null

  private def fillConstant(rows: Seq[PipelineRowJson.Row], columns: Vector[String], value: String): Seq[PipelineRowJson.Row] =
    rows.map { row =>
      columns.foldLeft(row) { (r, col) =>
        if (isNull(r, col)) r + (col -> value) else r
      }
    }

  /** Single left-to-right pass per column: a mutable "last seen non-null
   *  value" tracker seeded to `null` carries forward across rows; a leading
   *  null run (tracker still `null`) leaves the cell untouched (design.md
   *  decision 4). */
  private def fillForward(rows: Seq[PipelineRowJson.Row], columns: Vector[String]): Seq[PipelineRowJson.Row] = {
    val lastSeen = scala.collection.mutable.Map.empty[String, Any]
    columns.foreach(col => lastSeen(col) = null)
    rows.map { row =>
      columns.foldLeft(row) { (r, col) =>
        val current = r.getOrElse(col, null)
        if (current != null) {
          lastSeen(col) = current
          r
        } else {
          val carried = lastSeen(col)
          if (carried != null) r + (col -> carried) else r
        }
      }
    }
  }

  /** Fill every null cell in each of `columns` with one value per column,
   *  computed by `stat` over that column's non-null values across the whole
   *  batch (single pass, design.md decision 5). `stat` returns `None` when
   *  the statistic is undefined (no non-null / no numeric-coercing values),
   *  in which case the column's null cells stay null. */
  private def fillWithStat(
      rows: Seq[PipelineRowJson.Row],
      columns: Vector[String],
      stat: (Seq[PipelineRowJson.Row], String) => Option[Any]
  ): Seq[PipelineRowJson.Row] = {
    val statByColumn = columns.map(col => col -> stat(rows, col)).toMap
    rows.map { row =>
      columns.foldLeft(row) { (r, col) =>
        if (isNull(r, col)) {
          statByColumn(col) match {
            case Some(v) => r + (col -> v)
            case None    => r
          }
        } else r
      }
    }
  }

  /** Arithmetic mean of `column`'s non-null values, coerced via
   *  `PipelineRowJson.toDouble` (non-numeric values excluded, matching
   *  `AggregateStep.avg`'s `nums.flatMap(toDouble)` pattern). `None` if no
   *  value coerces. */
  private def computeMean(rows: Seq[PipelineRowJson.Row], column: String): Option[Any] = {
    val nums = rows.flatMap(r => PipelineRowJson.toDouble(r.getOrElse(column, null)))
    if (nums.isEmpty) None else Some(nums.sum / nums.size)
  }

  /** Median of `column`'s non-null numeric-coerced values (sorted midpoint;
   *  average of the two middle values for an even count). `None` if no value
   *  coerces. */
  private def computeMedian(rows: Seq[PipelineRowJson.Row], column: String): Option[Any] = {
    val nums = rows.flatMap(r => PipelineRowJson.toDouble(r.getOrElse(column, null))).sorted
    if (nums.isEmpty) None
    else {
      val n = nums.size
      if (n % 2 == 1) Some(nums(n / 2))
      else Some((nums(n / 2 - 1) + nums(n / 2)) / 2.0)
    }
  }

  /** Most frequent raw (un-coerced) non-null value of `column`, ties broken
   *  by first-encountered order — an explicit ordered count (not a plain
   *  `groupBy`, whose iteration order is not guaranteed) so the winner is
   *  deterministic across runs (design.md decision 5 / risk 3). `None` if
   *  every value is null. */
  private def computeMode(rows: Seq[PipelineRowJson.Row], column: String): Option[Any] = {
    val counts       = scala.collection.mutable.LinkedHashMap.empty[Any, Int]
    rows.foreach { r =>
      val v = r.getOrElse(column, null)
      if (v != null) counts(v) = counts.getOrElse(v, 0) + 1
    }
    if (counts.isEmpty) None
    else Some(counts.maxBy { case (_, count) => count }._1)
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = FillNullConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[FillNullConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[FillNullConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[FillNullConfig].toJson
  }
}
