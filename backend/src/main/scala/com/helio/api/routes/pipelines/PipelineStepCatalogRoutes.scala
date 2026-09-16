package com.helio.api.routes.pipelines

import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain.model._
import com.helio.services.pipelines.PipelineStepCatalogService

/** Thin HTTP shell for `GET /api/pipeline-step-catalog` (HEL-1136). All catalog-projection logic
 *  lives in [[PipelineStepCatalogService]]; this class only wraps the response in wire types
 *  (mirrors `PipelineShapeRoutes`'s structure exactly). `pipeline-step-catalog` is a DISTINCT
 *  top-level prefix — NOT nested under `pathPrefix("pipelines")` — for the same reason
 *  `pipeline-shapes` is top-level (design.md Decision 2 / HEL-391 design.md Decision 6):
 *  `PipelineRoutes`'s unvalidated `path(PipelineIdSegment)` matcher would otherwise swallow a
 *  `pipeline-step-catalog` literal segment as a pipeline-id lookup before this route was ever
 *  reached. `user` is unused but kept for signature parity with every other route class in the
 *  authenticated tree — the registry is global, same as `PipelineShapeRoutes`. */
final class PipelineStepCatalogRoutes(
    pipelineStepCatalogService: PipelineStepCatalogService,
    user: AuthenticatedUser
) extends Directives
    with JsonProtocols {

  val routes: Route =
    pathPrefix("pipeline-step-catalog") {
      pathEndOrSingleSlash {
        get {
          complete(PipelineStepCatalogResponse.fromDomain(pipelineStepCatalogService.catalog()))
        }
      }
    }
}
