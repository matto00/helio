# API Layer

Transport-facing contracts and request handling adapters, split into:
`http/` (cross-cutting HTTP infrastructure — auth directives, ACL, request
validation, tracing, top-level error handling), `routes/<domain>/` (Pekko
HTTP route definitions), `protocols/<domain>/` (spray-json wire types). See
each subdirectory's own README for what belongs there.

At this root: `ApiRoutes.scala` (the composition root — mounts every domain's
routes), `JsonProtocols.scala` (mixes every domain's protocol trait into one
aggregator), `package.scala` (re-exports every protocol type into
`com.helio.api` for `import com.helio.api._` callers).

Use JSON Schema contracts (`schemas/`) as the source of truth for payloads.
