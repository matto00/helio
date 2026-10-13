# Services — Sources

Data-source ingestion: CSV/image/PDF/connection-test support, schema inference facade, source CRUD.

Holds: `ConnectionTest`, `ContentSourceSupport`, `CreateSourceEnvelope`, `DataSourceCsvSupport`, `DataSourceService`, `ImageSourceSupport`, `ImageUploadService`, `PdfTextSupport`, `SchemaInferenceFacade`, `SourceConfigParsing`, `SourceService`, `StoredObjectCleanup`, `StoredObjectDeletionService`.

`StoredObjectDeletionService` drains the `stored_object_deletions` queue: V128 queues image-upload and file-backed
source keys, and V132 (HEL-1530) adds `form-uploads/` keys from `dataset_rows`, assistant-conversation transcripts,
TRUNCATE, and form-submit compensation. Its shared-key guard checks every table that can hold a key; a key held
only by a derived copy is deferred, never dropped.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/sources/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
