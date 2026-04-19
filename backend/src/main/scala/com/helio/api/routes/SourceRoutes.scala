package com.helio.api.routes

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContextExecutor
import scala.util.Try

final class SourceRoutes(
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    connector: RestApiConnector
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  /** Append evaluated computed-field values to each row JsObject.
   *  Returns the augmented rows and a list of evaluation error messages collected
   *  across all rows.  Rows that are not JsObjects are returned unchanged.
   *  Fields whose expressions produce a runtime error get a JsNull value in that
   *  row; the error message is accumulated in the returned error list. */
  private def applyComputedFields(
      rows: Vector[JsValue],
      computedFields: Vector[ComputedField]
  ): (Vector[JsValue], Vector[String]) = {
    if (computedFields.isEmpty) return (rows, Vector.empty)
    val errors = scala.collection.mutable.ArrayBuffer.empty[String]
    val augmented = rows.map {
      case obj: JsObject =>
        val extra: Map[String, JsValue] = computedFields.map { cf =>
          cf.name -> ExpressionEvaluator.evaluate(cf.expression, obj.fields).fold(
            err => { errors += err.message; JsNull },
            identity
          )
        }.toMap
        JsObject(obj.fields ++ extra)
      case other => other
    }
    (augmented, errors.distinct.toVector)
  }

  // ── SQL route helpers ───────────────────────────────────────────────────────

  private def handleSqlCreate(request: SqlCreateSourceRequest): Route = {
    val sqlConfig = SqlSourceConfigPayload.toDomain(request.config)
    SqlConnector.checkQuery(sqlConfig.query) match {
      case Left(err) =>
        complete(StatusCodes.BadRequest, ErrorResponse(err))
      case Right(_) =>
        val now = Instant.now()
        val source = DataSource(
          id         = DataSourceId(UUID.randomUUID().toString),
          name       = request.name,
          sourceType = SourceType.Sql,
          config     = request.config.toJson,
          createdAt  = now,
          updatedAt  = now
        )
        onSuccess(dataSourceRepo.insert(source)) { inserted =>
          onSuccess(SqlConnector.execute(sqlConfig, maxRows = 100)) {
            case Left(err) =>
              complete(
                StatusCodes.Created,
                CreateSourceResponse(
                  source     = DataSourceResponse.fromDomain(inserted),
                  dataType   = None,
                  fetchError = Some(err)
                )
              )
            case Right(rows) =>
              val schema = SqlConnector.inferSchema(rows)
              val fields = schema.fields.map { f =>
                DataField(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
              }.toVector
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

  private def handleRestCreate(request: CreateSourceRequest): Route =
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
                  val overridesMap = request.fieldOverrides
                    .getOrElse(Vector.empty)
                    .map(o => o.name -> o)
                    .toMap
                  val fields = schema.fields.map { f =>
                    val ov = overridesMap.get(f.name)
                    DataField(
                      f.name,
                      ov.map(_.displayName).getOrElse(f.displayName),
                      ov.map(_.dataType).getOrElse(DataFieldType.asString(f.dataType)),
                      f.nullable
                    )
                  }.toVector
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

  private def handleSqlInfer(sqlConfig: SqlSourceConfig): Route =
    SqlConnector.checkQuery(sqlConfig.query) match {
      case Left(err) =>
        complete(StatusCodes.BadRequest, ErrorResponse(err))
      case Right(_) =>
        onSuccess(SqlConnector.execute(sqlConfig, maxRows = 100)) {
          case Left(err) =>
            complete(StatusCodes.BadGateway, ErrorResponse(err))
          case Right(rows) =>
            val schema = SqlConnector.inferSchema(rows)
            val fields = schema.fields.map(f =>
              InferredFieldResponse(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
            ).toVector
            complete(InferredSchemaResponse(fields))
        }
    }

  val routes: Route =
    pathPrefix("sources") {
      concat(
        pathEndOrSingleSlash {
          post {
            entity(as[JsValue]) { json =>
              val obj = json.asJsObject
              val sourceTypeStr = obj.fields.get("sourceType")
                .collect { case JsString(s) => s }
                .getOrElse("rest_api")

              if (sourceTypeStr == "sql") {
                Try(json.convertTo[SqlCreateSourceRequest]) match {
                  case scala.util.Success(request) => handleSqlCreate(request)
                  case scala.util.Failure(e)       => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
                }
              } else {
                Try(json.convertTo[CreateSourceRequest]) match {
                  case scala.util.Success(request) => handleRestCreate(request)
                  case scala.util.Failure(e)       => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
                }
              }
            }
          }
        },
        path("infer") {
          post {
            entity(as[JsValue]) { json =>
              val obj = json.asJsObject
              val sourceTypeStr = obj.fields.get("sourceType")
                .orElse(obj.fields.get("source_type"))
                .collect { case JsString(s) => s }
                .getOrElse("rest_api")

              if (sourceTypeStr == "sql") {
                Try(json.convertTo[SqlInferRequest]) match {
                  case scala.util.Success(request) =>
                    handleSqlInfer(SqlSourceConfigPayload.toDomain(request.config))
                  case scala.util.Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
                }
              } else {
                Try(json.convertTo[RestApiConfigPayload]) match {
                  case scala.util.Success(payload) =>
                    RestApiConfigPayload.toDomain(payload) match {
                      case Left(err) =>
                        complete(StatusCodes.BadRequest, ErrorResponse(err))
                      case Right(restConfig) =>
                        onSuccess(connector.fetch(restConfig)) {
                          case Left(err) =>
                            complete(StatusCodes.BadGateway, ErrorResponse(err))
                          case Right(json) =>
                            val schema = SchemaInferenceEngine.fromJson(json)
                            val fields = schema.fields.map(f =>
                              InferredFieldResponse(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
                            ).toVector
                            complete(InferredSchemaResponse(fields))
                        }
                    }
                  case scala.util.Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
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
              case Some(source) if source.sourceType == SourceType.Sql =>
                Try(source.config.convertTo[SqlSourceConfigPayload]) match {
                  case scala.util.Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(s"Invalid stored SQL config: ${e.getMessage}"))
                  case scala.util.Success(configPayload) =>
                    val sqlConfig = SqlSourceConfigPayload.toDomain(configPayload)
                    onSuccess(SqlConnector.execute(sqlConfig, maxRows = 100)) {
                      case Left(err) =>
                        complete(StatusCodes.BadGateway, ErrorResponse(s"SQL execution failed: $err"))
                      case Right(rows) =>
                        val now    = Instant.now()
                        val schema = SqlConnector.inferSchema(rows)
                        val fields = schema.fields.map(f =>
                          DataField(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
                        ).toVector
                        onSuccess(dataTypeRepo.findBySourceId(id)) { existing =>
                          existing.headOption match {
                            case Some(dt) =>
                              val updated = dt.copy(fields = fields, version = dt.version + 1, updatedAt = now)
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
              case Some(source) if source.sourceType == SourceType.Sql =>
                Try(source.config.convertTo[SqlSourceConfigPayload]) match {
                  case scala.util.Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(s"Invalid stored SQL config: ${e.getMessage}"))
                  case scala.util.Success(configPayload) =>
                    val sqlConfig = SqlSourceConfigPayload.toDomain(configPayload)
                    onSuccess(SqlConnector.execute(sqlConfig, maxRows = 10)) {
                      case Left(err) =>
                        complete(StatusCodes.BadGateway, ErrorResponse(s"SQL execution failed: $err"))
                      case Right(rows) =>
                        onSuccess(dataTypeRepo.findBySourceId(id)) { dataTypes =>
                          val computedFields = dataTypes.headOption
                            .map(_.computedFields)
                            .getOrElse(Vector.empty)
                          val rawRows = SqlConnector.toRows(rows)
                          val (augmented, evalErrors) = applyComputedFields(rawRows, computedFields)
                          complete(PreviewSourceResponse(augmented, evalErrors))
                        }
                    }
                }
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
                        val rawRows = connector.toRows(json).take(10)
                        onSuccess(dataTypeRepo.findBySourceId(id)) { dataTypes =>
                          val computedFields = dataTypes.headOption
                            .map(_.computedFields)
                            .getOrElse(Vector.empty)
                          val (rows, evalErrors) = applyComputedFields(rawRows, computedFields)
                          complete(PreviewSourceResponse(rows, evalErrors))
                        }
                    }
                }
            }
          }
        }
      )
    }
}
