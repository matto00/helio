package com.helio.api

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.{Multipart, StatusCodes}
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import akka.stream.{Materializer, SystemMaterializer}
import akka.stream.scaladsl.Sink
import com.helio.domain._
import com.helio.domain.RestApiConnector
import com.helio.infrastructure.{DashboardRepository, DataSourceRepository, DataTypeRepository, FileSystem, PanelRepository}
import spray.json._

import java.nio.ByteBuffer
import java.nio.charset.{CodingErrorAction, StandardCharsets}
import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContextExecutor
import scala.concurrent.Future
import scala.concurrent.duration.DurationInt

final class ApiRoutes(
    dashboardRepo: DashboardRepository,
    panelRepo: PanelRepository,
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    fileSystem: FileSystem,
    connector: RestApiConnector
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext
  private implicit val mat: Materializer                        = SystemMaterializer(system).materializer

  private val csvMaxBytes: Long =
    sys.env.get("CSV_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(52428800L)

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

  val routes: Route =
    path("health") {
      get {
        complete(HealthResponse(status = "ok"))
      }
    } ~
      pathPrefix("api") {
        concat(
          pathPrefix("dashboards") {
            concat(
              pathEndOrSingleSlash {
                concat(
                  get {
                    onSuccess(dashboardRepo.findAll()) { dashboards =>
                      complete(DashboardsResponse(items = dashboards.map(DashboardResponse.fromDomain)))
                    }
                  },
                  post {
                    entity(as[CreateDashboardRequest]) { request =>
                      val now = Instant.now()
                      val dashboard = Dashboard(
                        id         = DashboardId(UUID.randomUUID().toString),
                        name       = RequestValidation.normalizeDashboardName(request.name),
                        meta       = ResourceMeta(createdBy = "system", createdAt = now, lastUpdated = now),
                        appearance = DashboardAppearance.Default,
                        layout     = DashboardLayout.Default
                      )
                      onSuccess(dashboardRepo.insert(dashboard)) { created =>
                        complete(StatusCodes.Created, DashboardResponse.fromDomain(created))
                      }
                    }
                  }
                )
              },
              path(Segment / "panels") { dashboardId =>
                get {
                  onSuccess(panelRepo.findByDashboardId(DashboardId(dashboardId))) { panels =>
                    complete(PanelsResponse(items = panels.map(PanelResponse.fromDomain)))
                  }
                }
              },
              path(Segment) { dashboardId =>
                concat(
                delete {
                  onSuccess(dashboardRepo.delete(DashboardId(dashboardId))) {
                    case true  => complete(StatusCodes.NoContent)
                    case false => complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                  }
                },
                patch {
                  entity(as[UpdateDashboardRequest]) { request =>
                    validateDashboardUpdateRequest(request) match {
                      case Left(error) =>
                        complete(StatusCodes.BadRequest, ErrorResponse(error))
                      case Right((nameOpt, appearanceOpt, layoutOpt)) =>
                        onSuccess(dashboardRepo.findById(DashboardId(dashboardId))) {
                          case None =>
                            complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                          case Some(existing) =>
                            val now = Instant.now()
                            nameOpt match {
                              case Some(name) =>
                                onSuccess(dashboardRepo.updateName(DashboardId(dashboardId), name, now)) {
                                  case None => complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                                  case Some(renamed) =>
                                    if (appearanceOpt.isEmpty && layoutOpt.isEmpty) {
                                      complete(DashboardResponse.fromDomain(renamed))
                                    } else {
                                      val updated = renamed.copy(
                                        appearance = appearanceOpt.getOrElse(renamed.appearance),
                                        layout     = layoutOpt.getOrElse(renamed.layout),
                                        meta       = renamed.meta.copy(lastUpdated = now)
                                      )
                                      onSuccess(dashboardRepo.update(updated)) {
                                        case Some(d) => complete(DashboardResponse.fromDomain(d))
                                        case None    => complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                                      }
                                    }
                                }
                              case None =>
                                val updated = existing.copy(
                                  appearance = appearanceOpt.getOrElse(existing.appearance),
                                  layout     = layoutOpt.getOrElse(existing.layout),
                                  meta       = existing.meta.copy(lastUpdated = now)
                                )
                                onSuccess(dashboardRepo.update(updated)) {
                                  case Some(d) => complete(DashboardResponse.fromDomain(d))
                                  case None    => complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                                }
                            }
                        }
                    }
                  }
                })
              }
            )
          },
          pathPrefix("panels") {
            concat(
              pathEndOrSingleSlash {
                post {
                  entity(as[CreatePanelRequest]) { request =>
                    validatePanelRequest(request) match {
                      case Left(error) =>
                        complete(StatusCodes.BadRequest, ErrorResponse(error))
                      case Right(dashboardId) =>
                        onSuccess(dashboardRepo.findById(dashboardId)) {
                          case None =>
                            complete(StatusCodes.NotFound, ErrorResponse("Dashboard not found"))
                          case Some(_) =>
                            validatePanelType(request.`type`) match {
                              case Left(err) =>
                                complete(StatusCodes.BadRequest, ErrorResponse(err))
                              case Right(panelType) =>
                                val now = Instant.now()
                                val panel = Panel(
                                  id          = PanelId(UUID.randomUUID().toString),
                                  dashboardId = dashboardId,
                                  title       = RequestValidation.normalizePanelTitle(request.title),
                                  meta        = ResourceMeta(createdBy = "system", createdAt = now, lastUpdated = now),
                                  appearance  = PanelAppearance.Default,
                                  panelType   = panelType
                                )
                                onSuccess(panelRepo.insert(panel)) { created =>
                                  complete(StatusCodes.Created, PanelResponse.fromDomain(created))
                                }
                            }
                        }
                    }
                  }
                }
              },
              path(Segment) { panelId =>
                concat(
                delete {
                  onSuccess(panelRepo.delete(PanelId(panelId))) {
                    case true  => complete(StatusCodes.NoContent)
                    case false => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                  }
                },
                patch {
                  entity(as[UpdatePanelRequest]) { request =>
                    val trimmedTitle  = request.title.map(_.trim)
                    val hasBinding    = request.typeId.isDefined || request.fieldMapping.isDefined
                    val hasOtherField = trimmedTitle.isDefined || request.appearance.isDefined || request.`type`.isDefined

                    if (trimmedTitle.contains("")) {
                      complete(StatusCodes.BadRequest, ErrorResponse("title must not be blank"))
                    } else if (!hasOtherField && !hasBinding) {
                      complete(StatusCodes.BadRequest, ErrorResponse("at least one field is required"))
                    } else {
                      validatePanelTypeOpt(request.`type`) match {
                        case Left(err) =>
                          complete(StatusCodes.BadRequest, ErrorResponse(err))
                        case Right(panelTypeOpt) =>
                          val now          = Instant.now()
                          val appearanceOpt = request.appearance.map(p =>
                            PanelAppearance(
                              background   = RequestValidation.normalizePanelBackground(p.background),
                              color        = RequestValidation.normalizePanelColor(p.color),
                              transparency = RequestValidation.normalizeTransparency(p.transparency)
                            )
                          )

                          def applyTypeUpdate(panelOpt: Option[Panel]): Future[Option[Panel]] =
                            panelTypeOpt match {
                              case None     => Future.successful(panelOpt)
                              case Some(pt) => panelOpt match {
                                case None    => Future.successful(None)
                                case Some(_) => panelRepo.updateType(PanelId(panelId), pt, now)
                              }
                            }

                          def applyBindingUpdate(panelOpt: Option[Panel]): Future[Option[Panel]] =
                            if (!hasBinding) Future.successful(panelOpt)
                            else panelOpt match {
                              case None => Future.successful(None)
                              case Some(panel) =>
                                val newTypeId = request.typeId.fold(panel.typeId)(_.map(DataTypeId(_)))
                                val newFieldMapping = request.fieldMapping.fold(panel.fieldMapping)(identity)
                                panelRepo.updateTypeBinding(PanelId(panelId), newTypeId, newFieldMapping, now)
                            }

                          val coreFuture: Future[Option[Panel]] =
                            if (!hasOtherField) {
                              panelRepo.findById(PanelId(panelId))
                            } else {
                              val titleFuture: Future[Option[Panel]] = trimmedTitle match {
                                case Some(title) =>
                                  panelRepo.updateTitle(PanelId(panelId), title, now).flatMap { result =>
                                    appearanceOpt match {
                                      case None             => applyTypeUpdate(result)
                                      case Some(appearance) =>
                                        result match {
                                          case None    => Future.successful(None)
                                          case Some(_) =>
                                            panelRepo.updateAppearance(PanelId(panelId), appearance, now)
                                              .flatMap(applyTypeUpdate)
                                        }
                                    }
                                  }
                                case None =>
                                  appearanceOpt match {
                                    case Some(appearance) =>
                                      panelRepo.updateAppearance(PanelId(panelId), appearance, now)
                                        .flatMap(applyTypeUpdate)
                                    case None =>
                                      panelRepo.updateType(PanelId(panelId), panelTypeOpt.get, now)
                                  }
                              }
                              titleFuture
                            }

                          onSuccess(coreFuture.flatMap(applyBindingUpdate)) {
                            case Some(panel) => complete(PanelResponse.fromDomain(panel))
                            case None        => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                          }
                      }
                    }
                  }
                })
              },
              path(Segment / "duplicate") { panelId =>
                post {
                  onSuccess(panelRepo.duplicate(PanelId(panelId))) {
                    case Some(panel) => complete(StatusCodes.Created, PanelResponse.fromDomain(panel))
                    case None        => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
                  }
                }
              }
            )
          },
          pathPrefix("types") {
            concat(
              pathEndOrSingleSlash {
                get {
                  onSuccess(dataTypeRepo.findAll()) { types =>
                    complete(DataTypesResponse(items = types.map(DataTypeResponse.fromDomain)))
                  }
                }
              },
              path(Segment) { typeId =>
                val id = DataTypeId(typeId)
                concat(
                  get {
                    onSuccess(dataTypeRepo.findById(id)) {
                      case Some(dt) => complete(DataTypeResponse.fromDomain(dt))
                      case None     => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                    }
                  },
                  patch {
                    entity(as[UpdateDataTypeRequest]) { request =>
                      onSuccess(dataTypeRepo.findById(id)) {
                        case None => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                        case Some(existing) =>
                          val now     = Instant.now()
                          val updated = existing.copy(
                            name      = request.name.getOrElse(existing.name),
                            fields    = request.fields
                              .map(_.map(p => DataField(p.name, p.displayName, p.dataType, p.nullable)))
                              .getOrElse(existing.fields),
                            updatedAt = now
                          )
                          onSuccess(dataTypeRepo.update(updated)) {
                            case Some(dt) => complete(DataTypeResponse.fromDomain(dt))
                            case None     => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                          }
                      }
                    }
                  },
                  delete {
                    onSuccess(dataTypeRepo.findById(id)) {
                      case None => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                      case Some(_) =>
                        onSuccess(dataTypeRepo.isBoundToAnyPanel(id)) {
                          case true =>
                            complete(
                              StatusCodes.Conflict,
                              ErrorResponse("Cannot delete DataType: one or more panels are bound to it")
                            )
                          case false =>
                            onSuccess(dataTypeRepo.delete(id)) { _ =>
                              complete(StatusCodes.NoContent)
                            }
                        }
                    }
                  }
                )
              }
            )
          },
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
                                            DataField(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
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
                            val csv              = new String(bytes, StandardCharsets.UTF_8)
                            val (headers, rows)  = SchemaInferenceEngine.parseCsvRows(csv, maxRows = 10)
                            complete(CsvPreviewResponse(headers, rows))
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
          },
          pathPrefix("sources") {
            concat(
              pathEndOrSingleSlash {
                post {
                  entity(as[CreateSourceRequest]) { request =>
                    RestApiConfigPayload.toDomain(request.config) match {
                      case Left(err) =>
                        complete(StatusCodes.BadRequest, ErrorResponse(err))
                      case Right(restConfig) =>
                        SourceType.fromString(request.sourceType) match {
                          case Left(err) =>
                            complete(StatusCodes.BadRequest, ErrorResponse(err))
                          case Right(sourceType) =>
                            val now = Instant.now()
                            val source = DataSource(
                              id         = DataSourceId(UUID.randomUUID().toString),
                              name       = request.name,
                              sourceType = sourceType,
                              config     = request.config.toJson,
                              createdAt  = now,
                              updatedAt  = now
                            )
                            onSuccess(dataSourceRepo.insert(source)) { inserted =>
                              onSuccess(connector.fetch(restConfig)) {
                                case Left(err) =>
                                  complete(
                                    StatusCodes.Created,
                                    CreateSourceResponse(
                                      source     = DataSourceResponse.fromDomain(inserted),
                                      dataType   = None,
                                      fetchError = Some(err)
                                    )
                                  )
                                case Right(json) =>
                                  val schema = SchemaInferenceEngine.fromJson(json)
                                  val fields = schema.fields.map(f =>
                                    DataField(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
                                  ).toVector
                                  val dt = DataType(
                                    id        = DataTypeId(UUID.randomUUID().toString),
                                    sourceId  = Some(inserted.id),
                                    name      = inserted.name,
                                    fields    = fields,
                                    version   = 1,
                                    createdAt = now,
                                    updatedAt = now
                                  )
                                  onSuccess(dataTypeRepo.insert(dt)) { createdDt =>
                                    complete(
                                      StatusCodes.Created,
                                      CreateSourceResponse(
                                        source     = DataSourceResponse.fromDomain(inserted),
                                        dataType   = Some(DataTypeResponse.fromDomain(createdDt)),
                                        fetchError = None
                                      )
                                    )
                                  }
                              }
                            }
                        }
                    }
                  }
                }
              },
              path(Segment / "refresh") { sourceId =>
                post {
                  val id = DataSourceId(sourceId)
                  onSuccess(dataSourceRepo.findById(id)) {
                    case None =>
                      complete(StatusCodes.NotFound, ErrorResponse("DataSource not found"))
                    case Some(source) =>
                      RestApiConfigPayload.toDomain(
                        source.config.convertTo[RestApiConfigPayload]
                      ) match {
                        case Left(err) =>
                          complete(StatusCodes.BadRequest, ErrorResponse(s"Invalid stored config: $err"))
                        case Right(restConfig) =>
                          onSuccess(connector.fetch(restConfig)) {
                            case Left(err) =>
                              complete(StatusCodes.BadGateway, ErrorResponse(s"Fetch failed: $err"))
                            case Right(json) =>
                              val now    = Instant.now()
                              val schema = SchemaInferenceEngine.fromJson(json)
                              val fields = schema.fields.map(f =>
                                DataField(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
                              ).toVector
                              onSuccess(dataTypeRepo.findBySourceId(id)) { existing =>
                                existing.headOption match {
                                  case Some(dt) =>
                                    val updated = dt.copy(fields = fields, updatedAt = now)
                                    onSuccess(dataTypeRepo.update(updated)) {
                                      case Some(d) => complete(DataTypeResponse.fromDomain(d))
                                      case None    => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                                    }
                                  case None =>
                                    val dt = DataType(
                                      id        = DataTypeId(UUID.randomUUID().toString),
                                      sourceId  = Some(source.id),
                                      name      = source.name,
                                      fields    = fields,
                                      version   = 1,
                                      createdAt = now,
                                      updatedAt = now
                                    )
                                    onSuccess(dataTypeRepo.insert(dt)) { created =>
                                      complete(DataTypeResponse.fromDomain(created))
                                    }
                                }
                              }
                          }
                      }
                  }
                }
              },
              path(Segment / "preview") { sourceId =>
                get {
                  val id = DataSourceId(sourceId)
                  onSuccess(dataSourceRepo.findById(id)) {
                    case None =>
                      complete(StatusCodes.NotFound, ErrorResponse("DataSource not found"))
                    case Some(source) =>
                      RestApiConfigPayload.toDomain(
                        source.config.convertTo[RestApiConfigPayload]
                      ) match {
                        case Left(err) =>
                          complete(StatusCodes.BadRequest, ErrorResponse(s"Invalid stored config: $err"))
                        case Right(restConfig) =>
                          onSuccess(connector.fetch(restConfig)) {
                            case Left(err) =>
                              complete(StatusCodes.BadGateway, ErrorResponse(s"Fetch failed: $err"))
                            case Right(json) =>
                              val rows = connector.toRows(json).take(10)
                              complete(PreviewSourceResponse(rows))
                          }
                      }
                  }
                }
              }
            )
          }
        )
      }

  private def validatePanelRequest(request: CreatePanelRequest): Either[String, DashboardId] =
    request.dashboardId.map(_.trim).filter(_.nonEmpty) match {
      case Some(id) => Right(DashboardId(id))
      case None     => Left("dashboardId is required")
    }

  private def validatePanelType(typeOpt: Option[String]): Either[String, PanelType] =
    typeOpt match {
      case None    => Right(PanelType.Default)
      case Some(t) => PanelType.fromString(t)
    }

  private def validatePanelTypeOpt(typeOpt: Option[String]): Either[String, Option[PanelType]] =
    typeOpt match {
      case None    => Right(None)
      case Some(t) => PanelType.fromString(t).map(Some(_))
    }

  private def validateDashboardUpdateRequest(
      request: UpdateDashboardRequest
  ): Either[String, (Option[String], Option[DashboardAppearance], Option[DashboardLayout])] = {
    if (request.name.isEmpty && request.appearance.isEmpty && request.layout.isEmpty) {
      Left("name, appearance, or layout is required")
    } else {
      request.name.map(_.trim) match {
        case Some("") => Left("name must not be blank")
        case nameOpt =>
          validateDashboardLayoutPayload(request.layout).map { layout =>
            (
              nameOpt,
              request.appearance.map(p =>
                DashboardAppearance(
                  background    = RequestValidation.normalizeDashboardBackground(p.background),
                  gridBackground = RequestValidation.normalizeDashboardGridBackground(p.gridBackground)
                )
              ),
              layout
            )
          }
      }
    }
  }

  private def validateDashboardLayoutPayload(
      layout: Option[DashboardLayoutPayload]
  ): Either[String, Option[DashboardLayout]] =
    layout match {
      case None => Right(None)
      case Some(p) =>
        validateDashboardLayoutItems(p.lg).flatMap(lg =>
          validateDashboardLayoutItems(p.md).flatMap(md =>
            validateDashboardLayoutItems(p.sm).flatMap(sm =>
              validateDashboardLayoutItems(p.xs).map(xs =>
                Some(DashboardLayout(lg, md, sm, xs))
              )
            )
          )
        )
    }

  private def validateDashboardLayoutItems(
      items: Vector[DashboardLayoutItemPayload]
  ): Either[String, Vector[DashboardLayoutItem]] =
    items.foldLeft[Either[String, Vector[DashboardLayoutItem]]](Right(Vector.empty)) {
      case (Left(err), _) => Left(err)
      case (Right(acc), item) =>
        val panelId = item.panelId.trim
        if (panelId.isEmpty) Left("layout panelId is required")
        else Right(acc :+ DashboardLayoutItem(
          panelId = PanelId(panelId),
          x       = RequestValidation.normalizeLayoutCoordinate(item.x),
          y       = RequestValidation.normalizeLayoutCoordinate(item.y),
          w       = RequestValidation.normalizeLayoutSpan(item.w),
          h       = RequestValidation.normalizeLayoutSpan(item.h)
        ))
    }
}
