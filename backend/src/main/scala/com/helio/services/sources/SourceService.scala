package com.helio.services.sources

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.domain.connectors.{ConnectorResolveContext, SqlConnectorDriver}
import com.helio.domain.engine.{JsonFlattener, SchemaField}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.api.protocols.sources.{CreateSourceRequest, CreateSourceResponse, InferredFieldResponse, InferredSchemaResponse, PreviewSourceResponse, RestApiConfigPayload, SqlCreateSourceRequest, SqlInferRequest, SqlSourceConfigPayload, TestConnectionResponse}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import spray.json._

import java.net.InetAddress
import java.time.Instant
import java.util.UUID
import org.slf4j.LoggerFactory

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

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
    connector:      RestApiConnectorDriver,
    // HEL-477: nullable-optional wiring mirrors this file's other DI.
    auditService: AuditService = null,
    // HEL-822: nullable-optional wiring mirrors auditService above. Required only for the
    // legacy-`url` dual-support create path (task 1.2a), which synthesizes an implicit
    // Connector — a null connectorRepo degrades that one path to a curated 500 (task 1.2a
    // has no repository to persist the synthesized Connector through), never a silent no-op.
    connectorRepo: ConnectorRepository = null,
    // HEL-952 design.md Decision 4a: threaded to every SQL-path call this class makes
    // (`SqlConnectorDriver`/`CreateSourceEnvelope.build`/`ConnectionTest.run`) — real DNS/denylist
    // in production (never overridden by `Main.scala`); a test admits a known test hostname
    // without weakening the guard for any other host, mirroring `connector`'s own
    // instance-level resolveHost/isBlocked for REST.
    val sqlResolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
    val sqlIsBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr)
)(implicit ec: ExecutionContext) {

  private def audit(resourceId: Option[String], user: AuthenticatedUser, action: String = "data_source.create"): Unit =
    if (auditService != null)
      // HEL-477 design.md Decision 8: same data_source.create action as
      // DataSourceService's create variants — both produce the same
      // DataSource domain type.
      auditService.record(Some(user.id), user.tokenId, user.source, action, "data_source", resourceId, JsObject.empty)


  private val log = LoggerFactory.getLogger(classOf[SourceService])

  /** HEL-1475: lets `PipelineService` build its [[InlineSourceCleanup]] over the SAME connector repository this service
   *  synthesizes implicit Connectors through. */
  private[services] def connectorRepository: ConnectorRepository = connectorRepo

  /** HEL-1475: `body` runs after `dataSourceRepo.insert` committed and the new id has not reached any caller, so a
   *  failed Future leaves a row nothing can ever clean up. Deletes it (repository-level, as the user -- nothing can
   *  reference an id that was never returned) and re-raises the ORIGINAL failure; a cleanup failure is logged and
   *  never replaces it. A `Left`/`fetchError` result is a success, not a failure, and keeps the source. */
  private def cleaningUpOnFailure[T](inserted: DataSource, user: AuthenticatedUser)(body: => Future[T]): Future[T] =
    Future.unit.flatMap(_ => body).transformWith {
      case Success(value) => Future.successful(value)
      case Failure(ex) =>
        Future.unit.flatMap(_ => dataSourceRepo.delete(inserted.id, user)).transform { cleanup =>
          cleanup.failed.foreach(e => log.warn(s"create cleanup failed to delete source ${inserted.id.value}: ${e.getMessage}"))
          Failure(ex)
        }
    }

  /** HEL-1638: createSql's pre-insert checks (query shape, config shape, create-time egress), extracted so the propose-time
   *  dry run runs the SAME function `createSql` calls. Disallowed/Invalid are fatal, Unresolvable is tolerated (HEL-952
   *  design.md Decision 3); the connect-time guard remains the actual security boundary. */
  private[services] def validateSqlCreate(request: SqlCreateSourceRequest): Either[ServiceError, SqlSourceConfig] = {
    val sqlConfig = SqlSourceConfigPayload.toDomain(request.config)
    SqlConnectorDriver.checkQuery(sqlConfig.query).flatMap(_ => SqlConnectorDriver.validateConfigShape(sqlConfig))
      .left.map(ServiceError.BadRequest(_))
      .flatMap(_ => SqlConnectorDriver.checkConfigEgress(sqlConfig, sqlResolveHost, sqlIsBlocked, failOnUnresolvable = false).left.map(ServiceError.BadRequest(_)))
      .map(_ => sqlConfig)
  }

  def createSql(request: SqlCreateSourceRequest, user: AuthenticatedUser): Future[Either[ServiceError, CreateSourceResponse]] =
    validateSqlCreate(request) match {
      case Left(err) =>
        Future.successful(Left(err))
      case Right(sqlConfig) =>
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
          cleaningUpOnFailure(inserted, user) {
            CreateSourceEnvelope.build(SqlConnectorDriver, sqlConfig, inserted, now, dataSourceRepo, user, resolveHost = sqlResolveHost, isBlocked = sqlIsBlocked).map { response =>
              audit(Some(inserted.id.value), user)
              Right(response)
            }
          }
        }
    }


  /** HEL-1638: createRest's pre-insert checks (auth reject, connectorId xor url, `toDomain`, `rejectBodyOnSafeMethod`,
   *  `checkConnectorKind`, `checkConnectorPending`) and the config build (url split + `queryParams` merge + `parameters`),
   *  extracted so `createRest` and the propose-time dry run share one function. Persists nothing. */
  private[services] def validateRestCreate(request: CreateSourceRequest, user: AuthenticatedUser): Future[Either[ServiceError, SourceService.RestCreatePlan]] =
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
                case Right(()) => checkConnectorKind(restConfig.connectorId, user).flatMap {
                  case Left(err) => Future.successful(Left(err))
                  case Right(()) => checkConnectorPending(restConfig.connectorId, user).map {
                    case Left(err) => Left(err)
                    case Right(()) => Right(SourceService.RestCreatePlan(restConfig, implicitBaseUrl = None))
                  }
                }
              }
          }
        case (None, Some(url)) =>
          // HEL-822 design.md Decision 1 (revised, round-2 CR4): a bare-`url` create synthesizes an implicit no-auth
          // Connector (persisted by `createRest`, built unpersisted by the dry run).
          if (connectorRepo == null)
            Future.successful(Left(ServiceError.BadRequest("REST sources require a Connector; legacy url-only create is unavailable")))
          else
            // HEL-826 evaluation-1.md cycle-2 CR1: the belt-and-braces rejectBodyOnSafeMethod check must run BEFORE
            // anything is persisted — otherwise a rejected GET+body request still persists an orphaned implicit Connector.
            RestApiConfig.rejectBodyOnSafeMethod(request.config.method.getOrElse("GET"), request.config.body) match {
              case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
              case Right(()) =>
                val (baseUrl, endpoint, urlQueryParams) = RestSourceConnectorMigration.splitUrl(url)
                // HEL-844 design.md D6a: the pairs `splitUrl` pulled off the bare URL's own query string are carried
                // through (concatenated with any explicit `request.config.queryParams`).
                val urlAndConfigQueryParams =
                  QueryParams(urlQueryParams.pairs ++ request.config.queryParams.map(_.pairs).getOrElse(Vector.empty))
                val restConfig = RestApiConfig(
                  connectorId     = "",
                  endpoint        = endpoint,
                  method          = request.config.method.getOrElse("GET"),
                  queryParams     = urlAndConfigQueryParams,
                  headers         = request.config.headers.getOrElse(Map.empty),
                  body            = request.config.body,
                  bodyContentType = request.config.bodyContentType,
                  rootSelector    = request.config.rootSelector,
                  // HEL-983: the caller-supplied HEL-823 template values must reach the persisted source.
                  parameters      = request.config.parameters.getOrElse(Map.empty)
                )
                Future.successful(Right(SourceService.RestCreatePlan(restConfig, implicitBaseUrl = Some(baseUrl))))
            }
      }

  def createRest(request: CreateSourceRequest, user: AuthenticatedUser): Future[Either[ServiceError, CreateSourceResponse]] =
    validateRestCreate(request, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(SourceService.RestCreatePlan(restConfig, None)) => createRestWithConfig(request, restConfig, user)
      case Right(SourceService.RestCreatePlan(planned, Some(baseUrl))) =>
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
            // HEL-1475: the Connector is committed BEFORE the source insert, so any failure from here on (the insert
            // itself, or createRestWithConfig's own post-insert cleanup having already removed the source) must also
            // remove the Connector this call made. Source first, then Connector.
            Future.unit.flatMap(_ => createRestWithConfig(request, planned.copy(connectorId = createdConnector.id.value), user)).transformWith {
              case Success(result) => Future.successful(result)
              case Failure(ex) =>
                new ImplicitConnectorCleanup(dataSourceRepo, connectorRepo)
                  .deleteIfUnadoptedImplicit(createdConnector.id, user, "createRest cleanup")
                  .transform(_ => Failure(ex))
            }
          }
    }


  /** HEL-1638: dry run of `createRest` for an inline REST root: its pre-insert checks, then `beforeFetch` (the C12 source-
   *  fetch budget; a `Left` refuses with no fetch), then the schema inferred through ONE request composition
   *  ([[RestApiConnectorDriver.inferSchemaForConnector]]) from the unpersisted Auto connector (url) or the owned connector
   *  (connectorId). Persists nothing. */
  def dryRunRestSchema(request: CreateSourceRequest, user: AuthenticatedUser, beforeFetch: () => Either[ServiceError, Unit]): Future[Either[ServiceError, SourceService.InlineDryRunSchema]] =
    validateRestCreate(request, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(plan) =>
        beforeFetch() match {
          case Left(err) => Future.successful(Left(err))
          case Right(()) =>
            val resolved: Future[Option[(RestApiConfig, Connector, String)]] = plan.implicitBaseUrl match {
              case Some(baseUrl) =>
                val (name, configJson, credentialPlaintext, _) = ImplicitConnectorConfig.forLegacySource(s"Auto: ${request.name}", baseUrl, RestApiAuth.NoAuth)
                val now = Instant.now()
                val auto = Connector(ConnectorId(UUID.randomUUID().toString), user.id, name, DataSourceKind.RestApi, baseUrl, configJson, None, now, now)
                Future.successful(Some((plan.config.copy(connectorId = auto.id.value), auto, credentialPlaintext)))
              case None =>
                // The owned connector: `validateRestCreate` just proved it exists, is rest_api and not pending.
                connectorRepo.findByIdOwned(ConnectorId(plan.config.connectorId), user).map(_.map(c => (plan.config, c, "")))
            }
            resolved.flatMap {
              case None => Future.successful(Right(SourceService.InlineDryRunSchema(Vector.empty, Some("Connector not found"))))
              case Some((config, conn, credential)) =>
                (if (plan.implicitBaseUrl.isDefined) connector.inferSchemaForConnector(config, conn, credential)
                 else connector.inferSchemaForResolvedConnector(config, conn)).map {
                  case Left(err) => Right(SourceService.InlineDryRunSchema(Vector.empty, Some(err)))
                  case Right(schema) =>
                    Right(SourceService.InlineDryRunSchema(SchemaInferenceFacade.toSchemaFields(schema, request.fieldOverrides.getOrElse(Vector.empty).map(o => o.name -> o).toMap), None))
                }
            }
        }
    }

  /** HEL-1638: dry run of `createSql` for an inline SQL root: `validateSqlCreate`, `beforeFetch`, then the same
   *  `inferSchema` call `CreateSourceEnvelope.build` makes, projected through the same `toSchemaFields`. */
  def dryRunSqlSchema(request: SqlCreateSourceRequest, user: AuthenticatedUser, beforeFetch: () => Either[ServiceError, Unit]): Future[Either[ServiceError, SourceService.InlineDryRunSchema]] =
    validateSqlCreate(request).flatMap(sqlConfig => beforeFetch().map(_ => sqlConfig)) match {
      case Left(err) => Future.successful(Left(err))
      case Right(sqlConfig) =>
        SqlConnectorDriver.inferSchema(sqlConfig, ConnectorResolveContext.Owned(user), sqlResolveHost, sqlIsBlocked).map {
          case Left(err)     => Right(SourceService.InlineDryRunSchema(Vector.empty, Some(err)))
          case Right(schema) => Right(SourceService.InlineDryRunSchema(SchemaInferenceFacade.toSchemaFields(schema), None))
        }
    }

  /** HEL-845 design.md Decision 2a: the create-time guarantee against binding a REST source to
   *  a non-`rest_api` Connector. Owner-scoped (`findByIdOwned`) so it cannot be used as an
   *  existence oracle for another tenant's Connector id. Decision 4: `connectorRepo == null`
   *  fails closed — a request carrying a `connectorId` is rejected rather than let through
   *  unchecked, so "the check didn't run" can never look like "the check passed". */
  private def checkConnectorKind(connectorId: String, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    if (connectorRepo == null)
      Future.successful(Left(ServiceError.BadRequest("REST sources require a Connector; the Connector service is unavailable")))
    else
      connectorRepo.findByIdOwned(ConnectorId(connectorId), user).map {
        case None => Left(ServiceError.BadRequest("Connector not found"))
        case Some(c) if c.kind != DataSourceKind.RestApi =>
          Left(ServiceError.BadRequest(
            s"Connector ${c.name} is a '${c.kind}' Connector; a REST source requires a '${DataSourceKind.RestApi}' Connector"
          ))
        case Some(_) => Right(())
      }

  /** HEL-955 design.md D4/task 3.2: a SEPARATE check from [[checkConnectorKind]] above --
   *  deliberately not folded in -- so a pending Connector of the correct kind is still refused
   *  at create time, independent of whether the kind guard is ever touched again. Owner-scoped
   *  via `findByIdOwned`, same as `checkConnectorKind`, so it cannot be used as an existence
   *  oracle for another tenant's Connector id. The `RestApiConnectorDriver.resolveConnector`
   *  guard remains authoritative (design.md D4) -- this is belt-and-braces at create time. */
  private def checkConnectorPending(connectorId: String, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    if (connectorRepo == null)
      Future.successful(Left(ServiceError.BadRequest("REST sources require a Connector; the Connector service is unavailable")))
    else
      connectorRepo.findByIdOwned(ConnectorId(connectorId), user).map {
        case Some(c) if c.isPending =>
          Left(ServiceError.BadRequest(
            s"Connector ${c.name} is pending completion; a human must supply its credential before it can be used"
          ))
        case _ => Right(())
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
      cleaningUpOnFailure(inserted, user) {
        val overridesMap = request.fieldOverrides.getOrElse(Vector.empty).map(o => o.name -> o).toMap
        CreateSourceEnvelope.build(connector, restConfig, inserted, now, dataSourceRepo, user, overridesMap).map { response =>
          audit(Some(inserted.id.value), user)
          Right(response)
        }
      }
    }
  }


  def inferSql(request: SqlInferRequest): Future[Either[ServiceError, InferredSchemaResponse]] = {
    val sqlConfig = SqlSourceConfigPayload.toDomain(request.config)
    SqlConnectorDriver.checkQuery(sqlConfig.query).flatMap(_ => SqlConnectorDriver.validateConfigShape(sqlConfig)) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(_) =>
        SqlConnectorDriver.inferSchema(sqlConfig, ConnectorResolveContext.Internal, sqlResolveHost, sqlIsBlocked).map {
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
    SqlConnectorDriver.checkQuery(sqlConfig.query).flatMap(_ => SqlConnectorDriver.validateConfigShape(sqlConfig)) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(_)  => ConnectionTest.run(SqlConnectorDriver, sqlConfig, ConnectorResolveContext.Internal, sqlResolveHost, sqlIsBlocked).map(Right(_))
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


  /** HEL-904 (design.md line 92): returns the refreshed `DataSource` itself (its
   *  `inferredSchema` column now carries the re-inferred fields) rather than a
   *  companion `DataType` — there is no companion type anymore. */
  def refresh(sourceId: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
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

  private def refreshSql(source: SqlSource, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    SqlConnectorDriver.inferSchema(source.config, ConnectorResolveContext.Internal, sqlResolveHost, sqlIsBlocked).flatMap {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (SqlConnectorDriver logs the raw JDBC cause server-side) — pass through
        // as-is rather than double-wrapping with a redundant prefix.
        Future.successful(Left(ServiceError.BadGateway(err)))
      case Right(schema) =>
        val now = Instant.now()
        upsertInferredSchema(source, schema, now, user).map {
          case Some(ds) => Right(ds)
          case None     => Left(ServiceError.NotFound("Data source not found"))
        }
    }

  private def refreshRest(source: RestSource, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    connector.inferSchema(source.config, ConnectorResolveContext.Owned(user)).flatMap {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (RestApiConnectorDriver logs the raw cause server-side) — pass through
        // as-is rather than double-wrapping with a redundant prefix.
        Future.successful(Left(ServiceError.BadGateway(err)))
      case Right(schema) =>
        val now = Instant.now()
        upsertInferredSchema(source, schema, now, user).map {
          case Some(ds) => Right(ds)
          case None     => Left(ServiceError.NotFound("Data source not found"))
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
    SqlConnectorDriver.execute(source.config, maxRows = 10, sqlResolveHost, sqlIsBlocked).map {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (SqlConnectorDriver logs the raw JDBC cause server-side) — pass through
        // as-is rather than double-wrapping with a redundant prefix.
        Left(ServiceError.BadGateway(err))
      case Right(rows) =>
        // HEL-904: companion-type computed fields are retired (ticket.md item 8 — "the
        // computed_fields concept is deleted"); preview no longer evaluates them.
        Right(PreviewSourceResponse(SqlConnectorDriver.toRows(rows), Vector.empty))
    }

  private def previewRest(source: RestSource, user: AuthenticatedUser): Future[Either[ServiceError, PreviewSourceResponse]] =
    connector.fetch(source.config, ConnectorResolveContext.Owned(user)).map {
      case Left(err) =>
        // HEL-311: `err` is already a generic, curated category message
        // (RestApiConnectorDriver logs the raw cause server-side) — pass through
        // as-is rather than double-wrapping with a redundant prefix.
        Left(ServiceError.BadGateway(err))
      case Right(json) =>
        // HEL-599 design.md D5: this is the 4th `toRows` call site — a broken `rootSelector`
        // must surface here too, reusing the existing HEL-311 `BadGateway` pass-through rather
        // than a new error channel (this is the surface a user configuring a selector actually
        // looks at, so a silent empty success here is exactly the bug being fixed).
        connector.toRowsEither(json, source.config.rootSelector) match {
          case Left(err) => Left(ServiceError.BadGateway(err))
          case Right(jsRows) =>
            // design.md D6: preview stays in `JsValue` space (never routes through
            // `jsRowToRow`), so it needs its own flatten to keep it in agreement with the
            // advertised schema and the executed rows — otherwise this fix would create a
            // *new* three-way divergence on a user-facing surface. Non-object rows (a bare
            // scalar/array REST root) pass through unchanged, same as `jsRowToRow`'s fallback.
            //
            // HEL-1015 design D1/D6: classify over the FULL `jsRows` batch and only THEN
            // `take(10)` for display -- ordering, not logic. Classifying over the 10 displayed
            // rows would re-create the three-way divergence this comment already warns about,
            // because inference (`SchemaInferenceEngine`) always classifies over the full batch.
            val mapPaths = JsonFlattener.detectMapPaths(jsRows.collect { case o: JsObject => o })
            val normalizedRows: Vector[JsValue] = jsRows.take(10).map {
              case obj: JsObject => JsonFlattener.flattenJsObject(obj, mapPaths)
              case other         => other
            }
            // HEL-904: companion-type computed fields are retired (ticket.md item 8).
            Right(PreviewSourceResponse(normalizedRows, Vector.empty))
        }
    }


  /** HEL-904 (design.md line 92): writes the re-inferred schema straight onto the source's own
   *  `inferred_schema` column via `DataSourceRepository.upsertInferredSchema` — there is no
   *  companion `DataType` row to find-or-create anymore. */
  private def upsertInferredSchema(source: DataSource, schema: InferredSchema, now: Instant, user: AuthenticatedUser): Future[Option[DataSource]] =
    dataSourceRepo.upsertInferredSchema(source.id, SchemaInferenceFacade.toSchemaFields(schema), now, user)

  private def toInferredSchema(schema: InferredSchema): InferredSchemaResponse = {
    val fields = schema.fields.map(f =>
      InferredFieldResponse(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
    ).toVector
    InferredSchemaResponse(fields)
  }
}

object SourceService {
  /** HEL-1638: what `createRest` would persist, from its pre-insert checks. `implicitBaseUrl` is `Some` for a bare-`url`
   *  request (the config's `connectorId` is then a placeholder `""`: `createRest` persists the Auto connector and fills it
   *  in; the dry run builds the unpersisted equivalent from the same `ImplicitConnectorConfig.forLegacySource`). */
  private[services] final case class RestCreatePlan(config: RestApiConfig, implicitBaseUrl: Option[String])

  /** HEL-1638: the inline source's schema as `create*` would persist it, for the propose-time dry run. `schema` is empty
   *  and `fetchError` set when the fetch failed (apply keeps such a source with an empty schema). */
  final case class InlineDryRunSchema(schema: Vector[SchemaField], fetchError: Option[String])
}
