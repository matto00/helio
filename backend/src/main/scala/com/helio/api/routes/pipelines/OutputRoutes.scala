package com.helio.api.routes.pipelines

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.api.protocols.IdParsing.{OutputIdSegment, PipelineIdSegment}
import com.helio.api.protocols.pipelines.{CreateOutputRequest, OutputsResponse, UpdateOutputRequest}
import com.helio.domain.model.{AuthenticatedUser, Page, PagedResult}
import com.helio.services.pipelines.{OutputHistoryService, OutputService}
import com.helio.api.protocols.pipelines.OutputHistoryResponses
import spray.json.JsObject

import scala.concurrent.ExecutionContext

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
    user:          AuthenticatedUser,
    // HEL-1273: optional so fixtures without a DbContext (no history repository) simply don't
    // serve `GET /api/outputs/:id/history`.
    historyService: Option[OutputHistoryService] = None
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
        // HEL-1273: history + resolved `config.compare` comparison. `read` authorizes through the
        // sharing-aware `findById`, so a non-grantee and an unknown id both get the same 404.
        path("history") {
          get {
            parameters("limit".optional, "since".optional) { (limitRaw, sinceRaw) =>
              OutputHistoryQueryParsing.parse(limitRaw, sinceRaw) match {
                case Left(err) => complete(StatusCodes.BadRequest, ErrorResponse(err))
                case Right(q) =>
                  historyService.fold(reject: Route) { svc =>
                    ServiceResponse.run(svc.read(outputId, user, q.limit, q.since))(r => OutputHistoryResponses.authenticated(outputId.value, r))
                  }
              }
            }
          }
        },
        // HEL-1276: a stored row payload for one history point. Authenticated only (never mounted on
        // the public routes); the same `findById` ACL as `history`, so a stranger gets the same 404.
        path("history" / JavaUUID / "rows") { pointId =>
          get {
            historyService.fold(reject: Route) { svc =>
              ServiceResponse.run(svc.payloadRows(outputId, pointId, user))(r => OutputHistoryResponses.payload(outputId.value, r))
            }
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
                (OutputRowsQueryParsing.parseSortParam(sortRaw), OutputRowsQueryParsing.parseFilterParam(filterRaw)) match {
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
