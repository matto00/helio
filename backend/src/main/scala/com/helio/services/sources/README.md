# Services — Sources

Data-source ingestion: CSV/image/PDF/connection-test support, schema inference facade, source CRUD.

Holds: `ConnectionTest`, `ContentSourceSupport`, `CreateSourceEnvelope`, `DataSourceCsvSupport`, `DataSourceService`, `ImageSourceSupport`, `ImageUploadService`, `PdfTextSupport`, `SchemaInferenceFacade`, `SourceConfigParsing`, `SourceService`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/sources/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
