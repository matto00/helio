package com.helio.services.sources

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.domain.connectors.{ConnectorResolveContext, SqlConnectorDriver}
import com.helio.domain.engine.{ExpressionEvaluator, JsonFlattener}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.api.protocols.sources.{CreateSourceRequest, CreateSourceResponse, PreviewSourceResponse, RestApiConfigPayload, SqlCreateSourceRequest, SqlInferRequest, SqlSourceConfigPayload, TestConnectionResponse}
import com.helio.api.protocols.pipelines.{InferredFieldResponse, InferredSchemaResponse}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.persistence.pipelines.DataTypeRepository
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for REST + SQL data sources.
 *
 *  CRUD for `/api/sources` plus connector preview / infer / refresh. CSV +
 *  Static live in [[DataSourceService]] (the route surfaces are also split
 *  along that boundary). Connector primitives (`RestApiConnectorDriver.fetch`,
 *  `SqlConnectorDriver.execute`) stay in `domain/`; the service just orchestrates.
 *
 *  Create/infer/refresh dispatch through each connector's `ConnectorDriver[Config].inferSchema`
 *  SPI method (HEL-449/HEL-473) rather than hand-rolling `execute`/`fetch` + inline inference;
 *  `SchemaInferenceFacade.toDataFields` is the single `InferredField` → `DataField` projection
 *  they all share. `preview*` is the one path that still calls `execute`/`fetch` directly — it
 *  needs raw rows for computed-field evaluation, not an inferred schema. */
