package com.helio.services.pipelines

import com.helio.domain.model.OutputKind
import spray.json.{JsNull, JsObject, JsString, JsValue}

/** HEL-1313: write-time validation of an Output's free-form `config` against a per-kind known-key
 *  set, plus the `aggregation` / `chartType` shape rules. Pure; no I/O.
 *
 *  Tolerance rule: only what a write introduces or changes is judged. A key (or `aggregation` /
 *  `chartType` value) re-sent with the value already stored is accepted, so Outputs carrying stored
 *  legacy keys (V94 migration) still update, round-trip and roll back. Reads never call this. */
object OutputConfigValidation {

  private val Shared = Set("fieldMapping", "compare", "historyPayloads")

  val KnownKeys: Map[OutputKind, Set[String]] = Map(
    OutputKind.Chart      -> (Shared ++ Set("chartType", "aggregation", "chartOptions", "annotation")),
    OutputKind.Metric     -> (Shared ++ Set("aggregation", "label", "unit", "format")),
    OutputKind.Table      -> (Shared ++ Set("columnOrder", "columnFormats", "columnSort", "columnFilters", "pinnedColumns")),
    OutputKind.Collection -> (Shared ++ Set("layout", "format")),
    OutputKind.Timeline   -> (Shared ++ Set("sort")),
    OutputKind.Markdown   -> (Shared ++ Set("content"))
  )

  private val Aggs       = Set("count", "sum", "avg", "min", "max")
  private val ChartTypes = Set("bar", "line", "pie", "scatter")

  private val Renames = Map("metricLabel" -> "label", "metricUnit" -> "unit", "chartAnnotation" -> "annotation")
  private val DeadStyling = Set("legend", "tooltip", "seriesColors", "axisLabels")

  /** One text block, built from [[KnownKeys]], for every prompt/tool surface that tells Claude how to write
   *  Output config -- so those surfaces cannot drift from the validator. */
  val KeysDoc: String = {
    val perKind = KnownKeys.toVector.sortBy(_._1.toString).map { case (k, keys) =>
      val own = (keys -- Shared).toVector.sorted
      s"${OutputKind.asString(k)}: ${own.mkString(", ")}"
    }
    "Output config accepts only these top-level keys (anything else is rejected with 400 naming the key). " +
      s"Every kind: ${Shared.toVector.sorted.mkString(", ")}. Per kind -- ${perKind.mkString("; ")}. " +
      "chart aggregation = { groupBy, agg, yField } (all non-empty strings; never on a scatter chart); " +
      "metric aggregation = { agg } (field from fieldMapping.value) or { value, agg }; agg is one of count, sum, avg, min, max; " +
      "aggregation may be null. chartType is one of bar, line, pie, scatter. Chart styling (legend, tooltip, colors) is not Output config: it lives on the panel's appearance.chart."
  }

  /** `written` = what the caller sent (create body / PATCH patch); `stored` = the pre-write config
   *  (empty on create). */
  def validate(kind: OutputKind, written: JsObject, stored: JsObject): Either[String, Unit] = {
    val known = KnownKeys.getOrElse(kind, Shared)
    val kindName = OutputKind.asString(kind)
    val offending = written.fields.toVector.collect {
      case (key, value) if !known.contains(key) && !tolerated(stored, key, value) => key
    }.sorted
    if (offending.nonEmpty) {
      val described = offending.map(k => describe(kind, kindName, known, k)).mkString("; ")
      Left(s"Unknown config key${if (offending.size > 1) "s" else ""} for a $kindName Output: $described. Valid keys: ${known.toVector.sorted.mkString(", ")}")
    } else
      validateChartType(written, stored).flatMap(_ => validateAggregation(kind, written, stored))
  }

  private def tolerated(stored: JsObject, key: String, value: JsValue): Boolean =
    stored.fields.get(key) match {
      case Some(existing) => value == JsNull || existing == value
      case None           => false
    }

  private def changed(written: JsObject, stored: JsObject, key: String): Option[JsValue] =
    written.fields.get(key).filter(v => !stored.fields.get(key).contains(v))

  private def describe(kind: OutputKind, kindName: String, known: Set[String], key: String): String =
    Renames.get(key).filter(known.contains).map(r => s"`$key` (renamed: use `$r`)")
      .orElse(Option.when(DeadStyling.contains(key))(s"`$key` (no renderer reads it; chart styling lives on the panel's appearance.chart)"))
      .orElse(Option.when(KnownKeys.exists { case (k, keys) => k != kind && keys.contains(key) && !Shared.contains(key) })(s"`$key` (not a $kindName config key)"))
      .orElse(nearest(known, key).map(n => s"`$key` (did you mean `$n`?)"))
      .getOrElse(s"`$key`")

