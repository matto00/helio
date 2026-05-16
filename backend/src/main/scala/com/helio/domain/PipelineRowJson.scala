package com.helio.domain

import com.helio.infrastructure.DataSourceRepository.parseStaticPayload
import spray.json._
import spray.json.DefaultJsonProtocol._

/** Cross-cutting helpers for moving pipeline rows between the engine's
 *  `Map[String, Any]` shape, JsValues, and the static-source wire shape.
 *
 *  These used to live on `PipelineStepHandlers` (cycle 1) — cycle 3 distributes
 *  per-kind logic into [[com.helio.domain.steps]] modules and lifts the
 *  shared row utilities here so engine + step modules + the run service can
 *  all import them without re-creating a "common" handlers object. */
object PipelineRowJson {

  type Row = Map[String, Any]

  /** Project a single row into a JsValue map for downstream JSON
   *  serialization (run service result publication, expression-evaluator
   *  inputs). */
  def rowToJsMap(row: Row): Map[String, JsValue] =
    row.map { case (k, v) => k -> anyToJsValue(v) }

  /** Convert an engine row's typed value (anything that lands in the
   *  `Map[String, Any]`) to a JsValue. */
  def anyToJsValue(v: Any): JsValue = v match {
    case null                     => JsNull
    case b: Boolean               => JsBoolean(b)
    case i: Int                   => JsNumber(i)
    case l: Long                  => JsNumber(l)
    case f: Float                 => JsNumber(BigDecimal(f.toDouble))
    case d: Double                => JsNumber(d)
    case bd: BigDecimal           => JsNumber(bd)
    case bd: java.math.BigDecimal => JsNumber(BigDecimal(bd))
    case s: String                => JsString(s)
    case _                        => JsString(v.toString)
  }

  /** Inverse of [[anyToJsValue]] — used when the expression evaluator
   *  returns a JsValue and the engine needs to store it back on a row. */
  def jsValueToAny(v: JsValue): Any = v match {
    case JsNull       => null
    case JsBoolean(b) => b
    case JsNumber(n)  => n.toDouble
    case JsString(s)  => s
    case other        => other.compactPrint
  }

  /** Best-effort numeric coercion. Falls back to `None` rather than throwing
   *  so callers can decide on the no-match policy (filter excludes,
   *  aggregate skips, sort delegates to string order). */
  def toDouble(v: Any): Option[Double] = v match {
    case null           => None
    case i: Int         => Some(i.toDouble)
    case l: Long        => Some(l.toDouble)
    case f: Float       => Some(f.toDouble)
    case d: Double      => Some(d)
    case bd: BigDecimal => Some(bd.toDouble)
    case s: String      => s.toDoubleOption
    case _              => None
  }

  /** Parse a static-source `config` blob (the `{columns, rows}` shape stored
   *  on `data_sources.config`) into engine rows. Lives here because both the
   *  in-process engine's `loadRows` and the join helper consume it. */
  def parseStaticRows(raw: String): Seq[Row] = {
    val obj      = parseStaticPayload(raw)
    val columns  = obj.fields.getOrElse("columns", JsArray.empty).convertTo[Vector[JsObject]]
    val rows     = obj.fields.getOrElse("rows", JsArray.empty).convertTo[Vector[Vector[JsValue]]]
    val colNames = columns.map(_.fields("name").convertTo[String])
    rows.map { row =>
      colNames.zip(row).map { case (name, jsValue) =>
        name -> jsValueToAny(jsValue)
      }.toMap
    }
  }
}
