package com.helio.domain

import scala.concurrent.{ExecutionContext, Future}
import spray.json.{JsString, JsValue}

/** In-process panel query executor. Reuses [[InProcessPipelineEngine]] to load
 * rows from the data source (static/csv supported in v1.3), then applies
 * the panel query's projection, filters, sort, and limit in plain Scala.
 *
 * Filter syntax (matches the Spark pushdown subset used in panels today):
 *   - `<col> = <literal>`  (also `==`)
 *   - `<col> != <literal>`
 *   - `<col> > <literal>`  (and `<`, `>=`, `<=`)
 * Literals may be quoted ("foo" / 'foo'), numeric, true/false, or null.
 * Unsupported expressions are passed through as no-ops (defensive — Spark's
 * `DataFrame.filter` is far more capable; only the panel UI's generated
 * subset is supported here).
 */
class InProcessPanelQueryEngine(pipelineEngine: InProcessPipelineEngine)(implicit
    ec: ExecutionContext
) extends PanelQueryEngine {

  def execute(dataSource: DataSource, query: PanelQuery): Future[Seq[Map[String, Any]]] =
    pipelineEngine.loadRows(dataSource).map { rows =>
      val projected = project(rows, query.selectedFields)
      val filtered  = applyFilters(projected, query.filters)
      val sorted    = applySort(filtered, query.sort)
      query.limit.fold(sorted)(n => sorted.take(n))
    }

  private def project(rows: Seq[Map[String, Any]], fields: List[String]): Seq[Map[String, Any]] =
    if (fields.isEmpty) rows
    else rows.map(row => fields.flatMap(f => row.get(f).map(f -> _)).toMap)

  private def applyFilters(
      rows: Seq[Map[String, Any]],
      filters: List[JsValue]
  ): Seq[Map[String, Any]] =
    filters.foldLeft(rows) {
      case (acc, JsString(expr)) => acc.filter(rowMatches(_, expr))
      case (acc, _)              => acc
    }

  private val FilterPattern = """^\s*(\w+)\s*(==|!=|=|>=|<=|>|<)\s*(.+?)\s*$""".r

  private def rowMatches(row: Map[String, Any], expr: String): Boolean = expr match {
    case FilterPattern(col, op, rawLit) =>
      val lit  = parseLiteral(rawLit)
      val cell = row.get(col).orNull
      compare(op, cell, lit)
    case _ => true // pass through unrecognized expressions rather than dropping all rows
  }

  private def parseLiteral(raw: String): Any = {
    val trimmed = raw.trim
    if (
      (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) trimmed.substring(1, trimmed.length - 1)
    else if (trimmed.equalsIgnoreCase("null")) null
    else if (trimmed.equalsIgnoreCase("true")) true
    else if (trimmed.equalsIgnoreCase("false")) false
    else
      trimmed.toDoubleOption match {
        case Some(d) => d
        case None    => trimmed
      }
  }

  private def compare(op: String, cell: Any, lit: Any): Boolean = (op, cell, lit) match {
    case ("=" | "==", a, b) => valuesEqual(a, b)
    case ("!=", a, b)       => !valuesEqual(a, b)
    case (cmp, a, b)        => numericCompare(cmp, a, b)
  }

  private def valuesEqual(a: Any, b: Any): Boolean = (a, b) match {
    case (null, null)             => true
    case (null, _) | (_, null)    => false
    case (x: Number, y: Number)   => x.doubleValue() == y.doubleValue()
    case (x: String, y: Number)   => x.toDoubleOption.contains(y.doubleValue())
    case (x: Number, y: String)   => y.toDoubleOption.contains(x.doubleValue())
    case (x, y)                   => x.toString == y.toString
  }

  private def numericCompare(op: String, a: Any, b: Any): Boolean = {
    val da = asDouble(a)
    val db = asDouble(b)
    if (da.isEmpty || db.isEmpty) return false
    val x = da.get
    val y = db.get
    op match {
      case ">"  => x > y
      case ">=" => x >= y
      case "<"  => x < y
      case "<=" => x <= y
      case _    => false
    }
  }

  private def asDouble(v: Any): Option[Double] = v match {
    case null         => None
    case n: Number    => Some(n.doubleValue())
    case s: String    => s.toDoubleOption
    case b: Boolean   => Some(if (b) 1.0 else 0.0)
    case _            => None
  }

  private def applySort(rows: Seq[Map[String, Any]], sort: Option[String]): Seq[Map[String, Any]] =
    sort match {
      case None => rows
      case Some(expr) =>
        val tokens     = expr.trim.split("\\s+", 2)
        val col        = tokens(0)
        val descending = tokens.lift(1).exists(_.equalsIgnoreCase("DESC"))
        val sorted = rows.sortBy(_.getOrElse(col, null))(rowOrdering)
        if (descending) sorted.reverse else sorted
    }

  // Lenient ordering: numeric where possible, lexical otherwise. Nulls sort last
  // (mirrors what users see in the in-process pipeline engine).
  private val rowOrdering: Ordering[Any] = new Ordering[Any] {
    def compare(a: Any, b: Any): Int = (a, b) match {
      case (null, null) => 0
      case (null, _)    => 1
      case (_, null)    => -1
      case _ =>
        (asDouble(a), asDouble(b)) match {
          case (Some(x), Some(y)) => java.lang.Double.compare(x, y)
          case _                  => a.toString.compareTo(b.toString)
        }
    }
  }
}
