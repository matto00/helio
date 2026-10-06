package com.helio.domain.history

import com.helio.domain.history.JsSemantics.{coerceNumber, isFinite, jsString, jsTrim}
import com.helio.domain.model.OutputKind
import spray.json._

import java.lang.{Math => JMath}

/** Pure reducer behind `output_snapshot_history.summary` (version 1): a faithful port of
 *  `frontend/src/utils/aggregate.ts` (`computeAggregate`/`groupAndAggregate`) over the node's
 *  typed rows, plus per-numeric-column stats and the chart x->y series. No I/O.
 *
 *  `columns[c].count` is the number of cells COERCIBLE to a finite number, deliberately not
 *  `computeAggregate`'s `count` (non-null cells) -- consumers must not conflate the two. */
object OutputSummaryReducer {

  val MaxColumns: Int      = 20
  val MaxSeriesPoints: Int = 200
  val MaxXStringChars: Int = 256

  private val Aggs = Set("count", "sum", "avg", "min", "max")

  private def cell(row: JsObject, field: String): Option[JsValue] = row.fields.get(field)

  /** Port of `computeAggregate`; `None` is the TS `null` (also returned for an unknown `agg`). */
  def computeAggregate(rows: Vector[JsObject], field: String, agg: String): Option[Double] = {
    def nums = rows.flatMap(r => cell(r, field).flatMap(coerceNumber))
    agg match {
      case "count" => Some(rows.count(r => cell(r, field).exists(_ != JsNull)).toDouble)
      case "sum"   => Some(nums.foldLeft(0.0)(_ + _))
      case "avg"   => Some(nums).filter(_.nonEmpty).map(ns => ns.foldLeft(0.0)(_ + _) / ns.size)
      case "min"   => Some(nums).filter(_.nonEmpty).map(_.reduce(JMath.min(_, _)))
      case "max"   => Some(nums).filter(_.nonEmpty).map(_.reduce(JMath.max(_, _)))
      case _       => None
    }
  }

  /** Port of `groupAndAggregate`: categories sorted by UTF-16 code units, value `?? 0`. */
  def groupAndAggregate(rows: Vector[JsObject], groupBy: String, agg: String, yField: String): (Vector[String], Vector[Double]) = {
    val groups     = rows.groupBy(r => jsString(cell(r, groupBy)))
    val categories = groups.keys.toVector.sorted
    (categories, categories.map(k => computeAggregate(groups(k), yField, agg).getOrElse(0.0)))
  }

  /** `Some(finite)` as a JSON number, anything else (absent, NaN, +-Infinity) as `null`. */
  private def num(d: Option[Double]): JsValue = d.filter(isFinite).fold[JsValue](JsNull)(v => JsNumber(v))

  def summarize(rows: Vector[JsObject], kind: OutputKind, config: JsObject): JsObject = {
    val (columns, truncated) = columnStats(rows)
    JsObject(
      "v"                -> JsNumber(1),
      "rowCount"         -> JsNumber(rows.size),
      "columns"          -> columns,
      "columnsTruncated" -> JsBoolean(truncated),
      "metric"           -> (if (kind == OutputKind.Metric) metricOf(rows, config) else JsNull),
      "series"           -> (if (kind == OutputKind.Chart) series(rows, config) else JsNull)
    )
  }

  /** Candidate columns are the union of keys across ALL rows (never row 0 only). A column is
   *  numeric iff at least one cell coerces and every cell that is not absent/null/blank does. */
  private def columnStats(rows: Vector[JsObject]): (JsObject, Boolean) = {
    val names = rows.iterator.flatMap(_.fields.keysIterator).toSet.toVector.sorted
    val numeric = names.flatMap { name =>
      val cells    = rows.flatMap(cell(_, name)).filter {
        case JsNull      => false
        case JsString(s) => jsTrim(s).nonEmpty
        case _           => true
      }
      val coerced = cells.flatMap(coerceNumber)
      if (coerced.isEmpty || coerced.size != cells.size) None
      else Some(name -> JsObject(
        "count" -> JsNumber(coerced.size),
        "sum"   -> num(Some(coerced.foldLeft(0.0)(_ + _))),
        "min"   -> num(Some(coerced.min)),
        "max"   -> num(Some(coerced.max))
      ))
    }
    (JsObject(numeric.take(MaxColumns).toMap), numeric.size > MaxColumns)
  }

