package com.helio.services.alerts

import com.helio.domain.engine.PipelineRowJson
import com.helio.domain.history.OutputSummaryReducer
import com.helio.domain.model.OutputKind
import com.helio.infrastructure.persistence.pipelines.OutputHistoryPoint
import spray.json._

/** HEL-1278: pure helpers for alert conditions over Output history (no I/O, no DB).
 *
 *  A condition with a `baseline` key compares `comparator(delta, threshold)` where the delta is
 *  between the current value and a baseline drawn from `output_snapshot_history`. Current and
 *  baseline values are BOTH read from [[OutputSummaryReducer]] summaries, so they share semantics
 *  (numeric-string coercion, blank handling, column cap) -- unlike `AlertEvaluationService
 *  .extractMetric`, which threshold rules keep using unchanged. */
object HistoryBaseline {

  sealed trait Kind { def k: Int }
  case object Previous                extends Kind { val k = 1 }
  final case class RollingAvg(n: Int) extends Kind { def k: Int = n }

  sealed trait Mode
  case object Abs extends Mode
  case object Pct extends Mode

  object Mode {
    def asString(m: Mode): String = m match { case Abs => "abs"; case Pct => "pct" }
  }

  final case class Baseline(kind: Kind, mode: Mode)

  val MaxRollingN: Int = 100

  private val Keys = Seq("baseline", "n", "mode")

  /** True iff the condition carries a `baseline` key (even a malformed one, including null). */
  def isBaselineCondition(condition: JsValue): Boolean = condition match {
    case o: JsObject => o.fields.contains("baseline")
    case _           => false
  }

  /** `Right(None)` for a condition with none of `baseline`/`n`/`mode`; `Right(Some)` for a
   *  well-formed baseline condition; `Left(reason)` for anything malformed (including `n`/`mode`
   *  without `baseline`, which would otherwise be silently ignored). */
  def parse(condition: JsObject): Either[String, Option[Baseline]] =
    condition.fields.get("baseline") match {
      case None =>
        Keys.find(condition.fields.contains) match {
          case Some(key) => Left(s"condition.$key requires condition.baseline")
          case None      => Right(None)
        }
      case Some(b) =>
        for {
          mode <- parseMode(condition.fields.get("mode"))
          kind <- parseKind(b, condition.fields.get("n"))
        } yield Some(Baseline(kind, mode))
    }

  private def parseMode(v: Option[JsValue]): Either[String, Mode] = v match {
    case Some(JsString("abs")) => Right(Abs)
    case Some(JsString("pct")) => Right(Pct)
    case Some(_)               => Left("condition.mode must be \"abs\" or \"pct\"")
    case None                  => Left("condition.mode is required with condition.baseline")
  }

  private def parseKind(baseline: JsValue, n: Option[JsValue]): Either[String, Kind] = baseline match {
    case JsString("previous") =>
      if (n.isDefined) Left("condition.n is not allowed with baseline \"previous\"") else Right(Previous)
    case JsString("rolling_avg") =>
      n match {
        case Some(JsNumber(v)) if v.isWhole && v >= 1 && v <= MaxRollingN => Right(RollingAvg(v.toInt))
        case _ => Left(s"condition.n must be an integer from 1 to $MaxRollingN with baseline \"rolling_avg\"")
      }
    case _ => Left("condition.baseline must be \"previous\" or \"rolling_avg\"")
  }

  /** The value a summary holds for `metric`: `"*"` is the row count, anything else the column
   *  sum. `None` for an absent column or a non-finite (`null`) sum. */
  def summaryValue(summary: JsObject, metric: String): Option[Double] =
    if (metric == "*") summary.fields.get("rowCount").collect { case JsNumber(n) => n.toDouble }
    else
      summary.fields.get("columns").collect { case o: JsObject => o }
        .flatMap(_.fields.get(metric)).collect { case o: JsObject => o }
        .flatMap(_.fields.get("sum")).collect { case JsNumber(n) => n.toDouble }

  /** The current run's summary, built exactly as the history write path builds the stored one. */
  def currentSummary(rows: Seq[PipelineRowJson.Row]): JsObject = {
    val jsRows = rows.map(r => JsObject(r.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })).toVector
    OutputSummaryReducer.summarize(jsRows, OutputKind.Table, JsObject.empty)
  }

  def currentValue(rows: Seq[PipelineRowJson.Row], metric: String): Option[Double] =
    summaryValue(currentSummary(rows), metric)

  /** The `k` newest points NOT written by `triggeringRunId`. `points` is newest first. */
  def eligible(points: Seq[OutputHistoryPoint], triggeringRunId: String, k: Int): Vector[OutputHistoryPoint] =
    points.filterNot(_.runId.contains(triggeringRunId)).take(k).toVector

  /** `previous` -> the newest eligible point's value; `rolling_avg` -> the mean of exactly `n`
   *  eligible points. Any shortfall or valueless point yields `None` (never a partial mean). */
  def baselineValue(kind: Kind, eligiblePoints: Seq[OutputHistoryPoint], metric: String): Option[Double] =
    if (eligiblePoints.size < kind.k) None
    else {
      val values = eligiblePoints.take(kind.k).map(p => summaryValue(p.summary, metric))
      if (values.exists(_.isEmpty)) None else Some(values.flatten.sum / kind.k)
    }

  /** `abs`: current - baseline. `pct`: (current - baseline) / |baseline| * 100; `None` on a zero baseline. */
  def delta(mode: Mode, current: Double, baseline: Double): Option[Double] = mode match {
    case Abs => Some(current - baseline)
    case Pct => if (baseline == 0.0) None else Some((current - baseline) / math.abs(baseline) * 100.0)
  }
}
