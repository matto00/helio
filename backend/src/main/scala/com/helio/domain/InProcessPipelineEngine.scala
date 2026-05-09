package com.helio.domain

import com.helio.infrastructure.{DataSourceRepository, PipelineStepRepository}
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

class InProcessPipelineEngine()(implicit ec: ExecutionContext) extends DefaultJsonProtocol {

  def execute(
      rows: Seq[Map[String, Any]],
      steps: Seq[PipelineStepRepository.PipelineStepRow],
      dataSourceRepo: DataSourceRepository
  ): Future[Seq[Map[String, Any]]] =
    steps.foldLeft(Future.successful(rows)) { (futRows, step) =>
      futRows.flatMap(r => applyStep(r, step, dataSourceRepo))
    }

  def loadRows(ds: DataSource): Future[Seq[Map[String, Any]]] = Future {
    ds.sourceType match {
      case SourceType.Static =>
        val obj      = ds.config.asJsObject
        val columns  = obj.fields("columns").convertTo[Vector[JsObject]]
        val rows     = obj.fields("rows").convertTo[Vector[Vector[JsValue]]]
        val colNames = columns.map(_.fields("name").convertTo[String])
        rows.map { row =>
          colNames.zip(row).map { case (name, jsValue) =>
            name -> jsValueToAny(jsValue)
          }.toMap
        }
      case SourceType.Csv =>
        val filePath = ds.config.asJsObject.fields("filePath").convertTo[String]
        loadCsvRows(filePath)
      case other =>
        throw new IllegalArgumentException(
          "Unsupported source type for in-process pipeline engine: " +
            SourceType.asString(other) + ". Only static and csv are supported."
        )
    }
  }

  private def applyStep(
      rows: Seq[Map[String, Any]],
      step: PipelineStepRepository.PipelineStepRow,
      dataSourceRepo: DataSourceRepository
  ): Future[Seq[Map[String, Any]]] = {
    val cfg = JsonParser(step.config).asJsObject
    step.op match {
      case "rename"  => Future.successful(applyRename(rows, cfg))
      case "filter"  => Future.successful(applyFilter(rows, cfg))
      case "compute" => Future.successful(applyCompute(rows, cfg))
      case "groupby" => Future.successful(applyGroupBy(rows, cfg))
      case "cast"    => Future.successful(applyCast(rows, cfg))
      case "join"    => applyJoin(rows, cfg, dataSourceRepo)
      case "select"  => Future.successful(applySelect(rows, cfg))
      case other     => Future.failed(new IllegalArgumentException("Unknown step op: " + other))
    }
  }

  private def applyRename(rows: Seq[Map[String, Any]], cfg: JsObject): Seq[Map[String, Any]] = {
    val mappings = cfg.fields("mappings").convertTo[Vector[JsObject]]
    val renamePairs = mappings.map { m =>
      m.fields("from").convertTo[String] -> m.fields("to").convertTo[String]
    }
    rows.map { row =>
      renamePairs.foldLeft(row) { case (r, (from, to)) =>
        if (r.contains(from)) (r - from) + (to -> r(from)) else r
      }
    }
  }

  private def applyFilter(rows: Seq[Map[String, Any]], cfg: JsObject): Seq[Map[String, Any]] = {
    val expr = cfg.fields("expression").convertTo[String]
    rows.filter { row =>
      val jsRow = rowToJsMap(row)
      ExpressionEvaluator.evaluate(expr, jsRow) match {
        case Right(JsNumber(n))  => n != 0
        case Right(JsBoolean(b)) => b
        case Right(JsString(s))  => s.nonEmpty
        case _                   => false
      }
    }
  }

  private def applyCompute(rows: Seq[Map[String, Any]], cfg: JsObject): Seq[Map[String, Any]] = {
    val column = cfg.fields("column").convertTo[String]
    val expr   = cfg.fields("expression").convertTo[String]
    rows.map { row =>
      val jsRow = rowToJsMap(row)
      val value = ExpressionEvaluator.evaluate(expr, jsRow) match {
        case Right(v) => jsValueToAny(v)
        case Left(_)  => null
      }
      row + (column -> value)
    }
  }

  private def applyGroupBy(rows: Seq[Map[String, Any]], cfg: JsObject): Seq[Map[String, Any]] = {
    val groupCols = cfg.fields("groupBy").convertTo[Vector[String]]
    val aggCol    = cfg.fields("aggColumn").convertTo[String]
    val aggFn     = cfg.fields("aggFunction").convertTo[String].toLowerCase
    val outputCol = aggFn + "_" + aggCol
    val grouped   = rows.groupBy(row => groupCols.map(c => row.getOrElse(c, null)))
    grouped.map { case (keyValues, groupRows) =>
      val keyMap: Map[String, Any] = groupCols.zip(keyValues).toMap
      val aggValue: Any = aggFn match {
        case "sum" =>
          val nums = groupRows.flatMap(r => toDouble(r.getOrElse(aggCol, null)))
          nums.sum
        case "count" =>
          groupRows.count(r => r.getOrElse(aggCol, null) != null).toLong
        case other =>
          throw new IllegalArgumentException(
            "Unsupported aggregation function: " + other + ". Supported: sum, count"
          )
      }
      keyMap + (outputCol -> aggValue)
    }.toSeq
  }

