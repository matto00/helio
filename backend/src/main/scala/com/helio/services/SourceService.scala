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
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for REST + SQL data sources.
 *
 *  CRUD for `/api/sources` plus connector preview / infer / refresh. CSV +
 *  Static live in [[DataSourceService]] (the route surfaces are also split
 *  along that boundary). Connector primitives (`RestApiConnector.fetch`,
 *  `SqlConnector.execute`) stay in `domain/`; the service just orchestrates.
 *
 *  Create/infer/refresh dispatch through each connector's `Connector[Config].inferSchema`
 *  SPI method (HEL-449/HEL-473) rather than hand-rolling `execute`/`fetch` + inline inference;
 *  `SchemaInferenceFacade.toDataFields` is the single `InferredField` → `DataField` projection
 *  they all share. `preview*` is the one path that still calls `execute`/`fetch` directly — it
 *  needs raw rows for computed-field evaluation, not an inferred schema. */
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
        val source = SqlSource(
          id        = DataSourceId(UUID.randomUUID().toString),
          name      = request.name,
          ownerId   = user.id,
          createdAt = now,
          updatedAt = now,
          config    = sqlConfig
        )
        dataSourceRepo.insert(source, user).flatMap { inserted =>
          SqlConnector.inferSchema(sqlConfig).flatMap {
            case Left(err) =>
              Future.successful(Right(CreateSourceResponse(
                source     = DataSourceResponse.fromDomain(inserted),
                dataType   = None,
                fetchError = Some(err)
              )))
            case Right(schema) =>
              val fields = SchemaInferenceFacade.toDataFields(schema)
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
              dataTypeRepo.insert(dt, user).map { createdDt =>
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
        if (request.`type` != DataSourceKind.RestApi)
          Future.successful(Left(ServiceError.BadRequest(s"Expected type='${DataSourceKind.RestApi}', got '${request.`type`}'")))
        else {
          val now = Instant.now()
          val source = RestSource(
            id        = DataSourceId(UUID.randomUUID().toString),
            name      = request.name,
            ownerId   = user.id,
            createdAt = now,
            updatedAt = now,
            config    = restConfig
          )
          dataSourceRepo.insert(source, user).flatMap { inserted =>
            connector.inferSchema(restConfig).flatMap {
              case Left(err) =>
                Future.successful(Right(CreateSourceResponse(
                  source     = DataSourceResponse.fromDomain(inserted),
                  dataType   = None,
                  fetchError = Some(err)
                )))
              case Right(schema) =>
                val overridesMap = request.fieldOverrides.getOrElse(Vector.empty).map(o => o.name -> o).toMap
                val fields = SchemaInferenceFacade.toDataFields(schema, overridesMap)
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
                dataTypeRepo.insert(dt, user).map { createdDt =>
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
        SqlConnector.inferSchema(sqlConfig).map {
          case Left(err)     => Left(ServiceError.BadGateway(err))
          case Right(schema) => Right(toInferredSchema(schema))
        }
    }
  }

  def inferRest(payload: RestApiConfigPayload): Future[Either[ServiceError, InferredSchemaResponse]] =
    RestApiConfigPayload.toDomain(payload) match {
      case Left(err) =>
        Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(restConfig) =>
        connector.inferSchema(restConfig).map {
          case Left(err)     => Left(ServiceError.BadGateway(err))
          case Right(schema) => Right(toInferredSchema(schema))
        }
    }

  // ── Refresh ───────────────────────────────────────────────────────────────

  def refresh(sourceId: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, DataType]] =
    dataSourceRepo.findByIdOwned(sourceId, user).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("DataSource not found")))
      case Some(s: SqlSource) =>
        refreshSql(s, user)
      case Some(r: RestSource) =>
        refreshRest(r, user)
      case Some(_) =>
        Future.successful(Left(ServiceError.BadRequest("refresh is only supported for rest_api and sql sources via this endpoint")))
    }

  private def refreshSql(source: SqlSource, user: AuthenticatedUser): Future[Either[ServiceError, DataType]] =
    SqlConnector.inferSchema(source.config).flatMap {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (SqlConnector logs the raw JDBC cause server-side) — pass through
        // as-is rather than double-wrapping with a redundant prefix.
        Future.successful(Left(ServiceError.BadGateway(err)))
      case Right(schema) =>
        val now    = Instant.now()
        val fields = SchemaInferenceFacade.toDataFields(schema)
        upsertDataType(source, fields, now, bumpVersion = true, user).map {
          case Some(dt) => Right(dt)
          case None     => Left(ServiceError.NotFound("DataType not found"))
        }
    }

  private def refreshRest(source: RestSource, user: AuthenticatedUser): Future[Either[ServiceError, DataType]] =
    connector.inferSchema(source.config).flatMap {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (RestApiConnector logs the raw cause server-side) — pass through
        // as-is rather than double-wrapping with a redundant prefix.
        Future.successful(Left(ServiceError.BadGateway(err)))
      case Right(schema) =>
        val now    = Instant.now()
        val fields = SchemaInferenceFacade.toDataFields(schema)
        upsertDataType(source, fields, now, bumpVersion = false, user).map {
          case Some(dt) => Right(dt)
          case None     => Left(ServiceError.NotFound("DataType not found"))
        }
    }

  // ── Preview ───────────────────────────────────────────────────────────────

  def preview(sourceId: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, PreviewSourceResponse]] =
    dataSourceRepo.findByIdOwned(sourceId, user).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("DataSource not found")))
      case Some(s: SqlSource) =>
        previewSql(s, user)
      case Some(r: RestSource) =>
        previewRest(r, user)
      case Some(_) =>
        Future.successful(Left(ServiceError.BadRequest("preview is only supported for rest_api and sql sources via this endpoint")))
    }

  private def previewSql(source: SqlSource, user: AuthenticatedUser): Future[Either[ServiceError, PreviewSourceResponse]] =
    SqlConnector.execute(source.config, maxRows = 10).flatMap {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (SqlConnector logs the raw JDBC cause server-side) — pass through
        // as-is rather than double-wrapping with a redundant prefix.
        Future.successful(Left(ServiceError.BadGateway(err)))
      case Right(rows) =>
        dataTypeRepo.findBySourceId(source.id, user.id).map { dataTypes =>
          val computedFields          = dataTypes.headOption.map(_.computedFields).getOrElse(Vector.empty)
          val rawRows                 = SqlConnector.toRows(rows)
          val (augmented, evalErrors) = applyComputedFields(rawRows, computedFields)
          Right(PreviewSourceResponse(augmented, evalErrors))
        }
    }

  private def previewRest(source: RestSource, user: AuthenticatedUser): Future[Either[ServiceError, PreviewSourceResponse]] =
    connector.fetch(source.config).flatMap {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (RestApiConnector logs the raw cause server-side) — pass through
        // as-is rather than double-wrapping with a redundant prefix.
        Future.successful(Left(ServiceError.BadGateway(err)))
      case Right(json) =>
        val rawRows = connector.toRows(json).take(10)
        dataTypeRepo.findBySourceId(source.id, user.id).map { dataTypes =>
          val computedFields = dataTypes.headOption.map(_.computedFields).getOrElse(Vector.empty)
          val (rows, evalErrors) = applyComputedFields(rawRows, computedFields)
          Right(PreviewSourceResponse(rows, evalErrors))
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
          dataTypeRepo.update(updated, user)
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
          dataTypeRepo.insert(dt, user).map(Some(_))
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
