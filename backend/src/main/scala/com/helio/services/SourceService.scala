package com.helio.services

import com.helio.api.protocols.{
  CreateSourceRequest,
  CreateSourceResponse,
  DataSourceResponse,
  DataTypeResponse,
  InferredFieldResponse,
  InferredSchemaResponse,
  PreviewSourceResponse,
  RestApiConfigPayload,
  SqlCreateSourceRequest,
  SqlInferRequest,
  SqlSourceConfigPayload
}
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository}
import SourceConfigParsing._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** Business logic for REST + SQL data sources.
 *
 *  CRUD for `/api/sources` plus connector preview / infer / refresh. CSV +
 *  Static live in [[DataSourceService]] (the route surfaces are also split
 *  along that boundary). Connector primitives (`RestApiConnector.fetch`,
 *  `SqlConnector.execute`) stay in `domain/`; the service just orchestrates. */
final class SourceService(
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo:   DataTypeRepository,
    connector:      RestApiConnector
)(implicit ec: ExecutionContext) {

  // ── Create ────────────────────────────────────────────────────────────────

  def createSql(request: SqlCreateSourceRequest, user: AuthenticatedUser): Future[Either[ServiceError, CreateSourceResponse]] = {
    val sqlConfig = SqlSourceConfigPayload.toDomain(request.config)
    SqlConnector.checkQuery(sqlConfig.query) match {
      case Left(err) =>
        Future.successful(Left(ServiceError.BadRequest(err)))
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
        dataSourceRepo.insert(source).flatMap { inserted =>
          SqlConnector.execute(sqlConfig, maxRows = 100).flatMap {
            case Left(err) =>
              Future.successful(Right(CreateSourceResponse(
                source     = DataSourceResponse.fromDomain(inserted),
                dataType   = None,
                fetchError = Some(err)
              )))
            case Right(rows) =>
              val schema = SqlConnector.inferSchema(rows)
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
                updatedAt = now,
                ownerId   = user.id
              )
              dataTypeRepo.insert(dt).map { createdDt =>
                Right(CreateSourceResponse(
                  source     = DataSourceResponse.fromDomain(inserted),
                  dataType   = Some(DataTypeResponse.fromDomain(createdDt)),
                  fetchError = None
                ))
              }
          }
        }
    }
  }

  def createRest(request: CreateSourceRequest, user: AuthenticatedUser): Future[Either[ServiceError, CreateSourceResponse]] =
    RestApiConfigPayload.toDomain(request.config) match {
      case Left(err) =>
        Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(restConfig) =>
        SourceType.fromString(request.sourceType) match {
          case Left(err) =>
            Future.successful(Left(ServiceError.BadRequest(err)))
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
            dataSourceRepo.insert(source).flatMap { inserted =>
              connector.fetch(restConfig).flatMap {
                case Left(err) =>
                  Future.successful(Right(CreateSourceResponse(
                    source     = DataSourceResponse.fromDomain(inserted),
                    dataType   = None,
                    fetchError = Some(err)
                  )))
                case Right(json) =>
                  val schema       = SchemaInferenceEngine.fromJson(json)
                  val overridesMap = request.fieldOverrides.getOrElse(Vector.empty).map(o => o.name -> o).toMap
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
                  dataTypeRepo.insert(dt).map { createdDt =>
                    Right(CreateSourceResponse(
                      source     = DataSourceResponse.fromDomain(inserted),
                      dataType   = Some(DataTypeResponse.fromDomain(createdDt)),
                      fetchError = None
                    ))
                  }
              }
            }
        }
    }

  // ── Infer ─────────────────────────────────────────────────────────────────

  def inferSql(request: SqlInferRequest): Future[Either[ServiceError, InferredSchemaResponse]] = {
    val sqlConfig = SqlSourceConfigPayload.toDomain(request.config)
    SqlConnector.checkQuery(sqlConfig.query) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(_) =>
        SqlConnector.execute(sqlConfig, maxRows = 100).map {
          case Left(err)   => Left(ServiceError.BadGateway(err))
          case Right(rows) => Right(toInferredSchema(SqlConnector.inferSchema(rows)))
        }
    }
  }

  def inferRest(payload: RestApiConfigPayload): Future[Either[ServiceError, InferredSchemaResponse]] =
    RestApiConfigPayload.toDomain(payload) match {
      case Left(err) =>
        Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(restConfig) =>
        connector.fetch(restConfig).map {
          case Left(err)   => Left(ServiceError.BadGateway(err))
          case Right(json) => Right(toInferredSchema(SchemaInferenceEngine.fromJson(json)))
        }
    }

  // ── Refresh ───────────────────────────────────────────────────────────────

  def refresh(sourceId: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, DataType]] =
    dataSourceRepo.findById(sourceId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("DataSource not found")))
      case Some(source) if source.ownerId != user.id =>
        Future.successful(Left(ServiceError.Forbidden()))
      case Some(source) if source.sourceType == SourceType.Sql =>
        refreshSql(source, user)
      case Some(source) =>
        refreshRest(source, user)
    }

  private def refreshSql(source: DataSource, user: AuthenticatedUser): Future[Either[ServiceError, DataType]] =
    Try(SourceConfigParsing.sqlConfigFromJson(source.config)) match {
      case Failure(e) =>
        Future.successful(Left(ServiceError.BadRequest(s"Invalid stored SQL config: ${e.getMessage}")))
      case Success(sqlConfig) =>
        SqlConnector.execute(sqlConfig, maxRows = 100).flatMap {
          case Left(err) =>
            Future.successful(Left(ServiceError.BadGateway(s"SQL execution failed: $err")))
          case Right(rows) =>
            val now    = Instant.now()
            val schema = SqlConnector.inferSchema(rows)
            val fields = schema.fields.map(f =>
              DataField(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
            ).toVector
            upsertDataType(source, fields, now, bumpVersion = true, user).map {
              case Some(dt) => Right(dt)
              case None     => Left(ServiceError.NotFound("DataType not found"))
            }
        }
    }

  private def refreshRest(source: DataSource, user: AuthenticatedUser): Future[Either[ServiceError, DataType]] =
    SourceConfigParsing.restConfigFromJson(source.config) match {
      case Left(err) =>
        Future.successful(Left(ServiceError.BadRequest(s"Invalid stored config: $err")))
      case Right(restConfig) =>
        connector.fetch(restConfig).flatMap {
          case Left(err) =>
            Future.successful(Left(ServiceError.BadGateway(s"Fetch failed: $err")))
          case Right(json) =>
            val now    = Instant.now()
            val schema = SchemaInferenceEngine.fromJson(json)
            val fields = schema.fields.map(f =>
              DataField(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
            ).toVector
            upsertDataType(source, fields, now, bumpVersion = false, user).map {
              case Some(dt) => Right(dt)
              case None     => Left(ServiceError.NotFound("DataType not found"))
            }
        }
    }

  // ── Preview ───────────────────────────────────────────────────────────────

  def preview(sourceId: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, PreviewSourceResponse]] =
    dataSourceRepo.findById(sourceId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("DataSource not found")))
      case Some(source) if source.ownerId != user.id =>
        Future.successful(Left(ServiceError.Forbidden()))
      case Some(source) if source.sourceType == SourceType.Sql =>
        previewSql(source, user)
      case Some(source) =>
        previewRest(source, user)
    }

  private def previewSql(source: DataSource, user: AuthenticatedUser): Future[Either[ServiceError, PreviewSourceResponse]] =
    Try(SourceConfigParsing.sqlConfigFromJson(source.config)) match {
      case Failure(e) =>
        Future.successful(Left(ServiceError.BadRequest(s"Invalid stored SQL config: ${e.getMessage}")))
      case Success(sqlConfig) =>
        SqlConnector.execute(sqlConfig, maxRows = 10).flatMap {
          case Left(err) =>
            Future.successful(Left(ServiceError.BadGateway(s"SQL execution failed: $err")))
          case Right(rows) =>
            dataTypeRepo.findBySourceId(source.id, user.id).map { dataTypes =>
              val computedFields          = dataTypes.headOption.map(_.computedFields).getOrElse(Vector.empty)
              val rawRows                 = SqlConnector.toRows(rows)
              val (augmented, evalErrors) = applyComputedFields(rawRows, computedFields)
              Right(PreviewSourceResponse(augmented, evalErrors))
            }
        }
    }

  private def previewRest(source: DataSource, user: AuthenticatedUser): Future[Either[ServiceError, PreviewSourceResponse]] =
    SourceConfigParsing.restConfigFromJson(source.config) match {
      case Left(err) =>
        Future.successful(Left(ServiceError.BadRequest(s"Invalid stored config: $err")))
      case Right(restConfig) =>
        connector.fetch(restConfig).flatMap {
          case Left(err) =>
            Future.successful(Left(ServiceError.BadGateway(s"Fetch failed: $err")))
          case Right(json) =>
            val rawRows = connector.toRows(json).take(10)
            dataTypeRepo.findBySourceId(source.id, user.id).map { dataTypes =>
              val computedFields = dataTypes.headOption.map(_.computedFields).getOrElse(Vector.empty)
              val (rows, evalErrors) = applyComputedFields(rawRows, computedFields)
              Right(PreviewSourceResponse(rows, evalErrors))
            }
        }
    }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private def upsertDataType(source: DataSource, fields: Vector[DataField], now: Instant, bumpVersion: Boolean, user: AuthenticatedUser): Future[Option[DataType]] =
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

  /** Append computed-field values to each row JsObject. Non-object rows pass
   *  through unchanged; per-row eval errors are captured in the returned
   *  error vector. */
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

  private def toInferredSchema(schema: InferredSchema): InferredSchemaResponse = {
    val fields = schema.fields.map(f =>
      InferredFieldResponse(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
    ).toVector
    InferredSchemaResponse(fields)
  }
}
