package com.helio.api.routes

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.{Multipart, StatusCodes}
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import akka.stream.{Materializer, SystemMaterializer}
import akka.stream.scaladsl.Sink
import com.helio.api._
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, FileSystem}
import spray.json._

import java.nio.ByteBuffer
import java.nio.charset.{CodingErrorAction, StandardCharsets}
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContextExecutor, Future}
import scala.concurrent.duration.DurationInt
import scala.util.Try

final class DataSourceRoutes(
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    fileSystem: FileSystem
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
              onSuccess(dataSourceRepo.findAll()) { sources =>
                complete(DataSourcesResponse(items = sources.map(DataSourceResponse.fromDomain)))
              }
            },
            post {
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
                        decodeUtf8(bytes) match {
                          case None =>
                            complete(StatusCodes.BadRequest, ErrorResponse("File must be UTF-8 encoded"))
                          case Some(csvContent) =>
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
                              updatedAt  = now
                            )
                            val insertF =
                              fileSystem.write(filePath, bytes).flatMap { _ =>
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
                                    updatedAt = now
                                  )
                                  dataTypeRepo.insert(dataType).map(_ => ds)
                                }
                              }
                            onSuccess(insertF) { ds =>
                              complete(StatusCodes.Created, DataSourceResponse.fromDomain(ds))
                            }
                        }
                  }
                }
              }
            }
          )
        },
        path(Segment / "refresh") { sourceId =>
          post {
            onSuccess(dataSourceRepo.findById(DataSourceId(sourceId))) {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse("Data source not found"))
              case Some(source) =>
                if (source.sourceType != SourceType.Csv)
                  complete(StatusCodes.BadRequest, ErrorResponse("refresh is only supported for csv sources"))
                else
                  csvPathFromConfig(source.config) match {
                    case None =>
                      complete(StatusCodes.InternalServerError, ErrorResponse("Source config is missing path"))
                    case Some(path) =>
                      val refreshF =
                        fileSystem.read(path).flatMap { bytes =>
                          val csv    = new String(bytes, StandardCharsets.UTF_8)
                          val schema = SchemaInferenceEngine.fromCsv(csv)
                          dataTypeRepo.findBySourceId(source.id).flatMap { types =>
                            types.headOption match {
                              case None => Future.successful(source)
                              case Some(dt) =>
                                val now     = Instant.now()
                                val updated = dt.copy(
                                  fields    = schema.fields.map { f =>
                                    DataField(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
                                  }.toVector,
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
            }
          }
        },
        path(Segment / "preview") { sourceId =>
          get {
            onSuccess(dataSourceRepo.findById(DataSourceId(sourceId))) {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse("Data source not found"))
              case Some(source) =>
                csvPathFromConfig(source.config) match {
                  case None =>
                    complete(StatusCodes.InternalServerError, ErrorResponse("Source config is missing path"))
                  case Some(path) =>
                    onSuccess(fileSystem.read(path)) { bytes =>
                      val csv             = new String(bytes, StandardCharsets.UTF_8)
                      val (headers, rows) = SchemaInferenceEngine.parseCsvRows(csv, maxRows = 10)
                      complete(CsvPreviewResponse(headers, rows))
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
                    decodeUtf8(bytes) match {
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
        },
        path(Segment) { sourceId =>
          delete {
            onSuccess(dataSourceRepo.findById(DataSourceId(sourceId))) {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse("Data source not found"))
              case Some(source) =>
                val deleteFileF: Future[Unit] =
                  if (source.sourceType == SourceType.Csv)
                    csvPathFromConfig(source.config) match {
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

  private def decodeUtf8(bytes: Array[Byte]): Option[String] =
    try {
      val decoder = StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
      Some(decoder.decode(ByteBuffer.wrap(bytes)).toString)
    } catch {
      case _: java.nio.charset.CharacterCodingException => None
    }

  private def csvPathFromConfig(config: spray.json.JsValue): Option[String] =
    config.asJsObject.fields.get("path").collect { case JsString(p) => p }
}