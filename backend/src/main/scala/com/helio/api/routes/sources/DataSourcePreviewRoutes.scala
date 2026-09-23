package com.helio.api.routes.sources

import com.helio.api.http.RateLimitDirective
import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.{Multipart, StatusCodes}
import org.apache.pekko.http.scaladsl.server.{Directive0, Directives}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.apache.pekko.stream.scaladsl.Sink
import com.helio.api._
import com.helio.api.protocols.IdParsing.DataSourceIdSegment
import com.helio.domain.model._
import com.helio.services.sources.DataSourceService
import com.helio.services.ServiceError

import scala.concurrent.ExecutionContextExecutor
import scala.concurrent.duration.DurationInt

/** Thin HTTP shell for `/api/data-sources/:id/refresh|preview` and
 *  `/api/data-sources/infer`. All logic lives in [[DataSourceService]].
 *
 *  `rateLimitDirective`/`rateLimitPerWindow` (HEL-505 design.md Decision 6, both nullable/`0`-
 *  defaulted so every pre-existing fixture keeps compiling): mirrors `SourcePreviewRoutes`'s own
 *  doc -- applied INSIDE `pathPrefix("data-sources")`, never wrapped externally, so an unrelated
 *  request (e.g. `/api/pipelines/...`) that merely reaches this point in `ApiRoutes`'s outer
 *  `concat` before falling through is never charged against this budget. */
final class DataSourcePreviewRoutes(
    dataSourceService: DataSourceService,
    user: AuthenticatedUser,
    rateLimitDirective: RateLimitDirective = null,
    rateLimitPerWindow: Int = 0
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext
  private implicit val mat: Materializer                         = SystemMaterializer(system).materializer

  private def rateLimited: Directive0 =
    if (rateLimitDirective != null) rateLimitDirective.rateLimit(rateLimitPerWindow) else pass

  val routes: Route =
    pathPrefix("data-sources") {
      rateLimited {
      concat(
        path(DataSourceIdSegment / "refresh") { sourceId =>
          post {
            // Static refresh accepts a payload body; CSV refresh has no body.
            // Try the static unmarshaller first; on rejection fall through to
            // the bodyless CSV path. The service decides what to do based on
            // the source type and whether a body was provided.
            concat(
              entity(as[StaticDataPayload]) { payload =>
                ServiceResponse.run(dataSourceService.refresh(sourceId, Some(payload), user))(DataSourceResponse.fromDomain)
              },
              ServiceResponse.run(dataSourceService.refresh(sourceId, None, user))(DataSourceResponse.fromDomain)
            )
          }
        },
        path(DataSourceIdSegment / "preview") { sourceId =>
          get {
            parameter("limit".as[Int].optional) { limitOpt =>
              ServiceResponse.run(dataSourceService.preview(sourceId, limitOpt.getOrElse(10), user))(identity)
            }
          }
        },
        path("infer") {
          post {
            entity(as[Multipart.FormData]) { formData =>
              val collectedF =
                formData.parts
                  .mapAsync(1)(p => p.toStrict(60.seconds).map(s => p.name -> s.entity.data))
                  .runWith(Sink.seq)
              onSuccess(collectedF) { parts =>
                val partsMap = parts.toMap
                partsMap.get("file").map(_.toArray) match {
                  case None =>
                    complete(StatusCodes.BadRequest, ErrorResponse("file is required"))
                  case Some(bytes) =>
                    dataSourceService.infer(bytes) match {
                      case Right(resp)                              => complete(resp)
                      case Left(ServiceError.BadRequest(m))         => complete(StatusCodes.BadRequest, ErrorResponse(m))
                      case Left(other)                              => complete(StatusCodes.InternalServerError, ErrorResponse(other.message))
                    }
                }
              }
            }
          }
        }
      )
      }
    }
}
