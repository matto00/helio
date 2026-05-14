package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain._
import com.helio.services.SourceService
import spray.json._

import scala.concurrent.ExecutionContextExecutor
import scala.util.{Failure, Success, Try}

/** Thin HTTP shell for `/api/sources` create.
 *  Dispatches REST vs SQL based on the JSON payload's `sourceType` field;
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