  private def applySelect(rows: Seq[Map[String, Any]], cfg: JsObject): Seq[Map[String, Any]] = {
    val fields   = cfg.fields("fields").convertTo[Vector[String]]
    val fieldSet = fields.toSet
    rows.map(row => row.view.filterKeys(fieldSet.contains).toMap)
  }

  private def applyCast(rows: Seq[Map[String, Any]], cfg: JsObject): Seq[Map[String, Any]] = {
    val column   = cfg.fields("column").convertTo[String]
    val dataType = cfg.fields("dataType").convertTo[String]
    rows.map { row =>
      val rawValue = row.getOrElse(column, null)
      val casted   = castValue(rawValue, dataType)
      row + (column -> casted)
    }
  }

  private def applyJoin(
      rows: Seq[Map[String, Any]],
      cfg: JsObject,
      dataSourceRepo: DataSourceRepository
  ): Future[Seq[Map[String, Any]]] = {
    val rightDsId = cfg.fields("rightDataSourceId").convertTo[String]
    val joinKey   = cfg.fields("joinKey").convertTo[String]
    val joinType  = cfg.fields.get("joinType").map(_.convertTo[String]).getOrElse("inner")
    dataSourceRepo.findById(DataSourceId(rightDsId)).flatMap {
      case None =>
        Future.failed(
          new IllegalArgumentException("DataSource not found for join: " + rightDsId)
        )
      case Some(rightDs) =>
        loadRows(rightDs).map { rightRows =>
          val rightIndex: Map[Any, Seq[Map[String, Any]]] =
            rightRows.groupBy(_.getOrElse(joinKey, null))
          joinType.toLowerCase match {
            case "inner" =>
              rows.flatMap { leftRow =>
                val key     = leftRow.getOrElse(joinKey, null)
                val matches = rightIndex.getOrElse(key, Seq.empty)
                matches.map(rightRow => leftRow ++ rightRow)
              }
            case "left" =>
              rows.flatMap { leftRow =>
                val key     = leftRow.getOrElse(joinKey, null)
                val matches = rightIndex.getOrElse(key, Seq.empty)
                if (matches.isEmpty) Seq(leftRow)
                else matches.map(rightRow => leftRow ++ rightRow)
              }
            case other =>
              throw new IllegalArgumentException(
                "Unsupported join type: " + other + ". Supported: inner, left"
              )
          }
        }
    }
  }

  private def loadCsvRows(filePath: String): Seq[Map[String, Any]] = {
    val source = scala.io.Source.fromFile(filePath)
    try {
      val lines = source.getLines().toVector
      if (lines.isEmpty) return Seq.empty
      val headers = parseCsvLine(lines.head)
      lines.tail.map { line =>
        val values = parseCsvLine(line)
        val padded = values.padTo(headers.size, "")
        headers.zip(padded).map { case (h, v) => h -> v.asInstanceOf[Any] }.toMap
      }
    } finally {
      source.close()
    }
  }

  private def parseCsvLine(line: String): Vector[String] = {
    val buf     = scala.collection.mutable.ArrayBuffer.empty[String]
    val sb      = new StringBuilder
    var inQuote = false
    var i       = 0
    while (i < line.length) {
      val c = line(i)
      if (inQuote) {
        if (c == '"') {
          if (i + 1 < line.length && line(i + 1) == '"') {
            sb += '"'; i += 2
          } else {
            inQuote = false; i += 1
          }
        } else {
          sb += c; i += 1
        }
      } else {
        if (c == '"') {
          inQuote = true; i += 1
        } else if (c == ',') {
          buf += sb.toString; sb.clear(); i += 1
        } else {
          sb += c; i += 1
        }
      }
    }
    buf += sb.toString
    buf.toVector
  }

  private[domain] def rowToJsMap(row: Map[String, Any]): Map[String, JsValue] =
    row.map { case (k, v) => k -> anyToJsValue(v) }

  private[domain] def anyToJsValue(v: Any): JsValue = v match {
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

  private def jsValueToAny(v: JsValue): Any = v match {
    case JsNull       => null
    case JsBoolean(b) => b
    case JsNumber(n)  => n.toDouble
    case JsString(s)  => s
    case other        => other.compactPrint
  }

  private def toDouble(v: Any): Option[Double] = v match {
    case null           => None
    case i: Int         => Some(i.toDouble)
    case l: Long        => Some(l.toDouble)
    case f: Float       => Some(f.toDouble)
    case d: Double      => Some(d)
    case bd: BigDecimal => Some(bd.toDouble)
    case s: String      => s.toDoubleOption
    case _              => None
  }

  private def castValue(v: Any, dataType: String): Any = {
    if (v == null) return null
    val str = v.toString
    dataType match {
      case "string"  => str
      case "integer" => Try(str.toInt).orElse(Try(str.toDouble.toInt)).getOrElse(null)
      case "long"    => Try(str.toLong).orElse(Try(str.toDouble.toLong)).getOrElse(null)
      case "double"  => Try(str.toDouble).getOrElse(null)
      case "boolean" => Try(str.toBoolean).getOrElse(null)
      case _         => str
    }
  }
}
