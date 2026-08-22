# Routes — Sources

Data-source ingestion HTTP routes, connector listing, and upload routes (incl. the unauthenticated `PublicUploadRoutes` byte-serving endpoint).

Holds: `ConnectorRoutes`, `DataSourcePreviewRoutes`, `DataSourceRoutes`, `PublicUploadRoutes`, `SourcePreviewRoutes`, `SourceRoutes`, `UploadRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/sources/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
