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
import spray.json._

import scala.concurrent.ExecutionContextExecutor
import scala.concurrent.duration.DurationInt
import scala.util.{Failure, Success, Try}

/** Thin HTTP shell for the `/api/data-sources` CRUD surface (CSV + Static +
 *  Text + Pdf). Multipart unmarshalling happens here; everything else lives in
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

  /** Early route-layer rejection, mirroring CSV's `csvMaxBytes` check. The
   *  service-layer check in `DataSourceService.ingestText` (via
   *  `ServiceError.PayloadTooLarge`) is the one guaranteed path for both
   *  upload and URL ingestion — see design.md's PayloadTooLarge decision. */
  private val textMaxBytes: Long =
    sys.env.get("TEXT_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(10485760L)

  /** Early route-layer rejection for PDF uploads (HEL-214), mirroring
   *  `textMaxBytes` above. */
  private val pdfMaxBytes: Long =
    sys.env.get("PDF_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(20971520L)

  val routes: Route =
    pathPrefix("data-sources") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              parameters("offset".as[Int].withDefault(Page.Default.offset), "limit".as[Int].withDefault(Page.Default.limit)) { (offsetRaw, limitRaw) =>
                if (offsetRaw < 0)
                  complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
                else {
                  val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
                  onSuccess(dataSourceService.findAll(user, page)) { result =>
                    complete(PagedResult(result.items.map(DataSourceResponse.fromDomain), result.total, result.offset, result.limit))
                  }
                }
              }
            },
            post {
              concat(createStaticRoute, createMultipartUploadRoute)
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

  /** JSON create dispatch: a single `entity(as[JsValue])` route that inspects
   *  the `type` discriminator once and branches to `StaticDataSourceRequest`
   *  or `TextSourceUrlRequest` — mirrors `SourceRoutes.scala`'s REST/SQL
   *  dispatch. Two sibling `entity(as[X])` JSON routes can't safely
   *  re-unmarshal the same request if the first one's unmarshal fails, so
   *  Static and Text-via-URL creation share this one entry point instead of
   *  being separate directives in the `concat` chain. */
  private def createStaticRoute: Route =
    entity(as[JsValue]) { json =>
      val typeStr = json.asJsObject.fields.get("type").collect { case JsString(s) => s }

      if (typeStr.contains(DataSourceKind.Text)) {
        Try(json.convertTo[TextSourceUrlRequest]) match {
          case Success(request) =>
            ServiceResponse.run(dataSourceService.createTextUrl(request.name, request.config.url, user)) { ds =>
              StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
            }
          case Failure(e) => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
        }
      } else if (typeStr.contains(DataSourceKind.Pdf)) {
        Try(json.convertTo[PdfSourceUrlRequest]) match {
          case Success(request) =>
            ServiceResponse.run(dataSourceService.createPdfUrl(request.name, request.config.url, user)) { ds =>
              StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
            }
          case Failure(e) => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
        }
      } else {
        Try(json.convertTo[StaticDataSourceRequest]) match {
          case Success(req) =>
            ServiceResponse.run(dataSourceService.createStatic(req, user)) { ds =>
              StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
            }
          case Failure(e) => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
        }
      }
    }

  /** Multipart create dispatch: a single route that collects all parts once
   *  (`Sink.seq`, as before) and branches internally on an optional `type`
   *  part (default `"csv"` — backward compatible with pre-HEL-215
   *  CSV-only uploaders). A live HTTP request's multipart entity can only be
   *  materialized once, so this must stay one route rather than two sibling
   *  `entity(as[Multipart.FormData])` directives. */
  private def createMultipartUploadRoute: Route =
    entity(as[Multipart.FormData]) { formData =>
      val collectedF =
        formData.parts
          .mapAsync(1)(p => p.toStrict(60.seconds).map(s => (p.name, s.entity.data, p.filename)))
          .runWith(Sink.seq)
      onSuccess(collectedF) { parts =>
        val partsMap     = parts.map { case (name, data, _) => name -> data }.toMap
        val filePartName = parts.collectFirst { case ("file", _, filenameOpt) => filenameOpt }.flatten
        val typeStr      = partsMap.get("type").map(_.utf8String.trim).filter(_.nonEmpty).getOrElse(DataSourceKind.Csv)
        val nameOpt      = partsMap.get("name").map(_.utf8String.trim).filter(_.nonEmpty)
        val bytesOpt     = partsMap.get("file").map(_.toArray)

        (nameOpt, bytesOpt) match {
          case (None, _) =>
            complete(StatusCodes.BadRequest, ErrorResponse("name is required"))
          case (_, None) =>
            complete(StatusCodes.BadRequest, ErrorResponse("file is required"))
          case (Some(name), Some(bytes)) if typeStr == DataSourceKind.Text =>
            // Text uploads determine the extension from the file part's own
            // Content-Disposition filename (as a real browser file input
            // sends it) — no separate "filename" form part needed.
            val filename = filePartName.getOrElse("")
            if (bytes.length.toLong > textMaxBytes)
              complete(
                StatusCodes.RequestEntityTooLarge,
                ErrorResponse(s"File exceeds the maximum allowed size of $textMaxBytes bytes")
              )
            else
              ServiceResponse.run(dataSourceService.createTextUpload(name, bytes, filename, user)) { ds =>
                StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
              }
          case (Some(name), Some(bytes)) if typeStr == DataSourceKind.Pdf =>
            // PDF uploads determine the extension from the file part's own
            // Content-Disposition filename, same as text uploads above.
            val filename = filePartName.getOrElse("")
            if (bytes.length.toLong > pdfMaxBytes)
              complete(
                StatusCodes.RequestEntityTooLarge,
                ErrorResponse(s"File exceeds the maximum allowed size of $pdfMaxBytes bytes")
              )
            else
              ServiceResponse.run(dataSourceService.createPdfUpload(name, bytes, filename, user)) { ds =>
                StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
              }
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
