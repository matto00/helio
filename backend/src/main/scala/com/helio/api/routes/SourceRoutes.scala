package com.helio.api.routes

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain._
import com.helio.domain.RestApiConnector
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContextExecutor

final class SourceRoutes(
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    connector: RestApiConnector
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
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
}