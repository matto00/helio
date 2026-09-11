package com.helio.api.routes.sources

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.{Multipart, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.apache.pekko.stream.scaladsl.Sink
import com.helio.api._
import com.helio.api.protocols.IdParsing.DataSourceIdSegment
import com.helio.api.protocols.sources.{DatasetSchemaResponse, DatasetSchemaUpdateResponse, RowListResponse, RowPatchRequest, RowResponse, RowWriteRequest, RowWriteResponse, SchemaUpdateConflictResponse, UpdateDatasetSchemaRequest}
import com.helio.domain.model._
import com.helio.services.sources.{CsvUrlFetch, DataSourceDeleteError, DataSourceSchemaUpdateError, DataSourceService}
import spray.json._

import scala.concurrent.{ExecutionContextExecutor, Future}
import scala.concurrent.duration.DurationInt
import scala.util.{Failure, Success, Try}

/** Thin HTTP shell for the `/api/data-sources` CRUD surface (CSV + Static +
 *  Text + Pdf + Image). Multipart unmarshalling happens here; everything else
 *  lives in [[DataSourceService]]. */
final class DataSourceRoutes(
    dataSourceService: DataSourceService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext
  private implicit val mat: Materializer                         = SystemMaterializer(system).materializer

  // HEL-862 design.md Decision 7: read the same value CsvUrlFetch.fetch enforces on every
  // URL path, so the multipart route check and the URL paths cannot silently diverge.
  private val csvMaxBytes: Long = CsvUrlFetch.maxFileSizeBytes

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

  /** Early route-layer rejection for image uploads, mirroring the text
   *  branch above. The service-layer check in `DataSourceService.ingestImage`
   *  (via `ServiceError.PayloadTooLarge`) is the one guaranteed path for both
   *  upload and URL ingestion. */
  private val imageMaxBytes: Long =
    sys.env.get("IMAGE_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(20971520L)

  /** HEL-987 design.md Decision 3: bespoke completion for `DataSourceService.delete`'s
   *  `Either[DataSourceDeleteError, Unit]`, mirroring `DashboardAuthoringRoutes.
   *  completeAuthoring` exactly -- `conflict = Some(c)` renders the structured 409 body,
   *  `conflict = None` renders the pre-existing bare `ErrorResponse(err.message)` unchanged
   *  (so 404/403 on this route keep today's shape). BOTH branches call
   *  `ServiceResponse.statusCodeFor(err)` -- the status-code switch is never duplicated. */
  private def completeDelete(result: Future[Either[DataSourceDeleteError, Unit]]): Route =
    onSuccess(result) {
      case Right(_) => complete(StatusCodes.NoContent)
      case Left(DataSourceDeleteError(Some(c), err)) =>
        complete(
          ServiceResponse.statusCodeFor(err),
          DataSourceDeleteConflictResponse(c.resourceKind, c.resourceId, c.resourceName, c.reason, c.reason)
        )
      case Left(DataSourceDeleteError(None, err)) =>
        complete(ServiceResponse.statusCodeFor(err), ErrorResponse(err.message))
    }

  /** HEL-1124 design.md Decision 6: same bespoke-completion shape as `completeDelete` above --
   *  `conflict = Some(c)` renders the structured `409` body, `conflict = None` renders the
   *  pre-existing bare `ErrorResponse(err.message)` (so `404`/`400` on this route keep the
   *  standard shape). */
  private def completeSchemaUpdate(result: Future[Either[DataSourceSchemaUpdateError, DatasetSchemaUpdateResponse]]): Route =
    onSuccess(result) {
      case Right(resp) => complete(resp)
      case Left(DataSourceSchemaUpdateError(Some(c), err)) =>
        complete(ServiceResponse.statusCodeFor(err), c)
      case Left(DataSourceSchemaUpdateError(None, err)) =>
        complete(ServiceResponse.statusCodeFor(err), ErrorResponse(err.message))
    }

  val routes: Route =
    pathPrefix("data-sources") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              parameters(
                "offset".as[Int].withDefault(Page.Default.offset),
                "limit".as[Int].withDefault(Page.Default.limit),
                "tag".optional
              ) { (offsetRaw, limitRaw, tag) =>
                if (offsetRaw < 0)
                  complete(StatusCodes.BadRequest, ErrorResponse("offset must not be negative"))
                else {
                  val page = Page(offset = offsetRaw, limit = math.min(limitRaw, Page.MaxLimit))
                  onSuccess(dataSourceService.findAll(user, page, tag)) { result =>
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
              completeDelete(dataSourceService.delete(sourceId, user))
            }
          )
        },
        // HEL-1122 design.md Decision 1: additive, read-only declared-schema route -- same
        // rate-limit/auth composition as every other route in this pathPrefix, no new wiring.
        path(DataSourceIdSegment / "schema") { sourceId =>
          concat(
            get {
              ServiceResponse.run(dataSourceService.getDatasetSchema(sourceId, user))(identity)
            },
            // HEL-1124 design.md Decision 1/6: full-replacement declared-schema write, alongside
            // HEL-1122's read-only `GET` above -- same ACL/rate-limit composition, no new wiring.
            patch {
              entity(as[UpdateDatasetSchemaRequest]) { req =>
                completeSchemaUpdate(dataSourceService.updateDatasetSchema(sourceId, req, user))
              }
            }
          )
        },
        // HEL-1077: append/replace routes for a `dataset`-kind source's rows. Rate-limit + auth
        // are inherited from `ApiRoutes`'s composition of `DataSourceRoutes.routes` (design.md
        // Context, verified at `ApiRoutes.scala:792`) -- no new wiring needed here.
        path(DataSourceIdSegment / "rows") { sourceId =>
          concat(
            // HEL-1121: paged row listing, RLS-scoped (design.md D1/D6) -- `cursor`/`limit` are
            // parsed as raw strings here (not `.as[Long]`/`.as[Int]`) so a malformed value is
            // routed through `DataSourceService.listRows`'s own 400 handling (D6 step 1) rather
            // than Pekko's default query-param-unmarshal rejection, matching this route family's
            // existing convention (see the sibling DELETE route's `updatedAt` comment below).
            get {
              parameters("cursor".optional, "limit".optional) { (cursor, limit) =>
                ServiceResponse.run(dataSourceService.listRows(sourceId, cursor, limit, user))(RowListResponse.fromDomain)
              }
            },
            post {
              entity(as[RowWriteRequest]) { req =>
                ServiceResponse.run(dataSourceService.appendRows(sourceId, req.rows, user))(RowWriteResponse.fromDomain)
              }
            },
            put {
              entity(as[RowWriteRequest]) { req =>
                ServiceResponse.run(dataSourceService.replaceRows(sourceId, req.rows, user))(RowWriteResponse.fromDomain)
              }
            }
          )
        },
        // HEL-1078: per-row edit/delete, guarded by an `updatedAt` precondition (design.md D3:
        // DELETE's precondition is a query parameter, not a body). Same rate-limit/auth
        // composition as the sibling `rows` path above -- no new wiring needed.
        path(DataSourceIdSegment / "rows" / Segment) { (sourceId, rowId) =>
          concat(
            patch {
              entity(as[RowPatchRequest]) { req =>
                ServiceResponse.run(dataSourceService.patchRow(sourceId, rowId, req.updatedAt, req.data, user))(RowResponse.fromDomain)
              }
            },
            delete {
              // HEL-1078 design.md D3: a missing `updatedAt` query parameter is a `400`, never
              // Pekko's own default `MissingQueryParamRejection` handling -- which (surprisingly)
              // completes with `404 Not Found`, not `400` (verified live against this exact
              // route). `.optional` sidesteps that default entirely: `None` completes `400`
              // directly, matching every other malformed-input case on this route family.
              parameter("updatedAt".optional) {
                case None =>
                  complete(StatusCodes.BadRequest, ErrorResponse("updatedAt query parameter is required"))
                case Some(updatedAt) =>
                  ServiceResponse.runNoContent(dataSourceService.deleteRow(sourceId, rowId, updatedAt, user))
              }
            }
          )
        }
      )
    }


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

      if (typeStr.contains(DataSourceKind.Csv)) {
        Try(json.convertTo[CsvSourceUrlRequest]) match {
          case Success(request) =>
            ServiceResponse.run(dataSourceService.createCsvUrl(request.name, request.config.url, user, request.tag)) { ds =>
              StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
            }
          case Failure(e) => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
        }
      } else if (typeStr.contains(DataSourceKind.Text)) {
        Try(json.convertTo[TextSourceUrlRequest]) match {
          case Success(request) =>
            ServiceResponse.run(dataSourceService.createTextUrl(request.name, request.config.url, user, request.tag)) { ds =>
              StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
            }
          case Failure(e) => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
        }
      } else if (typeStr.contains(DataSourceKind.Pdf)) {
        Try(json.convertTo[PdfSourceUrlRequest]) match {
          case Success(request) =>
            ServiceResponse.run(dataSourceService.createPdfUrl(request.name, request.config.url, user, request.tag)) { ds =>
              StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
            }
          case Failure(e) => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
        }
      } else if (typeStr.contains(DataSourceKind.Image)) {
        Try(json.convertTo[ImageSourceUrlRequest]) match {
          case Success(request) =>
            ServiceResponse.run(dataSourceService.createImageUrl(request.name, request.config.url, user, request.tag)) { ds =>
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
        // HEL-366: optional `tag` multipart part, mirroring `name`/`type`.
        val tag          = partsMap.get("tag").map(_.utf8String.trim).filter(_.nonEmpty)

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
              ServiceResponse.run(dataSourceService.createTextUpload(name, bytes, filename, user, tag)) { ds =>
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
              ServiceResponse.run(dataSourceService.createPdfUpload(name, bytes, filename, user, tag)) { ds =>
                StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
              }
          case (Some(name), Some(bytes)) if typeStr == DataSourceKind.Image =>
            // Image uploads determine the extension from the file part's own
            // Content-Disposition filename, same as the text branch above.
            val filename = filePartName.getOrElse("")
            if (bytes.length.toLong > imageMaxBytes)
              complete(
                StatusCodes.RequestEntityTooLarge,
                ErrorResponse(s"File exceeds the maximum allowed size of $imageMaxBytes bytes")
              )
            else
              ServiceResponse.run(dataSourceService.createImageUpload(name, bytes, filename, user, tag)) { ds =>
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
              ServiceResponse.run(dataSourceService.createCsv(name, bytes, overrides, user, tag)) { ds =>
                StatusCodes.Created -> DataSourceResponse.fromDomain(ds)
              }
            }
        }
      }
    }

}
