package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContextExecutor
import scala.util.{Failure, Success, Try}

/** CRUD shell for the `/api/sources` namespace.
 *  Connector preview / inference / refresh handlers live in `SourcePreviewRoutes`. */
final class SourceRoutes(
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    connector: RestApiConnector,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

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
          updatedAt  = now,
          ownerId    = user.id
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
                updatedAt = now,
                ownerId   = user.id
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
              updatedAt  = now,
              ownerId    = user.id
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
                    updatedAt = now,
                    ownerId   = user.id
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

  val routes: Route =
    pathPrefix("sources") {
      pathEndOrSingleSlash {
        post {
          entity(as[JsValue]) { json =>
            val obj = json.asJsObject
            val sourceTypeStr = obj.fields.get("sourceType")
              .collect { case JsString(s) => s }
              .getOrElse("rest_api")

            if (sourceTypeStr == "sql") {
              Try(json.convertTo[SqlCreateSourceRequest]) match {
                case Success(request) => handleSqlCreate(request)
                case Failure(e)       => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
              }
            } else {
              Try(json.convertTo[CreateSourceRequest]) match {
                case Success(request) => handleRestCreate(request)
                case Failure(e)       => complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
              }
            }
          }
        }
      }
    }
}
