package com.helio.services.sources

import com.helio.api.protocols.sources.{CreateSourceResponse, DataSourceResponse, FieldOverridePayload, InferredFieldResponse, InferredSchemaResponse}
import com.helio.domain.model.{AuthenticatedUser, DataFieldType, DataSource, InferredSchema}
import com.helio.domain.connectors.{ConnectorDriver, ConnectorResolveContext}
import com.helio.domain.engine.InProcessPipelineEngine
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Shared create-time envelope construction (HEL-468), replacing the two structurally-identical
 *  copies that used to live inline in `SourceService.createSql`/`createRest`. Generic over any
 *  `ConnectorDriver[Config]` implementation (HEL-449's SPI) — a connector gets a correct, diagnosable
 *  `CreateSourceResponse` by construction, with no per-connector envelope logic needed. See
 *  `ConnectorDriver.scala`'s trait doc comment ("Fetch-error envelope" block) for the contract this
 *  implements, and `SchemaInferenceFacade` for the sibling HEL-473 precedent this follows for
 *  layering (services/, not domain/, because `CreateSourceResponse`/`AuthenticatedUser` are
 *  api-protocol/infrastructure-adjacent types domain must never depend on). */
object CreateSourceEnvelope {

  /** Calls `connector.inferSchema(config)` and builds the `CreateSourceResponse` envelope:
   *  `Left(err)` forwards `err` unmodified into `fetchError` (no re-wrapping, re-prefixing, or
   *  truncation — HEL-311 curation already happened inside the connector's `inferSchema`); `Right
   *  (schema)` projects fields via `SchemaInferenceFacade.toSchemaFields`, writes them straight
   *  onto the source's own `inferred_schema` column (`DataSourceRepository.upsertInferredSchema`,
   *  HEL-904 — no companion `DataType` row anymore), and returns the envelope wrapped with
   *  `fetchError = None`. `now` is threaded in (rather than computed fresh here) so the inserted
   *  `DataSource`'s timestamps and the schema write share the exact same instant, matching the
   *  pre-refactor behavior exactly. */
  def build[Config](
      connector:      ConnectorDriver[Config],
      config:         Config,
      source:         DataSource,
      now:            Instant,
      dataSourceRepo: DataSourceRepository,
      user:           AuthenticatedUser,
      overrides:      Map[String, FieldOverridePayload] = Map.empty
  )(implicit ec: ExecutionContext): Future[CreateSourceResponse] =
    connector.inferSchema(config, ConnectorResolveContext.Owned(user)).flatMap {
      case Left(err) =>
        Future.successful(CreateSourceResponse(
          source         = DataSourceResponse.fromDomain(source),
          inferredSchema = None,
          fetchError     = Some(err)
        ))
      case Right(schema) =>
        val fields = SchemaInferenceFacade.toSchemaFields(schema, overrides)
        dataSourceRepo.upsertInferredSchema(source.id, fields, now, user).map { updated =>
          CreateSourceResponse(
            source         = DataSourceResponse.fromDomain(updated.getOrElse(source)),
            inferredSchema = Some(InferredSchemaResponse(schema.fields.map(f => {
              val ov = overrides.get(f.name)
              InferredFieldResponse(
                f.name,
                ov.map(_.displayName).getOrElse(f.displayName),
                ov.map(_.dataType).getOrElse(DataFieldType.asString(f.dataType)),
                f.nullable
              )
            }).toVector)),
            fetchError   = None,
            rowCapNotice = rowCapNotice(schema)
          )
        }
    }

  /** HEL-861 (design D6): a forward-looking advisory composed generically from whatever the
   *  connector's `inferSchema` measured -- reads `InProcessPipelineEngine.MaxRunRows` directly
   *  (never a literal `1000`) so the cap can never desynchronize from the message. `None` when the
   *  connector couldn't measure a total (SQL) or the total is under the cap. No second fetch --
   *  this is composed purely from the already-computed `schema.observedRowCount`. */
  private def rowCapNotice(schema: InferredSchema): Option[String] =
    schema.observedRowCount.collect {
      case count if count > InProcessPipelineEngine.MaxRunRows =>
        // HEL-861 (skeptic-final-1, non-blocking item a): "already holds" overstated a
        // point-in-time inference measurement as a standing fact -- a REST source can grow
        // or shrink between inference and any later run. "held ... when its schema was
        // inferred" says only what was actually measured.
        s"This source held $count rows when its schema was inferred, more than the " +
          s"${InProcessPipelineEngine.MaxRunRows}-row run cap. Pipeline runs over this source " +
          s"will be truncated to ${InProcessPipelineEngine.MaxRunRows} rows."
    }
}
