package com.helio.domain.model

import com.helio.domain.connectors.ConnectorRegistry
import com.helio.domain.engine.SchemaField
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._
import java.time.Instant

/** DataSource ADT.
 *
 *  Sealed-trait dispatch over the 7 source kinds. Each subtype carries its own
 *  typed config, except [[DatasetSource]] — HEL-1074 moved its column/row
 *  payload off `data_sources.config` into the dedicated `dataset_rows` table
 *  (one JSONB array value per row, positionally aligned to the source's
 *  `dataset_schema` column) rather than a linked `DataType` row (the
 *  pre-HEL-904 shape); see [[DatasetSource]]'s own scaladoc for the full
 *  post-migration storage story. The `kind` string is the wire discriminator
 *  (`"csv" | "rest_api" | "sql" | "dataset" | "text" | "pdf" | "image"`); see
 *  [[DataSourceKind]] for parse / unparse. `"static"` is accepted on the wire
 *  as a write-side alias for `"dataset"` for one minor release (HEL-1073) —
 *  see [[DataSourceKind.canonicalize]].
 *
 *  Wire shape (after CS2c-2) is a discriminated union on `type`:
 *  {{{ { "type": "csv", "id": "...", "name": "...", "config": { ... }, ... } }}}
 *  The DB table shape is otherwise unchanged for every kind but `dataset` —
 *  `data_sources.source_type` continues to hold the kind string and
 *  `data_sources.config` continues to hold the typed config as JSON for
 *  every kind except `dataset`, whose `config` is unused (cleared to `{}`
 *  by the migration and never written again). */
sealed trait DataSource {
  def id: DataSourceId
  def name: String
  def ownerId: UserId
  def createdAt: Instant
  def updatedAt: Instant
  def kind: String
  /** HEL-366: optional free-form grouping tag, set only at create time. See
   *  [[com.helio.services.WorkspaceTeardownService]] for the bulk-teardown
   *  consumer of this field. */
  def tag: Option[String]
  /** HEL-904 (Outputs remodel, additive step 1.3): the source's own inferred
   *  column schema, populated by ingestion/refresh independent of any
   *  DataType. Defaults empty in the domain model for construction
   *  convenience; V94's task 2.9(a) migration already backfilled every pre-existing row that
   *  HAD a companion DataType (`source_id IS NOT NULL`, not a pipeline's own output type) at
   *  deploy time, so the empty default is now reached only by a genuinely new, not-yet-inferred
   *  source, or by a pre-existing source that never had a companion DataType to begin with. */
  def inferredSchema: Vector[SchemaField]
}

/** CSV-backed source. The `path` is a FileSystem-relative key into the uploads
 *  root (resolved by [[com.helio.infrastructure.FileSystem]]). `sourceUrl`
 *  (HEL-862) is `Some(url)` when the source was created from an HTTPS URL
 *  rather than an upload/inline content — mirrors [[TextSourceConfig]]'s
 *  convention. Defaulted to `None` so every pre-existing positional
 *  construction (upload-created sources, test fixtures) keeps compiling. */
final case class CsvSourceConfig(path: String, sourceUrl: Option[String] = None)

final case class CsvSource(
    id: DataSourceId,
    name: String,
    ownerId: UserId,
    createdAt: Instant,
    updatedAt: Instant,
    config: CsvSourceConfig,
    tag: Option[String] = None,
    inferredSchema: Vector[SchemaField] = Vector.empty
) extends DataSource {
  override val kind: String = "csv"
}

final case class RestSource(
    id: DataSourceId,
    name: String,
    ownerId: UserId,
    createdAt: Instant,
    updatedAt: Instant,
    config: RestApiConfig,
    tag: Option[String] = None,
    inferredSchema: Vector[SchemaField] = Vector.empty
) extends DataSource {
  override val kind: String = "rest_api"
}

final case class SqlSource(
    id: DataSourceId,
    name: String,
    ownerId: UserId,
    createdAt: Instant,
    updatedAt: Instant,
    config: SqlSourceConfig,
    tag: Option[String] = None,
    inferredSchema: Vector[SchemaField] = Vector.empty
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
    config: TextSourceConfig,
    tag: Option[String] = None,
    inferredSchema: Vector[SchemaField] = Vector.empty
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
    config: PdfSourceConfig,
    tag: Option[String] = None,
    inferredSchema: Vector[SchemaField] = Vector.empty
) extends DataSource {
  override val kind: String = "pdf"
}

/** Manually-entered static data (HEL-1074: post-migration, stored as a
 *  "dataset"-kind source). Row data lives in the dedicated `dataset_rows`
 *  table (one JSONB array value per row, positionally aligned to the
 *  source's `data_sources.dataset_schema` column, which holds the
 *  caller-declared `[{name, type}, ...]` column list) — NOT in
 *  `data_sources.config`, which is unused/cleared to `{}` for every
 *  `dataset`-kind row. `source_type = 'dataset'` is the value stored in the
 *  DB; `"static"` is still accepted as a wire-only alias for request `type`
 *  fields for one minor release (HEL-1073), resolved by
 *  [[DataSourceKind.canonicalize]] before it reaches the domain layer.
 *
 *  We deliberately keep DatasetSource flat (no `config` field): its payload
 *  is large and write-once-per-refresh, and the typed ADT shouldn't pretend
 *  it belongs to the source identity. `DataSourceRepository.readDatasetRows`
 *  materializes the `{columns, rows}` blob on demand from `dataset_schema` +
 *  `dataset_rows` for the legacy in-process / Spark engines and the preview
 *  endpoint, all of which consume that same shape directly. */
