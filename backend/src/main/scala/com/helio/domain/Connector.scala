package com.helio.domain

import spray.json.JsValue

import scala.concurrent.{ExecutionContext, Future}

/** Static capability metadata for a `Connector[Config]` implementation.
 *  Describes properties of the connector kind itself (not a specific config
 *  instance) — consumed by the HEL-484 connector registry for aggregation.
 *
 *  @param kind                stable identifier for the connector kind, e.g. `"sql"`, `"rest_api"`
 *  @param displayName         human-readable label, e.g. `"SQL Database"`
 *  @param supportsIncremental whether the connector supports incremental/streaming refresh
 *                             (HEL-428); all connectors return `false` until that ticket lands
 *  @param authKind            coarse auth model descriptor, e.g. `"basic"`, `"configurable"` —
 *                             kept as a plain `String` here; HEL-484 may widen this to a sealed
 *                             trait once the full set of connector auth needs is known
 */
final case class ConnectorMetadata(
    kind: String,
    displayName: String,
    supportsIncremental: Boolean,
    authKind: String
)

/** Shared lifecycle contract every v1.9 connector implements, generic over the connector's own
 *  config type (`Config`) rather than a common config supertype — each implementation keeps
 *  compile-time-checked access to its own config shape while still exposing a uniform method
 *  surface once callers hold a concrete `Connector[X]`. Registry aggregation (HEL-484) works
 *  against `Connector[_]` existentials for enumeration/metadata, which don't need the config type.
 *
 *  '''Refresh semantics''': there is no distinct `refresh` method on this trait. The default
 *  refresh behavior for every connector is a full re-fetch via `fetch` — that's what
 *  `SourceService.refreshSql`/`.refreshRest` already do today. Incremental/streaming refresh is
 *  deferred to a future extension (HEL-428) rather than baked into this SPI a ticket early.
 *
 *  '''ExecutionContext'''`: `testConnection`, `inferSchema`, and `fetch` each require a
 *  caller-supplied `implicit ec: ExecutionContext`. No implementation may source an
 *  `ExecutionContext` internally (e.g. `ExecutionContext.global`) — `SqlConnector`'s blocking JDBC
 *  work depends on running on the caller-supplied EC to avoid starving the Pekko dispatcher (see
 *  CLAUDE.md's "Avoid blocking operations in actor execution paths" rule). Every sibling connector
 *  (424-428) and every polymorphic caller (HEL-473, HEL-480) must follow the same rule.
 */
trait Connector[Config] {

  /** Static capabilities of this connector kind. */
  def metadata: ConnectorMetadata

  /** Cheap reachability/auth check — does not perform a full data fetch. */
  def testConnection(config: Config)(implicit ec: ExecutionContext): Future[Either[String, Unit]]

  /** Infers a schema from a live sample of the connector's data. */
  def inferSchema(config: Config)(implicit ec: ExecutionContext): Future[Either[String, InferredSchema]]

  /** Fetches up to `maxRows` normalized rows (one `JsObject` per row). */
  def fetch(config: Config, maxRows: Int)(implicit ec: ExecutionContext): Future[Either[String, Vector[JsValue]]]
}
