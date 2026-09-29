package com.helio.api.routes.pipelines

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.api.protocols.IdParsing.{OutputIdSegment, PipelineIdSegment}
import com.helio.api.protocols.pipelines.{CreateOutputRequest, OutputsResponse, UpdateOutputRequest}
import com.helio.domain.model.{AuthenticatedUser, Page, PagedResult}
import com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository
import com.helio.services.pipelines.{OutputRowsQuery, OutputService}
import spray.json._

import scala.concurrent.ExecutionContext
import scala.util.Try

/** Thin HTTP shell for `/api/pipelines/:id/outputs` and `/api/outputs/:id`
 *  (HEL-906, P1.3 of the Pipelines & Outputs remodel). All logic in
 *  [[OutputService]]. Mounted ONCE in `ApiRoutes.scala`, as
 *  `concat(nestedRoutes, topLevelRoutes)` (see `routes` below) — the two
 *  path families (`pipelines/:id/outputs` vs. the top-level `outputs`
 *  prefix) don't nest cleanly under one `pathPrefix`, so they're built as
 *  two internal `Route` vals and concatenated once at the single mount
 *  site, not mounted twice. */
class OutputRoutes(
    outputService: OutputService,
    user:          AuthenticatedUser
)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  /** `GET/POST /api/pipelines/:id/outputs` */
  val nestedRoutes: Route =
    pathPrefix("pipelines" / PipelineIdSegment / "outputs") { pipelineId =>
      pathEndOrSingleSlash {
        concat(
          get {
            parameter("nodeStepId".optional) { nodeStepId =>
              ServiceResponse.runWith(outputService.listByPipeline(pipelineId, nodeStepId, user)) { outputs =>
                onSuccess(outputService.configsFor(outputs)) { configs =>
                  complete(OutputsResponse(outputs.map(o => outputResponseFrom(o, configs.getOrElse(o.id.value, JsObject.empty)))))
                }
              }
            }
          },
          post {
            entity(as[CreateOutputRequest]) { req =>
              ServiceResponse.run(outputService.create(pipelineId, req, user)) { case (output, config) =>
                StatusCodes.Created -> outputResponseFrom(output, config)
              }
            }
          }
        )
      }
    }

  /** `GET/PATCH/DELETE /api/outputs/:id` plus `GET /api/outputs/:id/panels` */
  val topLevelRoutes: Route =
    pathPrefix("outputs" / OutputIdSegment) { outputId =>
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              ServiceResponse.run(outputService.findById(outputId, user)) { case (output, config) =>
                outputResponseFrom(output, config)
              }
            },
            patch {
              entity(as[UpdateOutputRequest]) { req =>
                ServiceResponse.run(outputService.update(outputId, req, user)) { case (output, config) =>
                  outputResponseFrom(output, config)
                }
              }
            },
            delete {
              ServiceResponse.run(outputService.delete(outputId, user))(identity)
            }
          )
        },
        path("panels") {
          get {
            ServiceResponse.run(outputService.listPanels(outputId, user))(identity)
          }
        },
        path("assertion-status") {
          get {
            ServiceResponse.run(outputService.assertionStatus(outputId, user))(identity)
          }
        },
        // HEL-1188 design.md D1: same ACL block as `rows`/`panels`/`assertion-status` above
        // (`outputRepo.findById`'s sharing-aware select, via `OutputService.filterCapabilities`).
        path("filter-capabilities") {
          get {
            ServiceResponse.run(outputService.filterCapabilities(outputId, user))(outputFilterCapabilitiesResponseFrom)
          }
        },
        // HEL-1188 design.md D4: `column` is REQUIRED -- there is no "list every column's
        // distinct values" mode, unlike `filter-capabilities`' full-schema sweep. A missing
        // `column` falls through to Pekko's default `MissingQueryParamRejection` handling
        // (`TopLevelErrorHandlers.topLevelRejectionHandler` maps it to this app's `ErrorResponse`
        // JSON envelope at 400, same as every other required-parameter rejection in this app).
        path("distinct-values") {
          get {
            parameter("column") { column =>
              ServiceResponse.run(outputService.distinctValues(outputId, user, column))(values =>
                outputDistinctValuesResponseFrom(column, values)
              )
            }
          }
        },
        // HEL-906 cycle 7: `GET /api/outputs/:id/rows` (P1.4's `get_output_rows` dependency),
        // offset/limit paginated -- mirrors `PublicDashboardRoutes`' own offset/limit param
        // parsing convention (negative offset -> 400 before reaching the service).
        // HEL-1027 design.md D1/D3/task 3.2: `sort`/`filter` SHAPE validation (direction against
        // a closed 2-value set; `filter`'s JSON well-formedness) happens HERE, in Scala, before
        // either reaches `OutputService.rows` -- that service layer separately validates the
        // named COLUMN(s) against the Output's own schema (D2/D3), a check this route cannot make
        // without the Output already in hand.
        path("rows") {
          get {
            parameters(
              "offset".as[Int].withDefault(Page.Default.offset),
              "limit".as[Int].withDefault(Page.Default.limit),
              "sort".optional,
              "filter".optional
            ) { (offsetRaw, limitRaw, sortRaw, filterRaw) =>
              if (offsetRaw < 0)
                complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
              else
                (parseSortParam(sortRaw), parseFilterParam(filterRaw)) match {
                  case (Left(err), _) => complete(StatusCodes.BadRequest, ErrorResponse(err))
                  case (_, Left(err)) => complete(StatusCodes.BadRequest, ErrorResponse(err))
                  case (Right(sortParam), Right(filterParam)) =>
                    val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
                    ServiceResponse.run(outputService.rows(outputId, page, user, sortParam, filterParam))(identity)
                }
            }
          }
        }
      )
    }

  /** HEL-1027 design.md D1/D6 (task 3.2) — `sort=<column>:<asc|desc>`, split on the LAST `:` (a
   *  column name is vanishingly unlikely to contain one, but this is robust either way). The
   *  direction is validated against a closed 2-value set HERE, in Scala, before it can ever reach
   *  SQL — D6 forbids parameterizing `ASC`/`DESC` as a bind value (Postgres doesn't accept a
   *  keyword there), so this Scala-level check is what makes embedding the literal safe later. */
  private def parseSortParam(raw: Option[String]): Either[String, Option[OutputRowsQuery.SortParam]] =
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

  /** HEL-1027 design.md D1 (task 3.2), extended by HEL-1188 design.md D3 — `filter` is
   *  URL-encoded JSON matching the client's own `TableColumnFilters` shape (`{"quick"?: string,
   *  "columns"?: {[column]: string}, "ops"?: [{column, op, value?, values?}]}`); Pekko HTTP's
   *  `parameters` directive already URL-decodes the raw query value before this sees it.
   *  Malformed JSON, or JSON that isn't an object matching this shape, is `400` -- never a thrown
   *  `DeserializationException`/`ParsingException` surfacing as a 500.
   *
   *  Everything validated here is SCHEMA-INDEPENDENT (mirrors `parseSortParam`'s own direction-enum
   *  check above): JSON well-formedness, the `op` enum (`eq`/`in`/`gte`/`lte`), each op's required
   *  field(s) present with the right shape, `in`'s 1-100 value-count bound, and no duplicate
   *  column+op pair. Column-TYPE eligibility and `eq`/`in` cardinality (both of which need the
   *  Output's own `schema`/data) are `OutputRowsQuery.resolveFilter`'s job, not this route's. */
  private def parseFilterParam(raw: Option[String]): Either[String, Option[OutputRowsQuery.FilterParam]] =
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

  /** `GET /api/outputs` (HEL-906 cycle 7, task 2.6, absorbs HEL-722) -- lean paginated list of
   *  every Output the caller OWNS. Mounted alongside `topLevelRoutes`' `outputs/:id` branch --
   *  matched FIRST (`pathEndOrSingleSlash` on the bare `outputs` prefix, before
   *  `OutputIdSegment` gets a chance to swallow it), same ordering discipline `PipelineRoutes`
   *  uses for its own `analyze-proposal` vs. `PipelineIdSegment` literal-segment conflict. */
  val listRoutes: Route =
    path("outputs") {
      pathEndOrSingleSlash {
        get {
          parameters("offset".as[Int].withDefault(Page.Default.offset), "limit".as[Int].withDefault(Page.Default.limit)) { (offsetRaw, limitRaw) =>
            if (offsetRaw < 0)
              complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
            else {
              val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
              onSuccess(outputService.listAll(user, page)) { result =>
                onSuccess(outputService.panelCountsFor(result.items)) { counts =>
                  onSuccess(outputService.configsFor(result.items)) { configs =>
                    val items = result.items.map(o =>
                      outputResponseFrom(o, configs.getOrElse(o.id.value, JsObject.empty), Some(counts.getOrElse(o.id.value, 0)))
                    )
                    complete(PagedResult(items, result.total, result.offset, result.limit))
                  }
                }
              }
            }
          }
        }
      }
    }

  val routes: Route = concat(nestedRoutes, listRoutes, topLevelRoutes)
}
