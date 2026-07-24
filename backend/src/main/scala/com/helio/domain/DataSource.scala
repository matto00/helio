package com.helio.domain

import java.time.Instant

/** DataSource ADT.
 *
 *  Sealed-trait dispatch over the 5 source kinds. Each subtype carries its own
 *  typed config (or no config, for [[StaticSource]] — its column/row payload
 *  lives in [[CsvSourceConfig]] and the linked `DataType` row). The `kind`
 *  string is the persistence + wire discriminator (`"csv" | "rest_api" | "sql"
 *  | "static" | "text"`); see [[DataSourceKind]] for parse / unparse at the
 *  DB-row boundary.
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

/** Text/Markdown-backed source (HEL-215, first content connector of the v1.4
 *  Unstructured Data release). `path` is a FileSystem-relative key into the
 *  uploads root, populated for both ingestion modes — uploaded bytes are
 *  written directly, and URL-ingested content is fetched then stored at the
 *  same convention (`text/<sourceId>.<ext>`) so refresh/preview stay uniform
 *  with CSV. `sourceUrl` is `Some(url)` for URL-ingested sources (refresh
 *  re-fetches) and `None` for uploads (refresh re-reads the stored file). */
final case class TextSourceConfig(path: String, sourceUrl: Option[String])

final case class TextSource(
    id: DataSourceId,
    name: String,
    ownerId: UserId,
    createdAt: Instant,
    updatedAt: Instant,
    config: TextSourceConfig
) extends DataSource {
  override val kind: String = "text"
}

/** PDF-backed source (HEL-214, second content connector of the v1.4
 *  Unstructured Data release, first *multi-row* content connector). `path` is
 *  a FileSystem-relative key into the uploads root
 *  (`pdf/<sourceId>.pdf`), mirroring [[TextSourceConfig]]'s convention.
 *  `sourceUrl` is `Some(url)` for URL-ingested sources (refresh re-fetches)
 *  and `None` for uploads (refresh re-reads the stored file). Unlike
 *  [[TextSource]]'s single-row shape, `InProcessPipelineEngine.loadRows`
 *  produces one row per PDF page for this source kind (see
 *  `services/PdfTextSupport.scala`). */
final case class PdfSourceConfig(path: String, sourceUrl: Option[String])

final case class PdfSource(
    id: DataSourceId,
    name: String,
    ownerId: UserId,
    createdAt: Instant,
    updatedAt: Instant,
    config: PdfSourceConfig
) extends DataSource {
  override val kind: String = "pdf"
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

/** Image-backed source (HEL-216, second content connector of the v1.4
 *  Unstructured Data release). Config shape is identical to
 *  [[TextSourceConfig]] — same relative-`FileSystem`-key convention
 *  (`image/<sourceId>.<ext>`), same `sourceUrl` semantics (refresh re-fetches
 *  vs. re-reads). The divergence from `TextSource` is entirely in the
 *  metadata-field set and the content `DataFieldType` (`BinaryRefType`
 *  instead of `StringBodyType`), which live in `DataSourceService`. */
final case class ImageSourceConfig(path: String, sourceUrl: Option[String])

final case class ImageSource(
    id: DataSourceId,
    name: String,
    ownerId: UserId,
    createdAt: Instant,
    updatedAt: Instant,
    config: ImageSourceConfig
) extends DataSource {
  override val kind: String = "image"
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
  val Text: String    = "text"
  val Pdf: String     = "pdf"
  val Image: String   = "image"

  // HEL-484: derived from the connector registry rather than a literal Set —
  // adding a connector kind requires only a ConnectorRegistry registration.
  // See ConnectorRegistrySpec for the drift-detection test that fails if this
  // set and the registry's kinds ever diverge.
  val All: Set[String] = ConnectorRegistry.all.map(_.kind).toSet

  def parseKind(s: String): Either[String, String] =
    if (All.contains(s)) Right(s)
    else Left(s"Unknown source type: '$s'. Valid values: ${All.toSeq.sorted.mkString(", ")}")
}