  private def stringField(config: JsObject, path: String*): Option[String] =
    path.foldLeft[Option[JsValue]](Some(config))((acc, key) => acc.collect { case o: JsObject => o }.flatMap(_.fields.get(key))).collect {
      case JsString(s) if s.nonEmpty => s
    }

  /** The metric field/aggregation for a config: `fieldMapping.value`, then `aggregation.value`. A
   *  `label`/`unit` mapping is never the metric field; with neither present there is none
   *  (HEL-1326). Mirrored by the client's `resolveServerMetricField` (shared `metricField` fixture). */
  def metricField(config: JsObject): Option[(String, Option[String])] =
    stringField(config, "fieldMapping", "value").orElse(stringField(config, "aggregation", "value")).map { field =>
      (field, stringField(config, "aggregation", "agg"))
    }

  /** The metric summary `{field, agg, value}` over `rows`, or `JsNull` when the config resolves to no field.
   *  Only `config`'s metric field is read from each row, so projected `{field -> cell}` rows give the same result. */
  def metricOf(rows: Vector[JsObject], config: JsObject): JsValue =
    metricField(config) match {
      case None => JsNull
      case Some((field, aggOpt)) =>
        val value = aggOpt match {
          case Some(agg) => computeAggregate(rows, field, agg)
          case None      => rows.headOption.flatMap(cell(_, field)).flatMap(coerceNumber)
        }
        JsObject("field" -> JsString(field), "agg" -> aggOpt.fold[JsValue](JsNull)(JsString(_)), "value" -> num(value))
    }

  private def series(rows: Vector[JsObject], config: JsObject): JsValue = {
    val groupBy   = stringField(config, "aggregation", "groupBy")
    val agg       = stringField(config, "aggregation", "agg").filter(Aggs)
    val yField    = stringField(config, "aggregation", "yField")
    val chartType = stringField(config, "chartType").getOrElse("line")
    val x         = stringField(config, "fieldMapping", "xAxis")
    val y         = stringField(config, "fieldMapping", "yAxis")
    (groupBy, agg, yField, x, y) match {
      case (Some(g), Some(a), Some(yf), _, _) if chartType != "scatter" =>
        val (cats, vals) = groupAndAggregate(rows, g, a, yf)
        seriesJson("grouped", g, yf, Some(a), cats.zip(vals).map { case (c, v) => JsArray(truncate(JsString(c)), num(Some(v))) })
      case (_, _, _, Some(xf), Some(yf)) =>
        seriesJson("rows", xf, yf, None, rows.map(r => JsArray(truncate(cell(r, xf).getOrElse(JsNull)), num(cell(r, yf).flatMap(coerceNumber)))))
      case _ => JsNull
    }
  }

  private def truncate(v: JsValue): JsValue = v match {
    case JsString(s) if s.length > MaxXStringChars =>
      // Never end on a high surrogate: a lone one is not valid UTF-16 and is corrupted or rejected in JSONB.
      val cut = if (Character.isHighSurrogate(s.charAt(MaxXStringChars - 1))) MaxXStringChars - 1 else MaxXStringChars
      JsString(s.take(cut))
    case other                                     => other
  }

  private def seriesJson(mode: String, x: String, y: String, agg: Option[String], points: Vector[JsValue]): JsObject = {
    val n      = points.size
    val reduced =
      if (n <= MaxSeriesPoints) points
      else (0 until MaxSeriesPoints).map(i => points(math.round(i.toDouble * (n - 1) / (MaxSeriesPoints - 1)).toInt)).toVector
    JsObject(
      "mode"         -> JsString(mode),
      "x"            -> JsString(x),
      "y"            -> JsString(y),
      "agg"          -> agg.fold[JsValue](JsNull)(JsString(_)),
      "points"       -> JsArray(reduced),
      "totalPoints"  -> JsNumber(n),
      "downsampled"  -> JsBoolean(n > MaxSeriesPoints)
    )
  }
}
