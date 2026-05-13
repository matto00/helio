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
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, FileSystem}
import spray.json._

import java.nio.charset.StandardCharsets
import java.time.Instant
import scala.concurrent.{ExecutionContextExecutor, Future}
import scala.concurrent.duration.DurationInt
import scala.util.{Failure, Success}

/** Connector preview / inference / refresh handlers for `/api/data-sources`.
 *  Hosts `POST /:id/refresh`, `GET /:id/preview`, `POST /infer`.
 *  Split out of `DataSourceRoutes` so each file fits the 250-line soft budget. */
final class DataSourcePreviewRoutes(
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    fileSystem: FileSystem,
    aclDirective: AclDirective,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext
  private implicit val mat: Materializer                         = SystemMaterializer(system).materializer

  private val acl           = aclDirective
  private val staticMaxRows = 500

  val routes: Route =
    pathPrefix("data-sources") {
      concat(
        path(DataSourceIdSegment / "refresh") { sourceId =>
          post {
            acl.authorizeResource(sourceId.value, user, "data-source", "Data source not found") {
              onSuccess(dataSourceRepo.findById(sourceId)) {
                case None =>
                  complete(StatusCodes.NotFound, ErrorResponse("Data source not found"))
                case Some(source) =>
                  if (source.sourceType == SourceType.Static)
                    refreshStatic(source)
                  else if (source.sourceType != SourceType.Csv)
                    complete(StatusCodes.BadRequest, ErrorResponse("refresh is only supported for csv and static sources"))
                  else
                    refreshCsv(source)
              }
            }
          }
        },
        path(DataSourceIdSegment / "preview") { sourceId =>
          get {
            parameter("limit".as[Int].optional) { limitOpt =>
              val limit = limitOpt.map(l => math.max(1, math.min(500, l))).getOrElse(10)
              acl.authorizeResource(sourceId.value, user, "data-source", "Data source not found") {
                onSuccess(dataSourceRepo.findById(sourceId)) {
                  case None =>
                    complete(StatusCodes.NotFound, ErrorResponse("Data source not found"))
                  case Some(source) =>
                    if (source.sourceType == SourceType.Static) previewStatic(source)
                    else previewCsv(source, limit)
                }
              }
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
                    DataSourceCsvSupport.decodeUtf8(bytes) match {
                      case None =>
                        complete(StatusCodes.BadRequest, ErrorResponse("File must be UTF-8 encoded"))
                      case Some(csvContent) =>
                        val schema = SchemaInferenceEngine.fromCsv(csvContent)
                        val fields = schema.fields.map(f =>
                          InferredFieldResponse(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
                        ).toVector
                        complete(InferredSchemaResponse(fields))
                    }
                }
              }
            }
          }
        }
      )
    }

  private def refreshStatic(source: DataSource): Route =
    entity(as[StaticDataPayload]) { payload =>
      if (payload.rows.size > staticMaxRows)
        complete(StatusCodes.BadRequest, ErrorResponse(s"Payload exceeds the maximum of $staticMaxRows rows"))
      else {
        val now    = Instant.now()
        val config = JsObject(
          "columns" -> payload.columns.toJson,
          "rows"    -> payload.rows.toJson
        )
        val updatedSource = source.copy(config = config, updatedAt = now)
        val refreshF = dataSourceRepo.update(updatedSource).flatMap {
          case None     => Future.failed(new RuntimeException("Source disappeared during update"))
          case Some(ds) =>
            dataTypeRepo.findBySourceId(source.id, user.id).flatMap { types =>
              types.headOption match {
                case None     => Future.successful(ds)
                case Some(dt) =>
                  val updatedDt = dt.copy(
                    fields    = payload.columns.map(col => DataField(col.name, col.name, col.`type`, nullable = true)),
                    updatedAt = now
                  )
                  dataTypeRepo.update(updatedDt).map(_ => ds)
              }
            }
        }
        onSuccess(refreshF) { ds =>
          complete(DataSourceResponse.fromDomain(ds))
        }
      }
    }

  private def refreshCsv(source: DataSource): Route =
    DataSourceCsvSupport.csvPathFromConfig(source.config) match {
      case None =>
        complete(StatusCodes.InternalServerError, ErrorResponse("Source config is missing path"))
      case Some(path) =>
        val refreshF =
          fileSystem.read(path).flatMap { bytes =>
            val csv    = new String(bytes, StandardCharsets.UTF_8)
            val schema = SchemaInferenceEngine.fromCsv(csv)
            dataTypeRepo.findBySourceId(source.id, user.id).flatMap { types =>
              types.headOption match {
                case None     => Future.successful(source)
                case Some(dt) =>
                  val now     = Instant.now()
                  val updated = dt.copy(
                    fields    = schema.fields.map(f =>
                      DataField(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
                    ).toVector,
                    updatedAt = now
                  )
                  dataTypeRepo.update(updated).map(_ => source)
              }
            }
          }
        onSuccess(refreshF) { ds =>
          complete(DataSourceResponse.fromDomain(ds))
        }
    }

  private def previewStatic(source: DataSource): Route = {
    val fields  = source.config.asJsObject.fields
    val headers = fields.get("columns")
      .map(_.convertTo[Vector[StaticColumnPayload]].map(_.name))
      .getOrElse(Vector.empty)
    val rows = fields.get("rows")
      .map(_.convertTo[Vector[Vector[JsValue]]].map(_.map {
        case JsString(s)  => s
        case JsNumber(n)  => n.toString
        case JsBoolean(b) => b.toString
        case JsNull       => ""
        case other        => other.compactPrint
      }))
      .getOrElse(Vector.empty)
    complete(CsvPreviewResponse(headers, rows))
  }

  private def previewCsv(source: DataSource, limit: Int): Route =
    DataSourceCsvSupport.csvPathFromConfig(source.config) match {
      case None =>
        complete(StatusCodes.InternalServerError, ErrorResponse("Source config is missing path"))
      case Some(path) =>
        onComplete(fileSystem.read(path)) {
          case Success(bytes) =>
            val csv             = new String(bytes, StandardCharsets.UTF_8)
            val (headers, rows) = SchemaInferenceEngine.parseCsvRows(csv, maxRows = limit)
            complete(CsvPreviewResponse(headers, rows))
          case Failure(_: java.nio.file.NoSuchFileException) =>
            complete(StatusCodes.NotFound, ErrorResponse("Data file not found; the source may need to be re-uploaded"))
          case Failure(_) =>
            complete(StatusCodes.InternalServerError, ErrorResponse("Failed to read data file"))
        }
    }
}
