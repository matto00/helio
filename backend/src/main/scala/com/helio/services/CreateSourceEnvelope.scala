package com.helio.services

import com.helio.api.protocols.{CreateSourceResponse, DataSourceResponse, DataTypeResponse, FieldOverridePayload}
import com.helio.domain.{AuthenticatedUser, Connector, DataSource, DataType, DataTypeId}
import com.helio.infrastructure.DataTypeRepository

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Shared create-time envelope construction (HEL-468), replacing the two structurally-identical
 *  copies that used to live inline in `SourceService.createSql`/`createRest`. Generic over any
 *  `Connector[Config]` implementation (HEL-449's SPI) — a connector gets a correct, diagnosable
 *  `CreateSourceResponse` by construction, with no per-connector envelope logic needed. See
 *  `Connector.scala`'s trait doc comment ("Fetch-error envelope" block) for the contract this
 *  implements, and `SchemaInferenceFacade` for the sibling HEL-473 precedent this follows for
 *  layering (services/, not domain/, because `CreateSourceResponse`/`AuthenticatedUser` are
 *  api-protocol/infrastructure-adjacent types domain must never depend on). */
object CreateSourceEnvelope {

  /** Calls `connector.inferSchema(config)` and builds the `CreateSourceResponse` envelope:
   *  `Left(err)` forwards `err` unmodified into `fetchError` (no re-wrapping, re-prefixing, or
   *  truncation — HEL-311 curation already happened inside the connector's `inferSchema`); `Right
   *  (schema)` projects fields via `SchemaInferenceFacade.toDataFields`, persists a new `DataType`
   *  at `version = 1`, and returns it wrapped with `fetchError = None`. `now` is threaded in
   *  (rather than computed fresh here) so the inserted `DataSource`'s timestamps and the new
   *  `DataType`'s `createdAt`/`updatedAt` share the exact same instant, matching the pre-refactor
   *  behavior exactly. */
  def build[Config](
      connector:    Connector[Config],
      config:       Config,
      source:       DataSource,
      now:          Instant,
      dataTypeRepo: DataTypeRepository,
      user:         AuthenticatedUser,
      overrides:    Map[String, FieldOverridePayload] = Map.empty
  )(implicit ec: ExecutionContext): Future[CreateSourceResponse] =
    connector.inferSchema(config).flatMap {
      case Left(err) =>
        Future.successful(CreateSourceResponse(
          source     = DataSourceResponse.fromDomain(source),
          dataType   = None,
          fetchError = Some(err)
        ))
      case Right(schema) =>
        val fields = SchemaInferenceFacade.toDataFields(schema, overrides)
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
        dataTypeRepo.insert(dt, user).map { createdDt =>
          CreateSourceResponse(
            source     = DataSourceResponse.fromDomain(source),
            dataType   = Some(DataTypeResponse.fromDomain(createdDt)),
            fetchError = None
          )
        }
    }
}
