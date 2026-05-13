package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.DataSourceIdSegment
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContextExecutor, Future}
import scala.util.{Failure, Success, Try}

/** Connector preview / inference / refresh endpoints for `/api/sources`.
 *  Hosts `POST /infer`, `GET /:id/preview`, `POST /:id/refresh`.
 *  Split out of `SourceRoutes` so each file fits the 250-line soft budget. */
final class SourcePreviewRoutes(
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    connector: RestApiConnector,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  /** Append computed-field values to each row JsObject. Non-object rows pass through
   *  unchanged; per-row eval errors are captured in the returned error vector. */
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

  /** Upsert a DataType for the given source with the given fields.
   *  Used by both SQL and REST refresh handlers. */
  private def upsertDataType(source: DataSource, fields: Vector[DataField], now: Instant, bumpVersion: Boolean): Future[Option[DataType]] =
    dataTypeRepo.findBySourceId(source.id, user.id).flatMap { existing =>
      existing.headOption match {
        case Some(dt) =>
          val updated = dt.copy(
            fields    = fields,
            version   = if (bumpVersion) dt.version + 1 else dt.version,
            updatedAt = now
          )
          dataTypeRepo.update(updated)
        case None =>
          val dt = DataType(
            id        = DataTypeId(UUID.randomUUID().toString),
            sourceId  = Some(source.id),
            name      = source.name,
            fields    = fields,
            version   = 1,
            createdAt = now,
            updatedAt = now,
            ownerId   = user.id
          )
          dataTypeRepo.insert(dt).map(Some(_))
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
                  case Success(request) =>
                    handleSqlInfer(SqlSourceConfigPayload.toDomain(request.config))
                  case Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
                }
              } else {
                Try(json.convertTo[RestApiConfigPayload]) match {
                  case Success(payload) =>
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
                  case Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
                }
              }
            }
          }
        },
        path(DataSourceIdSegment / "refresh") { id =>
          post {
            onSuccess(dataSourceRepo.findById(id)) {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse("DataSource not found"))
              case Some(source) if source.ownerId != user.id =>
                complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
              case Some(source) if source.sourceType == SourceType.Sql =>
                Try(source.config.convertTo[SqlSourceConfigPayload]) match {
                  case Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(s"Invalid stored SQL config: ${e.getMessage}"))
                  case Success(configPayload) =>
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
                        onSuccess(upsertDataType(source, fields, now, bumpVersion = true)) {
                          case Some(d) => complete(DataTypeResponse.fromDomain(d))
                          case None    => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
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
                        onSuccess(upsertDataType(source, fields, now, bumpVersion = false)) {
                          case Some(d) => complete(DataTypeResponse.fromDomain(d))
                          case None    => complete(StatusCodes.NotFound, ErrorResponse("DataType not found"))
                        }
                    }
                }
            }
          }
        },
        path(DataSourceIdSegment / "preview") { id =>
          get {
            onSuccess(dataSourceRepo.findById(id)) {
              case None =>
                complete(StatusCodes.NotFound, ErrorResponse("DataSource not found"))
              case Some(source) if source.ownerId != user.id =>
                complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
              case Some(source) if source.sourceType == SourceType.Sql =>
                Try(source.config.convertTo[SqlSourceConfigPayload]) match {
                  case Failure(e) =>
                    complete(StatusCodes.BadRequest, ErrorResponse(s"Invalid stored SQL config: ${e.getMessage}"))
                  case Success(configPayload) =>
                    val sqlConfig = SqlSourceConfigPayload.toDomain(configPayload)
                    onSuccess(SqlConnector.execute(sqlConfig, maxRows = 10)) {
                      case Left(err) =>
                        complete(StatusCodes.BadGateway, ErrorResponse(s"SQL execution failed: $err"))
                      case Right(rows) =>
                        onSuccess(dataTypeRepo.findBySourceId(id, user.id)) { dataTypes =>
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
                        onSuccess(dataTypeRepo.findBySourceId(id, user.id)) { dataTypes =>
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
