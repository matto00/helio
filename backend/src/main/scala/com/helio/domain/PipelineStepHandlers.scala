package com.helio.domain

import com.helio.infrastructure.DataSourceRepository
import com.helio.infrastructure.DataSourceRepository.parseStaticPayload
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Pure per-kind handler functions for the in-process pipeline engine.
 *
 *  Each handler is typed: it takes the row sequence and the subtype's
 *  `*Config` directly — no `JsObject` crosses these boundaries (the engine
 *  used to parse `step.config` into a `JsObject` before dispatching). All
 *  behavior is preserved 1:1 from the pre-CS2c-3a implementation; the only
 *  change is that the parsing step moves to the repository layer via
 *  [[com.helio.api.protocols.PipelineStepConfigCodec]].
 *
 *  Lives in `domain` because the handlers are pure functions over typed
 *  configs — no infrastructure (apart from `DataSourceRepository` for the
 *  join handler, which already lives at the engine boundary). */
object PipelineStepHandlers extends DefaultJsonProtocol {

  type Row = Map[String, Any]

  def applyRename(rows: Seq[Row], cfg: RenameConfig): Seq[Row] = {
    val renames = cfg.renames
    rows.map { row =>
      renames.foldLeft(row) { case (r, (from, to)) =>
        if (r.contains(from)) (r - from) + (to -> r(from)) else r
      }
    }
  }

  /** Filter — applies AND/OR combinator over typed conditions.
   *  Operators: `=` `!=` `>` `>=` `<` `<=` `contains` `is null` `is not null`.
   *  Numeric coercion failure → no-match (row excluded). */
  def applyFilter(rows: Seq[Row], cfg: FilterConfig): Seq[Row] = {
    val conditions = cfg.conditions
    if (conditions.isEmpty) return rows
    val combinator = cfg.combinator

    rows.filter { row =>
      val results = conditions.flatMap { cond =>
        val field = cond.field
        if (field.isEmpty) None
        else {
          val operator = cond.operator
          val value    = cond.value
          val fieldVal = row.getOrElse(field, null)
          Some(evalCondition(fieldVal, operator, value))
        }
      }
      if (results.isEmpty) true
      else combinator.toUpperCase match {
        case "OR" => results.exists(identity)
        case _    => results.forall(identity)
      }
    }
  }

  private def evalCondition(fieldVal: Any, operator: String, value: Option[String]): Boolean =
    operator match {
      case "is null"     => fieldVal == null
      case "is not null" => fieldVal != null
      case "contains"    => fieldVal != null && fieldVal.toString.contains(value.getOrElse(""))
      case "=" | "!="   =>
        val fieldStr = if (fieldVal == null) null else fieldVal.toString
        val valStr   = value.getOrElse("")
        if (operator == "=") fieldStr == valStr else fieldStr != valStr
      case ">" | ">=" | "<" | "<=" =>
        val fieldNum = Option(fieldVal).flatMap(v => Try(v.toString.toDouble).toOption)
        val valNum   = Try(value.getOrElse("").toDouble).toOption
        (fieldNum, valNum) match {
          case (Some(f), Some(v)) =>
            operator match {
              case ">"  => f > v
              case ">=" => f >= v
              case "<"  => f < v
              case "<=" => f <= v
              case _    => false
            }
          case _ => false
        }
      case _ => false
    }

  def applyCompute(rows: Seq[Row], cfg: ComputeConfig): Seq[Row] = {
    val column = cfg.column
    val expr   = cfg.expression
    rows.map { row =>
      val jsRow = rowToJsMap(row)
      val value = ExpressionEvaluator.evaluate(expr, jsRow) match {
        case Right(v) => jsValueToAny(v)
        case Left(_)  => null
      }
      row + (column -> value)
    }
  }

