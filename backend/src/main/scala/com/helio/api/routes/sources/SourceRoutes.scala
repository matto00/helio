package com.helio.api.routes.sources

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain.model._
import com.helio.services.sources.SourceService
import spray.json._

import scala.concurrent.ExecutionContextExecutor
import scala.util.{Failure, Success, Try}

/** Thin HTTP shell for `/api/sources` create.
 *  Dispatches REST vs SQL based on the JSON payload's `type` discriminator;
 *  all logic in [[SourceService]]. */
final class SourceRoutes(
    sourceService: SourceService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("sources") {
      pathEndOrSingleSlash {
        post {
          entity(as[JsValue]) { json =>
            val typeStr = json.asJsObject.fields.get("type")
              .collect { case JsString(s) => s }
              .getOrElse(DataSourceKind.RestApi)

            if (typeStr == DataSourceKind.Sql) {
              Try(json.convertTo[SqlCreateSourceRequest]) match {
                case Success(request) =>
                  ServiceResponse.run(sourceService.createSql(request, user)) { resp =>
                    StatusCodes.Created -> resp
                  }
                case Failure(e) => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
              }
            } else {
              Try(json.convertTo[CreateSourceRequest]) match {
                case Success(request) if request.config.connectorId.isEmpty && request.config.url.isDefined =>
                  // HEL-828 design.md Decision 1 (revised): bare-`url` create is retired at
                  // THIS wire boundary (POST /api/sources) only — SourceService.createRest
                  // itself is untouched and still synthesizes an implicit Connector for
                  // internal callers (PipelineProposalService's inline-source resolution,
                  // reachable via the MCP propose/apply-pipeline tools, which never touch this
                  // HTTP route). A direct-to-wire bare-url request is rejected here instead.
                  complete(
                    StatusCodes.BadRequest,
                    ErrorResponse(
                      "connectorId is required — a bare url is no longer accepted on POST /api/sources. Create a Connector first (POST /api/connectors), then pass its id as connectorId."
                    )
                  )
                case Success(request) =>
                  ServiceResponse.run(sourceService.createRest(request, user)) { resp =>
                    StatusCodes.Created -> resp
                  }
                case Failure(e) => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
              }
            }
          }
        }
      }
    }
}