final class SourceService(
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo:   DataTypeRepository,
    connector:      RestApiConnectorDriver,
    // HEL-477: nullable-optional wiring mirrors this file's other DI.
    auditService: AuditService = null,
    // HEL-822: nullable-optional wiring mirrors auditService above. Required only for the
    // legacy-`url` dual-support create path (task 1.2a), which synthesizes an implicit
    // Connector — a null connectorRepo degrades that one path to a curated 500 (task 1.2a
    // has no repository to persist the synthesized Connector through), never a silent no-op.
    connectorRepo: ConnectorRepository = null
)(implicit ec: ExecutionContext) {

  private def audit(resourceId: Option[String], user: AuthenticatedUser, action: String = "data_source.create"): Unit =
    if (auditService != null)
      // HEL-477 design.md Decision 8: same data_source.create action as
      // DataSourceService's create variants — both produce the same
      // DataSource domain type.
      auditService.record(Some(user.id), user.tokenId, user.source, action, "data_source", resourceId, JsObject.empty)


  def createSql(request: SqlCreateSourceRequest, user: AuthenticatedUser): Future[Either[ServiceError, CreateSourceResponse]] = {
    val sqlConfig = SqlSourceConfigPayload.toDomain(request.config)
    SqlConnectorDriver.checkQuery(sqlConfig.query) match {
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
          CreateSourceEnvelope.build(SqlConnectorDriver, sqlConfig, inserted, now, dataTypeRepo, user).map { response =>
            audit(Some(inserted.id.value), user)
            Right(response)
          }
        }
    }
  }

  def createRest(request: CreateSourceRequest, user: AuthenticatedUser): Future[Either[ServiceError, CreateSourceResponse]] =
    if (request.`type` != DataSourceKind.RestApi)
      Future.successful(Left(ServiceError.BadRequest(s"Expected type='${DataSourceKind.RestApi}', got '${request.`type`}'")))
    else if (request.config.auth.isDefined)
      Future.successful(Left(ServiceError.BadRequest("auth is not accepted on a REST source — auth lives on the referenced Connector")))
    else
      (request.config.connectorId, request.config.url) match {
        case (Some(_), Some(_)) =>
          Future.successful(Left(ServiceError.BadRequest("provide exactly one of connectorId or url")))
        case (None, None) =>
          Future.successful(Left(ServiceError.BadRequest("Missing required fields: connectorId or url")))
        case (Some(_), None) =>
          RestApiConfigPayload.toDomain(request.config) match {
            case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
            case Right(restConfig) =>
              // HEL-826 design.md Decision 3 — belt-and-braces create-time UX check; the
              // authoritative guard lives at buildResolvedRequest/buildEphemeralRequest.
              RestApiConfig.rejectBodyOnSafeMethod(restConfig.method, restConfig.body) match {
                case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
                case Right(())  => createRestWithConfig(request, restConfig, user)
              }
          }
        case (None, Some(url)) =>
          // HEL-822 design.md Decision 1 (revised, round-2 CR4): a bare-`url` create
          // synthesizes an implicit no-auth Connector via the shared `ImplicitConnectorConfig`
          // helper, persisted through `ConnectorRepository.create` directly (not
          // `ConnectorEntityService.create` — there is no incoming `ConnectorCreateRequest` to
          // validate for a server-synthesized value), still inside the request's existing
          // `AuthenticatedUser` context.
          if (connectorRepo == null)
            Future.successful(Left(ServiceError.BadRequest("REST sources require a Connector; legacy url-only create is unavailable")))
          else
            // HEL-826 evaluation-1.md cycle-2 CR1: the belt-and-braces
            // rejectBodyOnSafeMethod check must run BEFORE connectorRepo.create — otherwise a
            // rejected GET+body request still persists an orphaned implicit Connector row
            // (including an encrypted-credential write) before being rejected. Checked here,
            // against the raw request payload, before any persistence occurs.
            RestApiConfig.rejectBodyOnSafeMethod(request.config.method.getOrElse("GET"), request.config.body) match {
              case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
              case Right(()) =>
                val (baseUrl, endpoint, _, _) = RestSourceConnectorMigration.splitUrl(url)
                val (name, configJson, credentialPlaintext, credentialName) =
                  ImplicitConnectorConfig.forLegacySource(s"Auto: ${request.name}", baseUrl, RestApiAuth.NoAuth)
                connectorRepo
                  .create(
                    ownerId             = user.id,
                    name                = name,
                    kind                = DataSourceKind.RestApi,
                    baseUrl             = baseUrl,
                    config              = configJson,
                    credentialPlaintext = credentialPlaintext,
                    credentialName      = credentialName
                  )
                  .flatMap { createdConnector =>
                    val restConfig = RestApiConfig(
                      connectorId     = createdConnector.id.value,
                      endpoint        = endpoint,
                      method          = request.config.method.getOrElse("GET"),
                      headers         = request.config.headers.getOrElse(Map.empty),
                      body            = request.config.body,
                      bodyContentType = request.config.bodyContentType,
                      rootSelector    = request.config.rootSelector
                    )
                    createRestWithConfig(request, restConfig, user)
                  }
            }
      }

  private def createRestWithConfig(request: CreateSourceRequest, restConfig: RestApiConfig, user: AuthenticatedUser): Future[Either[ServiceError, CreateSourceResponse]] = {
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
      val overridesMap = request.fieldOverrides.getOrElse(Vector.empty).map(o => o.name -> o).toMap
      CreateSourceEnvelope.build(connector, restConfig, inserted, now, dataTypeRepo, user, overridesMap).map { response =>
        audit(Some(inserted.id.value), user)
        Right(response)
      }
    }
  }


  def inferSql(request: SqlInferRequest): Future[Either[ServiceError, InferredSchemaResponse]] = {
    val sqlConfig = SqlSourceConfigPayload.toDomain(request.config)
    SqlConnectorDriver.checkQuery(sqlConfig.query) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(_) =>
        SqlConnectorDriver.inferSchema(sqlConfig, ConnectorResolveContext.Internal).map {
          case Left(err)     => Left(ServiceError.BadGateway(err))
          case Right(schema) => Right(toInferredSchema(schema))
        }
    }
  }

  /** HEL-822 design.md Decision 1c: a `connectorId`-carrying request resolves the real
   *  Connector, ownership-scoped (`user`, task 2a.1/2a.3) — never persisting anything new. A
   *  bare-`url` request (no `connectorId`) resolves ephemerally instead (task 2a.2) — never a
   *  Connector round-trip, the trap round-2 CR2 flagged (a new `connectors` row on every
   *  "Preview schema" click). */
  def inferRest(payload: RestApiConfigPayload, user: AuthenticatedUser): Future[Either[ServiceError, InferredSchemaResponse]] =
    if (payload.auth.isDefined)
      Future.successful(Left(ServiceError.BadRequest("auth is not accepted on a REST source — auth lives on the referenced Connector")))
    else (payload.connectorId, payload.url) match {
      case (Some(_), Some(_)) => Future.successful(Left(ServiceError.BadRequest("provide exactly one of connectorId or url")))
      case (None, None)       => Future.successful(Left(ServiceError.BadRequest("Missing required fields: connectorId or url")))
      case (Some(_), None) =>
        RestApiConfigPayload.toDomain(payload) match {
          case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
          case Right(restConfig) =>
            connector.inferSchema(restConfig, ConnectorResolveContext.Owned(user)).map {
              case Left(err)     => Left(ServiceError.BadGateway(err))
              case Right(schema) => Right(toInferredSchema(schema))
            }
        }
      case (None, Some(_)) =>
        toEphemeral(payload) match {
          case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
          case Right(ephemeral) =>
            connector.inferSchemaEphemeral(ephemeral).map {
              case Left(err)     => Left(ServiceError.BadGateway(err))
              case Right(schema) => Right(toInferredSchema(schema))
            }
        }
    }


  def testSql(request: SqlInferRequest): Future[Either[ServiceError, TestConnectionResponse]] = {
    val sqlConfig = SqlSourceConfigPayload.toDomain(request.config)
    SqlConnectorDriver.checkQuery(sqlConfig.query) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(_)  => ConnectionTest.run(SqlConnectorDriver, sqlConfig, ConnectorResolveContext.Internal).map(Right(_))
    }
  }

  def testRest(payload: RestApiConfigPayload, user: AuthenticatedUser): Future[Either[ServiceError, TestConnectionResponse]] =
    if (payload.auth.isDefined)
      Future.successful(Left(ServiceError.BadRequest("auth is not accepted on a REST source — auth lives on the referenced Connector")))
    else (payload.connectorId, payload.url) match {
      case (Some(_), Some(_)) => Future.successful(Left(ServiceError.BadRequest("provide exactly one of connectorId or url")))
      case (None, None)       => Future.successful(Left(ServiceError.BadRequest("Missing required fields: connectorId or url")))
      case (Some(_), None) =>
        RestApiConfigPayload.toDomain(payload) match {
          case Left(err)         => Future.successful(Left(ServiceError.BadRequest(err)))
          case Right(restConfig) => ConnectionTest.run(connector, restConfig, ConnectorResolveContext.Owned(user)).map(Right(_))
        }
      case (None, Some(_)) =>
        toEphemeral(payload) match {
          case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
          case Right(ephemeral) =>
            connector.testConnectionEphemeral(ephemeral).map {
              case Right(())  => Right(TestConnectionResponse(ok = true, error = None))
              case Left(err)  => Right(TestConnectionResponse(ok = false, error = Some(err)))
            }
        }
    }

  // HEL-826 task 2.3b: belt-and-braces guard mirroring the connectorId path's create-time
  // check (2.3) — the structural guard is buildEphemeralRequest (3.3), this is additive UX.
  private def toEphemeral(payload: RestApiConfigPayload): Either[String, EphemeralRestConfig] = {
    val method = payload.method.getOrElse("GET")
    val body   = payload.body
    RestApiConfig.rejectBodyOnSafeMethod(method, body).map { _ =>
      EphemeralRestConfig(
        url             = payload.url.getOrElse(""),
        method          = method,
        headers         = payload.headers.getOrElse(Map.empty),
        body            = body,
        bodyContentType = payload.bodyContentType,
        rootSelector    = payload.rootSelector
      )
    }
  }


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
    }.map {
      case r @ Right(_) =>
        audit(Some(sourceId.value), user, "data_source.refresh")
        r
      case l => l
    }

  private def refreshSql(source: SqlSource, user: AuthenticatedUser): Future[Either[ServiceError, DataType]] =
    SqlConnectorDriver.inferSchema(source.config, ConnectorResolveContext.Internal).flatMap {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (SqlConnectorDriver logs the raw JDBC cause server-side) — pass through
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
    connector.inferSchema(source.config, ConnectorResolveContext.Owned(user)).flatMap {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (RestApiConnectorDriver logs the raw cause server-side) — pass through
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
    SqlConnectorDriver.execute(source.config, maxRows = 10).flatMap {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (SqlConnectorDriver logs the raw JDBC cause server-side) — pass through
        // as-is rather than double-wrapping with a redundant prefix.
        Future.successful(Left(ServiceError.BadGateway(err)))
      case Right(rows) =>
        dataTypeRepo.findBySourceId(source.id, user.id).map { dataTypes =>
          val computedFields          = dataTypes.headOption.map(_.computedFields).getOrElse(Vector.empty)
          val rawRows                 = SqlConnectorDriver.toRows(rows)
          val (augmented, evalErrors) = applyComputedFields(rawRows, computedFields)
          Right(PreviewSourceResponse(augmented, evalErrors))
        }
    }

  private def previewRest(source: RestSource, user: AuthenticatedUser): Future[Either[ServiceError, PreviewSourceResponse]] =
    connector.fetch(source.config, ConnectorResolveContext.Owned(user)).flatMap {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (RestApiConnectorDriver logs the raw cause server-side) — pass through
        // as-is rather than double-wrapping with a redundant prefix.
        Future.successful(Left(ServiceError.BadGateway(err)))
      case Right(json) =>
        // HEL-599 design.md D5: this is the 4th `toRows` call site — a broken `rootSelector`
        // must surface here too, reusing the existing HEL-311 `BadGateway` pass-through rather
        // than a new error channel (this is the surface a user configuring a selector actually
        // looks at, so a silent empty success here is exactly the bug being fixed).
        connector.toRowsEither(json, source.config.rootSelector) match {
          case Left(err) => Future.successful(Left(ServiceError.BadGateway(err)))
          case Right(jsRows) =>
            // design.md D6: preview stays in `JsValue` space (never routes through
            // `jsRowToRow`), so it needs its own flatten to keep it in agreement with the
            // advertised schema and the executed rows — otherwise this fix would create a
            // *new* three-way divergence on a user-facing surface. Non-object rows (a bare
            // scalar/array REST root) pass through unchanged, same as `jsRowToRow`'s fallback.
            val normalizedRows: Vector[JsValue] = jsRows.take(10).map {
              case obj: JsObject => JsonFlattener.flattenJsObject(obj)
              case other         => other
            }
            dataTypeRepo.findBySourceId(source.id, user.id).map { dataTypes =>
              val computedFields = dataTypes.headOption.map(_.computedFields).getOrElse(Vector.empty)
              val (rows, evalErrors) = applyComputedFields(normalizedRows, computedFields)
              Right(PreviewSourceResponse(rows, evalErrors))
            }
        }
    }


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
