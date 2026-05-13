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
import com.helio.services.DataSourceService

import scala.concurrent.ExecutionContextExecutor
import scala.concurrent.duration.DurationInt

/** Thin HTTP shell for the `/api/data-sources` CRUD surface (CSV + Static).
 *  Multipart unmarshalling happens here; everything else lives in
 *  [[DataSourceService]]. */
final class DataSourceRoutes(
    dataSourceService: DataSourceService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext
  private implicit val mat: Materializer                         = SystemMaterializer(system).materializer

  private val csvMaxBytes: Long =
    sys.env.get("CSV_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(52428800L)

  val routes: Route =
    pathPrefix("data-sources") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              onSuccess(dataSourceService.findAll(user)) { sources =>
                complete(DataSourcesResponse(items = sources.map(DataSourceResponse.fromDomain)))
              }
            },
            post {
              concat(createStaticRoute, createCsvRoute)
            }
          )
        },
        path(DataSourceIdSegment) { sourceId =>
          concat(
            patch {
              entity(as[UpdateDataSourceRequest]) { req =>
                ServiceResponse.run(dataSourceService.update(sourceId, req, user))(DataSourceResponse.fromDomain)
              }
            },
            delete {
              ServiceResponse.runNoContent(dataSourceService.delete(sourceId, user))
            }
          )
        }
      )
    }

  // ── Multipart unmarshalling lives at the route boundary ───────────────────

  private def createStaticRoute: Route =
    entity(as[StaticDataSourceRequest]) { req =>
      ServiceResponse.run(dataSourceService.createStatic(req, user)) { ds =>
        StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
      }
    }

  private def createCsvRoute: Route =
    entity(as[Multipart.FormData]) { formData =>
      val collectedF =
        formData.parts
          .mapAsync(1)(p => p.toStrict(60.seconds).map(s => p.name -> s.entity.data))
          .runWith(Sink.seq)
      onSuccess(collectedF) { parts =>
        val partsMap = parts.toMap
        val nameOpt  = partsMap.get("name").map(_.utf8String.trim).filter(_.nonEmpty)
        val bytesOpt = partsMap.get("file").map(_.toArray)
        (nameOpt, bytesOpt) match {
          case (None, _) =>
            complete(StatusCodes.BadRequest, ErrorResponse("name is required"))
          case (_, None) =>
            complete(StatusCodes.BadRequest, ErrorResponse("file is required"))
          case (Some(name), Some(bytes)) =>
            if (bytes.length.toLong > csvMaxBytes)
              complete(
                StatusCodes.RequestEntityTooLarge,
                ErrorResponse(s"File exceeds the maximum allowed size of $csvMaxBytes bytes")
              )
            else {
              val overrides = partsMap.get("fields")
                .map(data => DataSourceService.parseFieldOverrides(data.utf8String))
                .getOrElse(Vector.empty)
              ServiceResponse.run(dataSourceService.createCsv(name, bytes, overrides, user)) { ds =>
                StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
              }
            }
        }
      }
    }

}
