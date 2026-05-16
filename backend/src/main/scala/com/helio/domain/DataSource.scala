package com.helio.domain

import java.time.Instant

/** DataSource ADT.
 *
 *  Sealed-trait dispatch over the 4 source kinds. Each subtype carries its own
 *  typed config (or no config, for [[StaticSource]] — its column/row payload
 *  lives in [[CsvSourceConfig]] and the linked `DataType` row). The `kind`
 *  string is the persistence + wire discriminator (`"csv" | "rest_api" | "sql"
 *  | "static"`); see [[DataSourceKind]] for parse / unparse at the DB-row
 *  boundary.
 *
 *  Wire shape (after CS2c-2) is a discriminated union on `type`:
 *  {{{ { "type": "csv", "id": "...", "name": "...", "config": { ... }, ... } }}}
 *  The DB table shape is unchanged — `data_sources.source_type` continues to
 *  hold the kind string, `data_sources.config` continues to hold the typed
 *  config as JSON. */
sealed trait DataSource {
  def id: DataSourceId
  def name: String
  def ownerId: UserId
  def createdAt: Instant
  def updatedAt: Instant
  def kind: String
}

/** CSV-backed source. The `path` is a FileSystem-relative key into the uploads
 *  root (resolved by [[com.helio.infrastructure.FileSystem]]). */
final case class CsvSourceConfig(path: String)

final case class CsvSource(
    id: DataSourceId,
    name: String,
    ownerId: UserId,
    createdAt: Instant,
    updatedAt: Instant,
    config: CsvSourceConfig
) extends DataSource {
  override val kind: String = "csv"
}

final case class RestSource(
    id: DataSourceId,
    name: String,
    ownerId: UserId,
    createdAt: Instant,
    updatedAt: Instant,
    config: RestApiConfig
) extends DataSource {
  override val kind: String = "rest_api"
}

final case class SqlSource(
    id: DataSourceId,
    name: String,
    ownerId: UserId,
    createdAt: Instant,
    updatedAt: Instant,
    config: SqlSourceConfig
) extends DataSource {
  override val kind: String = "sql"
}

/** Manually-entered static data. Columns + rows are stored in the linked
 *  `DataType` row's schema and replicated on every preview/refresh; the
 *  payload itself lives in the row's JSON column rather than on the source.
 *  CS2c-2 keeps the JSON-payload-on-`config` shape (`{columns, rows}`) for the
 *  StaticSource case via [[StaticSourcePayload]] — see services / preview
 *  paths.
 *
 *  We deliberately keep StaticSource flat (no `config` field): its payload is
 *  large and write-once-per-refresh, and the typed ADT shouldn't pretend it
 *  belongs to the source identity. The protocol layer materializes the
 *  `{columns, rows}` blob on demand from the DataType row (or the stored
 *  config blob for the legacy in-process / Spark engines that read it
 *  directly). */
final case class StaticSource(
    id: DataSourceId,
    name: String,
    ownerId: UserId,
    createdAt: Instant,
    updatedAt: Instant
) extends DataSource {
  override val kind: String = "static"
}

/** Parse / unparse helpers for the `kind` string. The DB column and the
 *  request/response `type` field both round-trip through these. Standalone —
 *  not a `sealed trait` enum — because there are no callers that want enum
 *  exhaustiveness on the discriminator alone (pattern-matching on the
 *  [[DataSource]] subtype is the exhaustive path). */
object DataSourceKind {

  val Csv: String     = "csv"
  val RestApi: String = "rest_api"
  val Sql: String     = "sql"
  val Static: String  = "static"

  val All: Set[String] = Set(Csv, RestApi, Sql, Static)

  def parseKind(s: String): Either[String, String] =
    if (All.contains(s)) Right(s)
    else Left(s"Unknown source type: '$s'. Valid values: ${All.toSeq.sorted.mkString(", ")}")
}
