package com.helio.api.routes.pipelines

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain.model._
import com.helio.services.pipelines.PipelineShapeService

/** Thin HTTP shell for `GET /api/pipeline-shapes` (HEL-391) and `POST /api/pipeline-shapes/:id/expand`
 *  (HEL-402). All catalog-projection and expand logic lives in [[PipelineShapeService]]; this class
 *  only wraps requests/responses in wire types (same structure as `ConnectorRoutes`). `pipeline-shapes`
 *  is a DISTINCT top-level prefix — NOT nested under `pathPrefix("pipelines")` — because
 *  `PipelineRoutes`'s unvalidated `path(PipelineIdSegment)` matcher would otherwise swallow a `shapes`
 *  literal segment as a pipeline-id lookup before this route was ever reached (HEL-391 design.md
 *  Decision 6). `user` is unused but kept for signature parity with every other route class in the
 *  authenticated tree — the registry is global, same as `ConnectorRoutes`. */
final class PipelineShapeRoutes(
    pipelineShapeService: PipelineShapeService,
    user: AuthenticatedUser
) extends Directives
    with JsonProtocols {

  val routes: Route =
    pathPrefix("pipeline-shapes") {
      concat(
        pathEndOrSingleSlash {
          get {
            complete(pipelineShapeService.catalog().map(PipelineShapeCatalogEntryResponse.fromDomain))
          }
        },
        path(Segment / "expand") { shapeId =>
          post {
            entity(as[ExpandPipelineShapeRequest]) { req =>
              ServiceResponse.run(pipelineShapeService.expand(shapeId, req.params)) { expansions =>
                expansions.map(ShapeStepExpansionResponse.fromDomain)
              }
            }
          }
        }
      )
    }
}
