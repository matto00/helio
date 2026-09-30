package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.IdParsing.OutputIdSegment
import com.helio.api.protocols.pipelines.ProvenanceResponses
import com.helio.api.routes.ServiceResponse
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.pipelines.ProvenanceService
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route

import scala.concurrent.ExecutionContext

/** HEL-1206: `GET /api/outputs/:id/provenance`. A separate thin shell (not added to `OutputRoutes`,
 *  HEL-1187 is splitting that file); mounted right after `OutputRoutes` in `ApiRoutes`. The ACL is
 *  `OutputRepository.findById`'s sharing-aware select inside `ProvenanceService.forUser` -- an
 *  Output the caller cannot read is `404`, same as `GET /api/outputs/:id`. */
class ProvenanceRoutes(provenanceService: ProvenanceService, user: AuthenticatedUser)(implicit ec: ExecutionContext)
    extends JsonProtocols {

  val routes: Route =
    pathPrefix("outputs" / OutputIdSegment / "provenance") { outputId =>
      pathEndOrSingleSlash {
        get {
          ServiceResponse.run(provenanceService.forUser(outputId, user))(ProvenanceResponses.authenticated)
        }
      }
    }
}
