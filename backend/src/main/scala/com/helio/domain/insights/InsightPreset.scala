package com.helio.domain.insights

import com.helio.domain.history.OutputCompare
import com.helio.domain.model.OutputKind
import spray.json.{JsArray, JsObject, JsString, JsValue}

sealed trait InsightPreset {
  def asString: String
}

object InsightPreset {
  case object Auto    extends InsightPreset { val asString = "auto" }
  case object Delta   extends InsightPreset { val asString = "delta" }
  case object Trend   extends InsightPreset { val asString = "trend" }
  case object Leaders extends InsightPreset { val asString = "leaders" }
  case object Summary extends InsightPreset { val asString = "summary" }

  val all: Vector[InsightPreset] = Vector(Auto, Delta, Trend, Leaders, Summary)

  def fromString(s: String): Option[InsightPreset] = all.find(_.asString == s)
}

/** What the node carries (HEL-1741 D6). `outputs` are the (kind, config) of the Outputs on the node;
 *  `stepOps` are the enabled op names from the root to the node. */
final case class InsightNodeSignals(outputs: Vector[(OutputKind, JsObject)], columnTypes: Map[String, String], stepOps: Vector[String])

object InsightPresetInference {

  private val DateLikeTypes = Seq("date", "time")

  /** An explicit preset passes through; `Auto` is inferred: Delta, then Trend, then Leaders, else Summary. */
  def infer(preset: InsightPreset, signals: InsightNodeSignals): InsightPreset =
    preset match {
      case InsightPreset.Auto =>
        if (hasMetricWithCompare(signals)) InsightPreset.Delta
        else if (hasTimeSeriesChart(signals)) InsightPreset.Trend
        else if (hasTopNTable(signals)) InsightPreset.Leaders
        else InsightPreset.Summary
      case explicit => explicit
    }

  private def hasMetricWithCompare(s: InsightNodeSignals): Boolean =
    s.outputs.exists { case (kind, config) =>
      kind == OutputKind.Metric && OutputCompare.fromConfig(config).exists(_.isDefined)
    }

  private def hasTimeSeriesChart(s: InsightNodeSignals): Boolean =
    s.outputs.exists { case (kind, config) =>
      kind == OutputKind.Chart && (isLine(config) || xField(config).exists(f => isDateColumn(s.columnTypes.get(f))))
    }

  /** An absent `chartType` counts as line, matching `OutputSummaryReducer`. */
  private def isLine(config: JsObject): Boolean =
    config.fields.get("chartType") match {
      case None                  => true
      case Some(JsString(value)) => value == "line"
      case Some(_)               => false
    }

  private def xField(config: JsObject): Option[String] = {
    def str(v: JsValue): Option[String] = v match {
      case JsString(s)                      => Some(s)
      case JsArray(elements) if elements.nonEmpty => str(elements.head)
      case _                                => None
    }
    val fromMapping = config.fields.get("fieldMapping").collect { case o: JsObject => o }.flatMap(_.fields.get("xAxis")).flatMap(str)
    fromMapping.orElse(config.fields.get("aggregation").collect { case o: JsObject => o }.flatMap(_.fields.get("groupBy")).flatMap(str))
  }

  private def isDateColumn(columnType: Option[String]): Boolean =
    columnType.exists(t => DateLikeTypes.exists(t.toLowerCase.contains))

  /** A Table whose node's last two ops are `sort` then `limit` (the TopN expansion; shapes are not stored). */
  private def hasTopNTable(s: InsightNodeSignals): Boolean =
    s.outputs.exists(_._1 == OutputKind.Table) && s.stepOps.takeRight(2) == Vector("sort", "limit")
}
