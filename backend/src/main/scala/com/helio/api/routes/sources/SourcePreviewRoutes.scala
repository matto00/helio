package com.helio.api.routes.sources

import com.helio.api.http.RateLimitDirective
import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directive0, Directives}
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DataSourceIdSegment
import com.helio.domain.model._
import com.helio.services.sources.SourceService
import spray.json._

import scala.concurrent.ExecutionContextExecutor
import scala.util.{Failure, Success, Try}

/** Thin HTTP shell for `/api/sources/infer|test|:id/preview|:id/refresh` for the
 *  REST + SQL surface. All logic in [[SourceService]].
 *
 *  `rateLimitDirective`/`rateLimitPerWindow` (HEL-505 design.md Decision 6, both nullable/`0`-
 *  defaulted so every pre-existing fixture that constructs this class positionally keeps
 *  compiling): the tighter per-user source-fetch limit is applied INSIDE `pathPrefix("sources")`
 *  -- after that prefix has already matched -- never wrapped externally around this whole
 *  `.routes` value. An external wrap would run the rate-limit check (and consume budget) for
 *  EVERY request reaching that point in `ApiRoutes`'s outer `concat`, including ones this class's
 *  own `pathPrefix` ultimately rejects (e.g. `/api/pipelines/...` falling through toward
 *  `PipelineRoutes`), since a Pekko directive runs before the inner route's own match/reject is
 *  known -- caught by this ticket's own route-level test after an external-wrap first attempt
 *  made `analyze` (never intentionally wrapped) start 429ing too. */
final class SourcePreviewRoutes(
    sourceService: SourceService,
    user: AuthenticatedUser,
    rateLimitDirective: RateLimitDirective = null,
    rateLimitPerWindow: Int = 0
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  private def rateLimited: Directive0 =
    if (rateLimitDirective != null) rateLimitDirective.rateLimit(rateLimitPerWindow) else pass

  val routes: Route =
    pathPrefix("sources") {
      rateLimited {
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
                    ServiceResponse.run(sourceService.inferRest(payload, user))(identity)
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
                    ServiceResponse.run(sourceService.testRest(payload, user))(identity)
                  case Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
                }
              }
            }
          }
        },
        path(DataSourceIdSegment / "refresh") { id =>
          post {
            // HEL-904: `refresh` now returns the `DataSource` itself (its `inferredSchema`
            // column carries the re-inferred fields) — there is no companion `DataType`.
            ServiceResponse.run(sourceService.refresh(id, user))(DataSourceResponse.fromDomain)
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
}