  private def nearest(known: Set[String], key: String): Option[String] =
    known.toVector.sorted.map(k => k -> distance(k.toLowerCase, key.toLowerCase)).filter(_._2 <= 2).sortBy(_._2).headOption.map(_._1)

  private def distance(a: String, b: String): Int = {
    val prev = Array.tabulate(b.length + 1)(identity)
    for (i <- 1 to a.length) {
      var diag = prev(0)
      prev(0) = i
      for (j <- 1 to b.length) {
        val up = prev(j)
        prev(j) = math.min(math.min(prev(j) + 1, prev(j - 1) + 1), diag + (if (a(i - 1) == b(j - 1)) 0 else 1))
        diag = up
      }
    }
    prev(b.length)
  }

  private def validateChartType(written: JsObject, stored: JsObject): Either[String, Unit] =
    changed(written, stored, "chartType") match {
      case Some(JsString(s)) if ChartTypes.contains(s) => Right(())
      case Some(JsNull) | None                         => Right(())
      case Some(_) => Left(s"chartType must be one of ${ChartTypes.toVector.sorted.mkString(", ")} (or null)")
    }

  private def nonEmpty(o: JsObject, key: String): Option[String] =
    o.fields.get(key).collect { case JsString(s) if s.trim.nonEmpty => s }

  private def validateAggregation(kind: OutputKind, written: JsObject, stored: JsObject): Either[String, Unit] = {
    val merged = JsObject(stored.fields ++ written.fields)
    val aggChange = changed(written, stored, "aggregation")
    val scatterCheck: Either[String, Unit] =
      if (kind == OutputKind.Chart && (aggChange.isDefined || changed(written, stored, "chartType").isDefined)) {
        val scatter = merged.fields.get("chartType").contains(JsString("scatter"))
        val hasAgg  = merged.fields.get("aggregation").exists(_ != JsNull)
        if (scatter && hasAgg) Left("aggregation is not supported on a scatter chart (a scatter chart never aggregates); set aggregation to null or change chartType")
        else Right(())
      } else Right(())
    aggChange match {
      case None | Some(JsNull) => scatterCheck
      case Some(agg: JsObject) if kind == OutputKind.Chart  => chartShape(agg).flatMap(_ => scatterCheck)
      case Some(agg: JsObject) if kind == OutputKind.Metric => metricShape(agg, merged)
      case Some(_) =>
        Left(
          if (kind == OutputKind.Chart) "aggregation must be { groupBy, agg, yField } or null"
          else "aggregation must be { agg } or { value, agg } or null"
        )
    }
  }

  private def chartShape(agg: JsObject): Either[String, Unit] = {
    val expected = "aggregation on a chart must be { groupBy, agg, yField }: non-empty strings with agg one of count, sum, avg, min, max"
    val extra = agg.fields.keySet -- Set("groupBy", "agg", "yField")
    if (extra.nonEmpty || nonEmpty(agg, "groupBy").isEmpty || nonEmpty(agg, "yField").isEmpty || !nonEmpty(agg, "agg").exists(Aggs.contains))
      Left(expected)
    else Right(())
  }

  private def metricShape(agg: JsObject, merged: JsObject): Either[String, Unit] = {
    val shapeOk = (agg.fields.keySet -- Set("value", "agg")).isEmpty &&
      nonEmpty(agg, "agg").exists(Aggs.contains) &&
      (!agg.fields.contains("value") || nonEmpty(agg, "value").isDefined)
    if (!shapeOk)
      Left("aggregation on a metric must be { agg } (field from fieldMapping.value) or { value, agg }: non-empty strings with agg one of count, sum, avg, min, max")
    else {
      val mappingValue = merged.fields.get("fieldMapping").collect { case o: JsObject => o }.flatMap(nonEmpty(_, "value"))
      (mappingValue, nonEmpty(agg, "value")) match {
        case (None, None)                 => Left("aggregation on a metric needs a field: set fieldMapping.value or aggregation.value")
        case (Some(a), Some(b)) if a != b => Left(s"aggregation.value ('$b') conflicts with fieldMapping.value ('$a'); they must be equal (or send only one)")
        case _                            => Right(())
      }
    }
  }
}

/** HEL-1313 D9: whether an Output config write is a caller's new value ([[ValidateWrite]]) or the
 *  restoration of previously journaled state ([[RestorePriorStored]], patch-set rollback only --
 *  never reachable from a route), which may hold a value today's rules reject. */
sealed trait OutputConfigWritePolicy
object OutputConfigWritePolicy {
  case object ValidateWrite      extends OutputConfigWritePolicy
  case object RestorePriorStored extends OutputConfigWritePolicy
}
