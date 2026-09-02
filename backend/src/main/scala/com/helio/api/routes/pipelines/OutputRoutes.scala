package com.helio.api.routes.pipelines

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.api.protocols.IdParsing.{OutputIdSegment, PipelineIdSegment}
import com.helio.api.protocols.pipelines.{CreateOutputRequest, OutputsResponse, UpdateOutputRequest}
import com.helio.domain.model.{AuthenticatedUser, Page, PagedResult}
import com.helio.services.pipelines.OutputService
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
              ServiceResponse.run(outputService.listByPipeline(pipelineId, nodeStepId, user)) { outputs =>
                OutputsResponse(outputs.map(outputResponseFrom(_)))
              }
            }
          },
          post {
            entity(as[CreateOutputRequest]) { req =>
              ServiceResponse.run(outputService.create(pipelineId, req, user)) { output =>
                StatusCodes.Created -> outputResponseFrom(output)
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
        // HEL-906 cycle 7: `GET /api/outputs/:id/rows` (P1.4's `get_output_rows` dependency),
        // offset/limit paginated -- mirrors `PublicDashboardRoutes`' own offset/limit param
        // parsing convention (negative offset -> 400 before reaching the service).
        path("rows") {
          get {
            parameters("offset".as[Int].withDefault(Page.Default.offset), "limit".as[Int].withDefault(Page.Default.limit)) { (offsetRaw, limitRaw) =>
              if (offsetRaw < 0)
                complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
              else {
                val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
                ServiceResponse.run(outputService.rows(outputId, page, user))(identity)
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
                  val items = result.items.map(o =>
                    outputResponseFrom(o, JsObject.empty, Some(counts.getOrElse(o.id.value, 0)))
                  )
                  complete(PagedResult(items, result.total, result.offset, result.limit))
                }
              }
            }
          }
        }
      }
    }

  val routes: Route = concat(nestedRoutes, listRoutes, topLevelRoutes)
}
