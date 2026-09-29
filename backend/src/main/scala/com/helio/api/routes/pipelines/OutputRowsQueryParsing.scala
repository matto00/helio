package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository
import com.helio.services.pipelines.OutputRowsQuery
import spray.json._

import scala.util.Try

/** HEL-1190 design.md D6 (task 1.1) — `sort`/`filter` query-parameter SHAPE parsing for
 *  `GET /api/outputs/:id/rows`, extracted verbatim out of `OutputRoutes` so
 *  `PublicDashboardRoutes`'s own `.../panels/:panelId/rows` route can share the EXACT same parsing
 *  logic (design.md D6: "the same 'contract and rows endpoint can't drift' guarantee
 *  `OutputService` already relies on") rather than a second, independently-maintained copy.
 *  Everything here is schema-INDEPENDENT — JSON well-formedness, the closed `op` enum, each op's
 *  required field(s), `in`'s 1-100 bound, no duplicate column+op pair. Column-TYPE eligibility and
 *  `eq`/`in` cardinality (which need the Output's own `schema`/data) stay `OutputRowsQuery
 *  .resolveSort`/`resolveFilter`'s job, not this object's — unchanged by this extraction. */
object OutputRowsQueryParsing {

  /** `sort=<column>:<asc|desc>`, split on the LAST `:` (a column name is vanishingly unlikely to
   *  contain one, but this is robust either way). The direction is validated against a closed
   *  2-value set HERE, in Scala, before it can ever reach SQL. */
  def parseSortParam(raw: Option[String]): Either[String, Option[OutputRowsQuery.SortParam]] =
    raw match {
      case None => Right(None)
      case Some(s) =>
        val idx = s.lastIndexOf(':')
        if (idx <= 0 || idx == s.length - 1)
          Left(s"sort must be '<column>:<asc|desc>', got '$s'")
        else
          s.substring(idx + 1) match {
            case "asc"  => Right(Some(OutputRowsQuery.SortParam(s.substring(0, idx), NodeSnapshotRepository.SortDirection.Asc)))
            case "desc" => Right(Some(OutputRowsQuery.SortParam(s.substring(0, idx), NodeSnapshotRepository.SortDirection.Desc)))
            case other  => Left(s"sort direction must be 'asc' or 'desc', got '$other'")
          }
    }

  /** `filter` is URL-encoded JSON matching the client's own `TableColumnFilters` shape
   *  (`{"quick"?: string, "columns"?: {[column]: string}, "ops"?: [{column, op, value?, values?}]}`).
   *  Malformed JSON, or JSON that isn't an object matching this shape, is `400` — never a thrown
   *  `DeserializationException`/`ParsingException` surfacing as a 500. */
  def parseFilterParam(raw: Option[String]): Either[String, Option[OutputRowsQuery.FilterParam]] =
    raw match {
      case None => Right(None)
      case Some(s) =>
        Try(s.parseJson.asJsObject).toOption match {
          case None => Left("filter must be valid JSON matching {quick?: string, columns?: {[key]: string}, ops?: [...]}")
          case Some(obj) =>
            val quick = obj.fields.get("quick").collect { case JsString(v) => v }
            parseColumns(obj).flatMap { columns =>
              parseOps(obj).map { ops =>
                Some(OutputRowsQuery.FilterParam(quick, columns, ops))
              }
            }
        }
    }

  private def parseColumns(obj: JsObject): Either[String, Map[String, String]] =
    obj.fields.get("columns") match {
      case None => Right(Map.empty)
      case Some(JsObject(fields)) if fields.values.forall(_.isInstanceOf[JsString]) =>
        Right(fields.collect { case (k, JsString(v)) => k -> v })
      case Some(_) => Left("filter.columns must be an object of string values")
    }

  private def parseOps(obj: JsObject): Either[String, Vector[OutputRowsQuery.OpsTerm]] =
    obj.fields.get("ops") match {
      case None => Right(Vector.empty)
      case Some(JsArray(items)) =>
        val parsed = items.map(parseOpsTerm)
        parsed.collectFirst { case Left(err) => err } match {
          case Some(err) => Left(err)
          case None =>
            val terms = parsed.collect { case Right(t) => t }
            terms.groupBy(t => (t.column, t.opName)).find(_._2.size > 1).map(_._1) match {
              case Some((col, op)) => Left(s"duplicate filter op '$op' for column '$col'")
              case None             => Right(terms)
            }
        }
      case Some(_) => Left("filter.ops must be an array")
    }

  private def parseOpsTerm(item: JsValue): Either[String, OutputRowsQuery.OpsTerm] =
    Try(item.asJsObject).toOption match {
      case None => Left("filter.ops entries must be objects")
      case Some(o) =>
        val columnOpt = o.fields.get("column").collect { case JsString(v) => v }
        val opOpt     = o.fields.get("op").collect { case JsString(v) => v }
        (columnOpt, opOpt) match {
          case (None, _)    => Left("filter.ops entry missing string 'column'")
          case (_, None)    => Left("filter.ops entry missing string 'op'")
          case (Some(column), Some(op)) =>
            def requireValue(opName: String)(build: (String, String) => OutputRowsQuery.OpsTerm): Either[String, OutputRowsQuery.OpsTerm] =
              o.fields.get("value").collect { case JsString(v) => v } match {
                case Some(v) => Right(build(column, v))
                case None    => Left(s"op '$opName' requires a string 'value' for column '$column'")
              }
            op match {
              case "eq"  => requireValue("eq")(OutputRowsQuery.OpsTerm.Eq(_, _))
              case "gte" => requireValue("gte")(OutputRowsQuery.OpsTerm.Gte(_, _))
              case "lte" => requireValue("lte")(OutputRowsQuery.OpsTerm.Lte(_, _))
              case "in" =>
                o.fields.get("values") match {
                  case Some(JsArray(values)) if values.forall(_.isInstanceOf[JsString]) =>
                    val strs = values.collect { case JsString(v) => v }
                    if (strs.isEmpty) Left(s"op 'in' requires at least one value for column '$column'")
                    else if (strs.size > 100) Left(s"op 'in' supports at most 100 values for column '$column'")
                    else Right(OutputRowsQuery.OpsTerm.In(column, strs))
                  case _ => Left(s"op 'in' requires a 'values' array of strings for column '$column'")
                }
              case other => Left(s"unrecognized filter op '$other' for column '$column'")
            }
        }
    }
}
