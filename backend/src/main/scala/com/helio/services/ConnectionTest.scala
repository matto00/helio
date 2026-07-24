package com.helio.services

import com.helio.api.protocols.TestConnectionResponse
import com.helio.domain.Connector

import scala.concurrent.{ExecutionContext, Future}

/** Shared connection-test envelope construction (HEL-480), the third sibling alongside
 *  `CreateSourceEnvelope`/`SchemaInferenceFacade` — generic over any `Connector[Config]`
 *  implementation (HEL-449's SPI) so a connector gets a correct `TestConnectionResponse` by
 *  construction, with no per-connector envelope logic needed. Lives in `services/`, not `domain/`,
 *  matching its two siblings' layering rationale (depends on nothing api/infra-specific beyond the
 *  wire response type). */
object ConnectionTest {

  /** Calls `connector.testConnection(config)` and maps its `Either[String, Unit]` result to a
   *  `TestConnectionResponse`: `Right(())` becomes `ok = true, error = None`; `Left(err)` forwards
   *  `err` unmodified into `error` (no re-wrapping — HEL-311 curation already happened inside the
   *  connector's `testConnection`) with `ok = false`. This result is always the `Right` side of the
   *  caller's `ServiceError` channel — a connector-level test failure is a domain outcome, not an
   *  HTTP error (design.md Decision 1). */
  def run[Config](connector: Connector[Config], config: Config)(implicit ec: ExecutionContext): Future[TestConnectionResponse] =
    connector.testConnection(config).map {
      case Right(())  => TestConnectionResponse(ok = true, error = None)
      case Left(err)  => TestConnectionResponse(ok = false, error = Some(err))
    }
}
