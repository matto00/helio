## Why

A REST source authored with a repeated query key (`?tag=a&tag=b`, `?fields=id&fields=name`) silently issues
`?tag=b`. The request succeeds, the response parses, and the data is wrong with nothing surfacing it -- the
repo's known silent-corruption class (HEL-814, HEL-671). Repeated keys are ordinary in real APIs, and an
existing user already lost values this way during HEL-822's migration.

## What Changes

- **BREAKING (internal representation only)**: `RestApiConfig.queryParams` becomes `QueryParams`, a named
  wrapper over an ordered sequence of key/value pairs, instead of `Map[String, String]` -- preserving both
  multiplicity and order.
- Persisted configs decode from **either** shape -- the historical JSON object or the new ordered array --
  with no Flyway migration and no rewrite of existing rows. Decode stays total (HEL-826's invariant).
- Request composition stops collapsing. `buildResolvedRequest` currently rebuilds the query through
  `uri.query().toMap` per param, which collapses a duplicate key to its last value and silently reorders
  every pair via `Map`'s hash-based iteration (it does not drop an endpoint-carried query string outright,
  only reorder/collapse-within it); it is replaced with a single ordered append. `injectAuthQueryParam`
  gets the same treatment.
- `{{name}}` template resolution (HEL-823) resolves over the ordered sequence, so a templated value inside a
  repeated key resolves per occurrence rather than per unique key.
- `RestSourceConnectorMigration.splitUrl` keeps every pair from a legacy URL. Its existing
  "may not reproduce every repeated value" warning becomes obsolete and is removed.
- The wire shape for source create/update and pipeline proposals accepts both encodings and emits the ordered
  one. A `queryParams` value matching **neither** encoding still fails loud through `decodeRest`'s existing
  `Left("malformed: ...")` outcome -- it is never swallowed to empty.
- `SourceService`'s bare-`url` create path stops discarding the URL's query string outright (a fourth collapse
  point, distinct from the three above).
- `schemas/pipelines/create-pipeline-request.schema.json` is widened to accept the array encoding.

## Non-goals

- Repeated **request headers**. Headers stay `Map[String, String]`; no acceptance criterion asks for them and
  repeated request headers are rare enough to be their own ticket.
- Any Flyway migration or rewrite of persisted rows (explicitly forbidden for this run).
- The ephemeral path (`buildEphemeralRequest`), which already preserves duplicates via `Uri(config.url)`.
- Frontend authoring UI for repeated keys (HEL-827 owns REST form parity).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `rest-api-connector`: query parameters are an ordered multi-valued list rather than a single-value map;
  request composition preserves duplicate keys and their order, and preserves an endpoint-carried query
  string; persisted configs in the historical map shape continue to decode and fetch identically.

## Impact

- `backend/.../domain/model/model.scala` (`RestApiConfig.queryParams` type)
- `backend/.../domain/connectors/RestApiConnectorDriver.scala` (composition, templating, auth injection)
- `backend/.../services/sources/RestSourceConnectorMigration.scala` (`splitUrl`)
- `backend/.../api/protocols/sources/DataSourceProtocol.scala` (wire encode/decode, dual-read)
- `backend/.../api/protocols/pipelines/PipelineProposalProtocol.scala` -- **two lines only** (DTO field and its
  mapping), per an approved cross-run fence exemption; a parallel run owns the rest of that file.
- `schemas/pipelines/create-pipeline-request.schema.json` (`queryParams` currently `["object", "null"]`).
- `backend/.../services/sources/SourceService.scala` (bare-`url` create path).
- `frontend/src/features/sources/hooks/useRestSourceForm.ts` + `dataSourceService.ts` (write path only).
- No Flyway migration, no new dependency.

Checked and deliberately unaffected: `helio-mcp` only *writes* the object encoding (covered by dual-read) and
reads `config` as `unknown` (`helio-mcp/src/types.ts:96`), so the fence around it holds without change.
`POST /api/sources/infer` shares `RestApiConfigPayload` and inherits the new encoding without reaching into
schema-inference logic (HEL-868's scope). `AssistantProposalToolSchemas.scala:129/389` carries prose
descriptions of `queryParams` that go mildly stale; left alone as it is a fenced-adjacent proposal surface.