/** HEL-1076 design.md Decision 1: `dataset_schema`'s Scala-side declared-field shape, replacing
 *  `Vector[SchemaField]` for `dataset`-kind sources. Distinct from `SchemaField` (shared by
 *  `inferred_schema`/`outputs.schema`/pipeline analysis, none of which have a required/default
 *  concept) rather than overloading it. `default`'s JSON shape, when present, must itself satisfy
 *  `fieldType`'s validation rules (design.md Decision 6) — enforced at declaration time by
 *  `DatasetRowValidator.validateDefault`, not by this case class's constructor. */
final case class DatasetFieldDeclaration(
    name:      String,
    fieldType: DataFieldType,
    required:  Boolean          = false,
    default:   Option[JsValue] = None
)

object DatasetFieldDeclaration {

  private val log = LoggerFactory.getLogger(getClass)

  /** HEL-1076 design.md Decision 2: hand-rolled (not `jsonFormat4`) so `read` can normalize
   *  spray-json's absent-`Option`-key omission (`required` absent -> `false`, `default` absent ->
   *  `None`) and route `fieldType` through `DataFieldType.validateAndCanonicalize` on write /
   *  `asString` on read, falling back to `StringType` with a logged warning if a stored `type`
   *  string somehow fails `fromString` on read (should be unreachable once write-time validation
   *  is in place; guards a hand-edited/pre-existing-bad row rather than crashing the read path). */
  implicit val datasetFieldDeclarationFormat: RootJsonFormat[DatasetFieldDeclaration] =
    new RootJsonFormat[DatasetFieldDeclaration] {
      override def write(f: DatasetFieldDeclaration): JsValue = {
        val canonicalType = DataFieldType.validateAndCanonicalize(DataFieldType.asString(f.fieldType))
          .getOrElse(DataFieldType.asString(f.fieldType))
        JsObject(
          Vector(
            "name"     -> JsString(f.name),
            "type"     -> JsString(canonicalType),
            "required" -> JsBoolean(f.required)
          ) ++ f.default.map("default" -> _).toVector: _*
        )
      }

      override def read(json: JsValue): DatasetFieldDeclaration = {
        val obj      = json.asJsObject
        val name     = obj.fields("name").convertTo[String]
        val rawType  = obj.fields("type").convertTo[String]
        val fieldType = DataFieldType.validateAndCanonicalize(rawType) match {
          case Right(canonical) => DataFieldType.fromString(canonical).getOrElse(DataFieldType.StringType)
          case Left(_) =>
            log.warn(s"DatasetFieldDeclaration: stored type '$rawType' for field '$name' is not a " +
              s"canonical DataFieldType; falling back to StringType")
            DataFieldType.StringType
        }
        val required = obj.fields.get("required").exists(_.convertTo[Boolean])
        val default  = obj.fields.get("default").filterNot(_ == JsNull)
        DatasetFieldDeclaration(name, fieldType, required, default)
      }
    }
}

final case class DatasetSource(
    id: DataSourceId,
    name: String,
    ownerId: UserId,
    createdAt: Instant,
    updatedAt: Instant,
    tag: Option[String] = None,
    inferredSchema: Vector[SchemaField] = Vector.empty
) extends DataSource {
  override val kind: String = "dataset"
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
    config: ImageSourceConfig,
    tag: Option[String] = None,
    inferredSchema: Vector[SchemaField] = Vector.empty
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
  val Dataset: String = "dataset"
  val Text: String    = "text"
  val Pdf: String     = "pdf"
  val Image: String   = "image"

  /** HEL-1073: the retired `"static"` wire literal. Kept as a named public
   *  constant solely for [[canonicalize]] and the `DataSourceProtocol.scala`
   *  JSON-discriminator match arm that must still recognize an incoming
   *  `"static"` payload — no other code path may compare `kind ==
   *  DataSourceKind.Static` after this change; use `canonicalize(kind) ==
   *  DataSourceKind.Dataset` instead. */
  val Static: String = "static"

  // HEL-484: derived from the connector registry rather than a literal Set —
  // adding a connector kind requires only a ConnectorRegistry registration.
  // See ConnectorRegistrySpec for the drift-detection test that fails if this
  // set and the registry's kinds ever diverge.
  val All: Set[String] = ConnectorRegistry.all.map(_.kind).toSet

  /** HEL-1073: normalizes the retired `"static"` wire alias to `"dataset"`;
   *  identity for every other value. Called at every entry point that
   *  branches on the source-kind string, not just [[parseKind]] — see
   *  design.md Decision 2 for the full call-site inventory. */
  def canonicalize(s: String): String =
    if (s == Static) Dataset else s

  def parseKind(s: String): Either[String, String] = {
    val canonical = canonicalize(s)
    if (All.contains(canonical)) Right(canonical)
    else Left(s"Unknown source type: '$s'. Valid values: ${All.toSeq.sorted.mkString(", ")}")
  }
}
