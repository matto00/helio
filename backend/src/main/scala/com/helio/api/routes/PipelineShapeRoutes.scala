package com.helio.api.routes

import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain._
import com.helio.services.PipelineShapeService

/** Thin HTTP shell for `GET /api/pipeline-shapes` (HEL-391). All catalog-projection logic lives in
 *  [[PipelineShapeService]]; this class only wraps the response in the wire type (same structure as
 *  `ConnectorRoutes`). `pipeline-shapes` is a DISTINCT top-level prefix — NOT nested under
 *  `pathPrefix("pipelines")` — because `PipelineRoutes`'s unvalidated `path(PipelineIdSegment)`
 *  matcher would otherwise swallow a `shapes` literal segment as a pipeline-id lookup before this
 *  route was ever reached (HEL-391 design.md Decision 6). `user` is unused but kept for signature
 *  parity with every other route class in the authenticated tree — the registry is global, same as
 *  `ConnectorRoutes`. */
final class PipelineShapeRoutes(
    pipelineShapeService: PipelineShapeService,
    user: AuthenticatedUser
) extends Directives
    with JsonProtocols {

  val routes: Route =
    pathPrefix("pipeline-shapes") {
      pathEndOrSingleSlash {
        get {
          complete(pipelineShapeService.catalog().map(PipelineShapeCatalogEntryResponse.fromDomain))
        }
      }
    }
}
