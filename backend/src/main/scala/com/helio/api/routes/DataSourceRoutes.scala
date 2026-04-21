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
import scala.util.{Failure, Success, Try}

final class DataSourceRoutes(
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    fileSystem: FileSystem,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext
  private implicit val mat: Materializer                         = SystemMaterializer(system).materializer

  private val acl = new AclDirective()

  private val csvMaxBytes: Long =
    sys.env.get("CSV_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(52428800L)

  private val staticMaxRows = 500

  private val dataSourceResolver: String => Future[Option[String]] =
    id => dataSourceRepo.findById(DataSourceId(id)).map(_.map(_.ownerId.value))

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
              concat(
                entity(as[StaticDataSourceRequest]) { req =>
                  if (req.name.trim.isEmpty)
                    complete(StatusCodes.BadRequest, ErrorResponse("name is required"))
                  else if (req.rows.size > staticMaxRows)
                    complete(StatusCodes.BadRequest, ErrorResponse(s"Payload exceeds the maximum of $staticMaxRows rows"))
                  else {
                    val now      = Instant.now()
                    val sourceId = DataSourceId(UUID.randomUUID().toString)
                    val config   = JsObject(
                      "columns" -> req.columns.toJson,
                      "rows"    -> req.rows.toJson
                    )
                    val source = DataSource(
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
                        fields    = req.columns.map { col =>
                          DataField(col.name, col.name, col.`type`, nullable = true)
                        },
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
                },
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
                              updatedAt  = now,
                              ownerId    = user.id
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
                }
                }
              )
            }
          )
        },
        path(Segment / "refresh") { sourceId =>
          post {
            acl.authorizeResource(sourceId, user, dataSourceResolver, "Data source not found") {
              onSuccess(dataSourceRepo.findById(DataSourceId(sourceId))) {
                case None =>
                  complete(StatusCodes.NotFound, ErrorResponse("Data source not found"))
                case Some(source) =>
                  if (source.sourceType == SourceType.Static)
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
                                case None => Future.successful(ds)
                                case Some(dt) =>
                                  val updatedDt = dt.copy(
                                    fields    = payload.columns.map { col =>
                                      DataField(col.name, col.name, col.`type`, nullable = true)
                                    },
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
                  else if (source.sourceType != SourceType.Csv)
                    complete(StatusCodes.BadRequest, ErrorResponse("refresh is only supported for csv and static sources"))
                  else
                    csvPathFromConfig(source.config) match {
                      case None =>
                        complete(StatusCodes.InternalServerError, ErrorResponse("Source config is missing path"))
                      case Some(path) =>
                        val refreshF =
                          fileSystem.read(path).flatMap { bytes =>
                            val csv    = new String(bytes, StandardCharsets.UTF_8)
                            val schema = SchemaInferenceEngine.fromCsv(csv)
                            dataTypeRepo.findBySourceId(source.id, user.id).flatMap { types =>
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
          }
        },
        path(Segment / "preview") { sourceId =>
          get {
            acl.authorizeResource(sourceId, user, dataSourceResolver, "Data source not found") {
              onSuccess(dataSourceRepo.findById(DataSourceId(sourceId))) {
                case None =>
                  complete(StatusCodes.NotFound, ErrorResponse("Data source not found"))
                case Some(source) =>
                  if (source.sourceType == SourceType.Static) {
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
                  } else
                    csvPathFromConfig(source.config) match {
                      case None =>
                        complete(StatusCodes.InternalServerError, ErrorResponse("Source config is missing path"))
                      case Some(path) =>
                        onComplete(fileSystem.read(path)) {
                          case Success(bytes) =>
                            val csv             = new String(bytes, StandardCharsets.UTF_8)
                            val (headers, rows) = SchemaInferenceEngine.parseCsvRows(csv, maxRows = 10)
                            complete(CsvPreviewResponse(headers, rows))
                          case Failure(_: java.nio.file.NoSuchFileException) =>
                            complete(StatusCodes.NotFound, ErrorResponse("Data file not found; the source may need to be re-uploaded"))
                          case Failure(_) =>
                            complete(StatusCodes.InternalServerError, ErrorResponse("Failed to read data file"))
                        }
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
            acl.authorizeResource(sourceId, user, dataSourceResolver, "Data source not found") {
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
