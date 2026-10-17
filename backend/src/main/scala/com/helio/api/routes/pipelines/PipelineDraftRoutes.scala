package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.IdParsing.PipelineIdSegment
import com.helio.api.protocols.pipelines.DraftSaveRequest
import com.helio.api.routes.ServiceResponse
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.pipelines.draft.DraftSaveService
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route

import scala.concurrent.ExecutionContext

/** `POST /api/pipelines/:id/draft/save` (HEL-1629): the atomic bulk save of a client-side pipeline draft. Thin HTTP shell
 *  over [[DraftSaveService.save]]; the body is the final step tree and Outputs, and a stale base answers 409
 *  `PATCH_SET_STALE` with no overwrite path. */
final class PipelineDraftRoutes(draftSave: DraftSaveService, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    path("pipelines" / PipelineIdSegment / "draft" / "save") { pipelineId =>
      post {
        entity(as[DraftSaveRequest]) { req =>
          ServiceResponse.run(draftSave.save(pipelineId, req, user))(result => StatusCodes.OK -> result)
        }
      }
    }
}
