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

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContextExecutor, Future}
import scala.concurrent.duration.DurationInt
import scala.util.Try

/** CRUD shell for the `/api/data-sources` namespace.
 *  Connector preview / inference / refresh handlers live in `DataSourcePreviewRoutes`. */
final class DataSourceRoutes(
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

  private val acl = aclDirective

  private val csvMaxBytes: Long =
    sys.env.get("CSV_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(52428800L)

  private val staticMaxRows = 500

  val routes: Route =
    pathPrefix("data-sources") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              onSuccess(dataSourceRepo.findAll(user.id)) { sources =>
                complete(DataSourcesResponse(items = sources.map(DataSourceResponse.fromDomain)))
              }
            },
            post {
              concat(createStatic, createCsv)
            }
          )
        },
        path(DataSourceIdSegment) { sourceId =>
          concat(
            patch {
              acl.authorizeResource(sourceId.value, user, "data-source", "Data source not found") {
                entity(as[UpdateDataSourceRequest]) { req =>
                  req.name match {
                    case Some(n) if n.trim.isEmpty =>
                      complete(StatusCodes.BadRequest, ErrorResponse("name must not be empty"))
                    case _ =>
                      onSuccess(dataSourceRepo.findById(sourceId)) {
                        case None =>
                          complete(StatusCodes.NotFound, ErrorResponse("Data source not found"))
                        case Some(source) =>
                          val updated = source.copy(
                            name      = req.name.map(_.trim).getOrElse(source.name),
                            updatedAt = Instant.now()
                          )
                          onSuccess(dataSourceRepo.update(updated)) {
                            case None    => complete(StatusCodes.NotFound, ErrorResponse("Data source not found"))
                            case Some(ds) => complete(DataSourceResponse.fromDomain(ds))
                          }
                      }
                  }
                }
              }
            },
            delete {
              acl.authorizeResource(sourceId.value, user, "data-source", "Data source not found") {
                onSuccess(dataSourceRepo.findById(sourceId)) {
                  case None =>
                    complete(StatusCodes.NotFound, ErrorResponse("Data source not found"))
                  case Some(source) =>
                    val deleteFileF: Future[Unit] =
                      if (source.sourceType == SourceType.Csv)
                        DataSourceCsvSupport.csvPathFromConfig(source.config) match {
                          case Some(path) =>
                            fileSystem.delete(path).recover { case ex =>
                              system.log.warn("Failed to delete CSV file at {}: {}", path, ex.getMessage)
                            }
                          case None => Future.successful(())
                        }
                      else Future.successful(())
                    onSuccess(deleteFileF.flatMap(_ => dataSourceRepo.delete(source.id))) { _ =>
                      complete(StatusCodes.NoContent)
                    }
                }
              }
            }
          )
        }
      )
    }

  // ── POST helpers ──────────────────────────────────────────────────────────

  private def createStatic: Route =
    entity(as[StaticDataSourceRequest]) { req =>
      if (req.name.trim.isEmpty)
        complete(StatusCodes.BadRequest, ErrorResponse("name is required"))
      else if (req.rows.size > staticMaxRows)
        complete(StatusCodes.BadRequest, ErrorResponse(s"Payload exceeds the maximum of $staticMaxRows rows"))
      else {
        val now      = Instant.now()
        val sourceId = DataSourceId(UUID.randomUUID().toString)
        val config   = JsObject("columns" -> req.columns.toJson, "rows" -> req.rows.toJson)
        val source   = DataSource(
          id         = sourceId,
          name       = req.name.trim,
          sourceType = SourceType.Static,
          config     = config,
          createdAt  = now,
          updatedAt  = now,
          ownerId    = user.id
        )
        val insertF = dataSourceRepo.insert(source).flatMap { ds =>
          val dataType = DataType(
            id        = DataTypeId(UUID.randomUUID().toString),
            sourceId  = Some(ds.id),
            name      = req.name.trim,
            fields    = req.columns.map(col => DataField(col.name, col.name, col.`type`, nullable = true)),
            version   = 1,
            createdAt = now,
            updatedAt = now,
            ownerId   = user.id
          )
          dataTypeRepo.insert(dataType).map(_ => ds)
        }
        onSuccess(insertF) { ds =>
          complete(StatusCodes.Created, DataSourceResponse.fromDomain(ds))
        }
      }
    }

  private def createCsv: Route =
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
            else
              DataSourceCsvSupport.decodeUtf8(bytes) match {
                case None             => complete(StatusCodes.BadRequest, ErrorResponse("File must be UTF-8 encoded"))
                case Some(csvContent) => insertCsvSource(name, bytes, csvContent, partsMap)
              }
        }
      }
    }

  private def insertCsvSource(name: String, bytes: Array[Byte], csvContent: String, partsMap: Map[String, org.apache.pekko.util.ByteString]): Route = {
    val overridesMap = partsMap.get("fields")
      .flatMap(data => Try(data.utf8String.parseJson.convertTo[Vector[FieldOverridePayload]]).toOption)
      .getOrElse(Vector.empty)
      .map(o => o.name -> o)
      .toMap
    val schema   = SchemaInferenceEngine.fromCsv(csvContent)
    val now      = Instant.now()
    val sourceId = DataSourceId(UUID.randomUUID().toString)
    val filePath = s"csv/${sourceId.value}.csv"
    val config   = JsObject("path" -> JsString(filePath))
    val source   = DataSource(
      id         = sourceId,
      name       = name,
      sourceType = SourceType.Csv,
      config     = config,
      createdAt  = now,
      updatedAt  = now,
      ownerId    = user.id
    )
    val insertF = fileSystem.write(filePath, bytes).flatMap { _ =>
      dataSourceRepo.insert(source).flatMap { ds =>
        val dataType = DataType(
          id        = DataTypeId(UUID.randomUUID().toString),
          sourceId  = Some(ds.id),
          name      = name,
          fields    = schema.fields.map { f =>
            val ov = overridesMap.get(f.name)
            DataField(
              f.name,
              ov.map(_.displayName).getOrElse(f.displayName),
              ov.map(_.dataType).getOrElse(DataFieldType.asString(f.dataType)),
              f.nullable
            )
          }.toVector,
          version   = 1,
          createdAt = now,
          updatedAt = now,
          ownerId   = user.id
        )
        dataTypeRepo.insert(dataType).map(_ => ds)
      }
    }
    onSuccess(insertF) { ds =>
      complete(StatusCodes.Created, DataSourceResponse.fromDomain(ds))
    }
  }
}