  def applyGroupBy(rows: Seq[Row], cfg: GroupByConfig): Seq[Row] = {
    val groupCols = cfg.groupBy
    val aggCol    = cfg.aggColumn
    val aggFn     = cfg.aggFunction.toLowerCase
    val outputCol = aggFn + "_" + aggCol
    val grouped   = rows.groupBy(row => groupCols.map(c => row.getOrElse(c, null)))
    grouped.map { case (keyValues, groupRows) =>
      val keyMap: Row = groupCols.zip(keyValues).toMap
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

  def applyAggregate(rows: Seq[Row], cfg: AggregateConfig): Seq[Row] = {
    val groupByFields = cfg.groupBy.map(_.name)
    val aggregations  = cfg.aggregations

    val grouped: Map[Seq[Any], Seq[Row]] =
      rows.groupBy(row => groupByFields.map(name => row.getOrElse(name, null)))

    grouped.map { case (keyValues, groupRows) =>
      val keyMap: Row = groupByFields.zip(keyValues).toMap
      val aggMap: Row = aggregations.map { agg =>
        val alias = agg.alias
        val fn    = agg.fn.toLowerCase
        val field = agg.field
        val nums  = groupRows.flatMap(r => toDouble(r.getOrElse(field, null)))
        val value: Any = fn match {
          case "sum"   => nums.sum
          case "avg"   => if (nums.isEmpty) null else nums.sum / nums.size
          case "min"   => if (nums.isEmpty) null else nums.min
          case "max"   => if (nums.isEmpty) null else nums.max
          case "count" => groupRows.count(r => r.getOrElse(field, null) != null).toLong
          case other =>
            throw new IllegalArgumentException(
              "Unsupported aggregation function: " + other +
                ". Supported: sum, avg, min, max, count"
            )
        }
        alias -> value
      }.toMap
      keyMap ++ aggMap
    }.toSeq
  }

  def applyLimit(rows: Seq[Row], cfg: LimitConfig): Seq[Row] = {
    val count = cfg.count
    if (count <= 0) rows else rows.take(count)
  }

  def applySort(rows: Seq[Row], cfg: SortConfig): Seq[Row] = {
    val sortBy = cfg.sortBy
    if (sortBy.isEmpty) return rows
    sortBy.foldRight(rows) { case (keySpec, currentRows) =>
      val field     = keySpec.field
      val direction = keySpec.direction
      val desc      = direction.equalsIgnoreCase("desc")
      if (field.isEmpty) currentRows
      else
        currentRows.sortWith { (a, b) =>
          val av = Option(a.getOrElse(field, null))
          val bv = Option(b.getOrElse(field, null))
          (av, bv) match {
            case (None, _) => false
            case (_, None) => true
            case (Some(x), Some(y)) =>
              val xn = toDouble(x)
              val yn = toDouble(y)
              (xn, yn) match {
                case (Some(xd), Some(yd)) => if (desc) xd > yd else xd < yd
                case _                    =>
                  val xs = x.toString
                  val ys = y.toString
                  if (desc) xs > ys else xs < ys
              }
          }
        }
    }
  }

  def applySelect(rows: Seq[Row], cfg: SelectConfig): Seq[Row] = {
    val fieldSet = cfg.fields.toSet
    rows.map(row => row.view.filterKeys(fieldSet.contains).toMap)
  }

  def applyCast(rows: Seq[Row], cfg: CastConfig): Seq[Row] = {
    val casts = cfg.casts
    rows.map { row =>
      casts.foldLeft(row) { case (r, (field, targetType)) =>
        val rawValue = r.getOrElse(field, null)
        r + (field -> castValue(rawValue, targetType))
      }
    }
  }

  def applyJoin(
      rows: Seq[Row],
      cfg: JoinConfig,
      dataSourceRepo: DataSourceRepository,
      loadRightSource: DataSource => Future[Seq[Row]]
  )(implicit ec: ExecutionContext): Future[Seq[Row]] = {
    val rightDsId = cfg.rightDataSourceId
    val joinKey   = cfg.joinKey
    val joinType  = cfg.joinType
    dataSourceRepo.findById(DataSourceId(rightDsId)).flatMap {
      case None =>
        Future.failed(
          new IllegalArgumentException("DataSource not found for join: " + rightDsId)
        )
      case Some(rightDs) =>
        loadRightSource(rightDs).map { rightRows =>
          val rightIndex: Map[Any, Seq[Row]] = rightRows.groupBy(_.getOrElse(joinKey, null))
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

  // ── Static-source row loader (kept here so the engine stays a one-line
  //    dispatcher; relies only on the typed config + repo). ────────────────

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

  // ── Value helpers (shared across handlers + loadRows) ────────────────────

  def rowToJsMap(row: Row): Map[String, JsValue] =
    row.map { case (k, v) => k -> anyToJsValue(v) }

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

  def jsValueToAny(v: JsValue): Any = v match {
    case JsNull       => null
    case JsBoolean(b) => b
    case JsNumber(n)  => n.toDouble
    case JsString(s)  => s
    case other        => other.compactPrint
  }

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

  private def castValue(v: Any, dataType: String): Any = {
    if (v == null) return null
    val str = v.toString
    dataType match {
      case "string"  => str
      case "integer" => Try(str.toInt).orElse(Try(str.toDouble.toInt)).getOrElse(null)
      case "long"    => Try(str.toLong).orElse(Try(str.toDouble.toLong)).getOrElse(null)
      case "double"  => Try(str.toDouble).getOrElse(null)
      case "boolean" => Try(str.toBoolean).getOrElse(null)
      case "date"    => str
      case _         => str
    }
  }
}
