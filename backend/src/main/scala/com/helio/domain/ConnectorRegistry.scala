package com.helio.domain

/** Aggregates the `ConnectorMetadata` for all seven source kinds — the read/discovery surface
 *  `GET /api/connectors` and the MCP `list_connectors` tool serve verbatim (HEL-484).
 *
 *  Every entry is a dependency-free static `ConnectorMetadata` value (design.md Decision 1):
 *  `sql`/`rest_api` are sourced from their `Connector[Config]` implementation's companion-object
 *  `metadata` `val` (never a live instance, since `RestApiConnector` requires an `ActorSystem` to
 *  construct); the five content/upload kinds (`csv`/`static`/`text`/`pdf`/`image`), which have no
 *  `Connector[Config]` implementation, get static `ConnectorMetadata` values registered directly
 *  below. `DataSourceKind.All` derives its accepted-kind set from `all` (`DataSource.scala`).
 *
 *  Entry order matches `SourceTypeToggle.tsx`'s pre-registry button order (REST API, CSV, Static,
 *  SQL, Text, PDF, Image) so the frontend renders byte-for-byte the same toggle it did before this
 *  ticket (design.md Decision 6).
 *
 *  '''requiredFields for the content kinds''': hand-drawn from each kind's config payload shape in
 *  `api/protocols/DataSourceProtocol.scala` — these describe the *stored* config shape (e.g. the
 *  uploads-root-relative path), not a caller-supplied create request. `GET /api/connectors` is a
 *  read/discovery surface, not a create-time validator (design.md Non-Goals) — a real create call
 *  for these kinds is a file upload or URL, not a raw `path`.
 *
 *  '''Why literal kind strings, not `DataSourceKind.Csv` etc.''': `DataSourceKind.All` derives from
 *  `ConnectorRegistry.all` (`DataSource.scala`). If these entries referenced `DataSourceKind`'s
 *  constants, reading `ConnectorRegistry.all` would force `DataSourceKind`'s object initializer to
 *  run before it finished computing `All` (which itself needs `ConnectorRegistry.all`) — a circular
 *  `<clinit>` that throws `NullPointerException` on whichever object initializes first. Literal
 *  strings here (matching `SqlConnector`/`RestApiConnector.metadata`'s existing `kind = "sql"` /
 *  `"rest_api"` style) make the dependency strictly one-directional. */
object ConnectorRegistry {

  private val csvMetadata: ConnectorMetadata = ConnectorMetadata(
    kind = "csv",
    displayName = "CSV File",
    supportsIncremental = false,
    authKind = "none",
    requiredFields = Vector(ConnectorFieldDescriptor(name = "path", label = "Path", secret = false))
  )

  private val staticMetadata: ConnectorMetadata = ConnectorMetadata(
    kind = "static",
    displayName = "Manual",
    supportsIncremental = false,
    authKind = "none",
    // No config payload exists for StaticSource (StaticSourceResponse carries
    // no `config` field) — drawn instead from StaticDataPayload, the closest
    // analog ("Static connector API types" section of DataSourceProtocol.scala).
    requiredFields = Vector(
      ConnectorFieldDescriptor(name = "columns", label = "Columns", secret = false),
      ConnectorFieldDescriptor(name = "rows", label = "Rows", secret = false)
    )
  )

  private val textMetadata: ConnectorMetadata = ConnectorMetadata(
    kind = "text",
    displayName = "Text/Markdown",
    supportsIncremental = false,
    authKind = "none",
    requiredFields = Vector(ConnectorFieldDescriptor(name = "path", label = "Path", secret = false))
  )

  private val pdfMetadata: ConnectorMetadata = ConnectorMetadata(
    kind = "pdf",
    displayName = "PDF",
    supportsIncremental = false,
    authKind = "none",
    requiredFields = Vector(ConnectorFieldDescriptor(name = "path", label = "Path", secret = false))
  )

  private val imageMetadata: ConnectorMetadata = ConnectorMetadata(
    kind = "image",
    displayName = "Image",
    supportsIncremental = false,
    authKind = "none",
    requiredFields = Vector(ConnectorFieldDescriptor(name = "path", label = "Path", secret = false))
  )

  // Declared last within the object body — `all` reads the private vals
  // above, which must already be initialized (Scala evaluates an object's
  // members top-to-bottom on first access; a forward reference here would
  // read `null` instead of the intended value).
  val all: Vector[ConnectorMetadata] = Vector(
    RestApiConnector.metadata,
    csvMetadata,
    staticMetadata,
    SqlConnector.metadata,
    textMetadata,
    pdfMetadata,
    imageMetadata
  )
}
