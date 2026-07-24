package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DataSourceIdSegment
import com.helio.domain._
import com.helio.services.SourceService
import spray.json._

import scala.concurrent.ExecutionContextExecutor
import scala.util.{Failure, Success, Try}

/** Thin HTTP shell for `/api/sources/infer|test|:id/preview|:id/refresh` for the
 *  REST + SQL surface. All logic in [[SourceService]]. */
final class SourcePreviewRoutes(
    sourceService: SourceService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("sources") {
      concat(
        path("infer") {
          post {
            entity(as[JsValue]) { json =>
              val typeStr = json.asJsObject.fields.get("type")
                .collect { case JsString(s) => s }
                .getOrElse(DataSourceKind.RestApi)

              if (typeStr == DataSourceKind.Sql) {
                Try(json.convertTo[SqlInferRequest]) match {
                  case Success(request) =>
                    ServiceResponse.run(sourceService.inferSql(request))(identity)
                  case Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
                }
              } else {
                Try(json.convertTo[RestApiConfigPayload]) match {
                  case Success(payload) =>
                    ServiceResponse.run(sourceService.inferRest(payload))(identity)
                  case Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
                }
              }
            }
          }
        },
        path("test") {
          post {
            entity(as[JsValue]) { json =>
              val typeStr = json.asJsObject.fields.get("type")
                .collect { case JsString(s) => s }
                .getOrElse(DataSourceKind.RestApi)

              if (typeStr == DataSourceKind.Sql) {
                Try(json.convertTo[SqlInferRequest]) match {
                  case Success(request) =>
                    ServiceResponse.run(sourceService.testSql(request))(identity)
                  case Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
                }
              } else {
                Try(json.convertTo[RestApiConfigPayload]) match {
                  case Success(payload) =>
                    ServiceResponse.run(sourceService.testRest(payload))(identity)
                  case Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
                }
              }
            }
          }
        },
        path(DataSourceIdSegment / "refresh") { id =>
          post {
            ServiceResponse.run(sourceService.refresh(id, user))(DataTypeResponse.fromDomain)
          }
        },
        path(DataSourceIdSegment / "preview") { id =>
          get {
            ServiceResponse.run(sourceService.preview(id, user))(identity)
          }
        }
      )
    }
}
