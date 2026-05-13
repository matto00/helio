package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.{Multipart, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.apache.pekko.stream.scaladsl.Sink
import com.helio.api._
import com.helio.api.protocols.IdParsing.DataSourceIdSegment
import com.helio.domain._
import com.helio.services.{DataSourceService, ServiceError}

import scala.concurrent.ExecutionContextExecutor
import scala.concurrent.duration.DurationInt

/** Thin HTTP shell for `/api/data-sources/:id/refresh|preview` and
 *  `/api/data-sources/infer`. All logic lives in [[DataSourceService]]. */
final class DataSourcePreviewRoutes(
    dataSourceService: DataSourceService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext
  private implicit val mat: Materializer                         = SystemMaterializer(system).materializer

  val routes: Route =
    pathPrefix("data-sources") {
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
