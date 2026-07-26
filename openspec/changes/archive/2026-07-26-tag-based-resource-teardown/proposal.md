## Why

`helio-news` groups a workflow run's resources by string-prefix scanning names
(`HelioClient.cleanup_news_resources()`), which leaks Helio's naming conventions into
every client and is brittle. We need a first-class grouping primitive — a per-resource
`tag` — plus a single bulk-teardown call, so an agentic workflow can create tagged
resources and tear them all down by tag with no name scanning. This is a bulk-delete
feature running against production data; safety (owner scoping, no cross-tag data
loss) is the defining constraint, not a footnote.

## What Changes

- Add a nullable `tag` (single free-form string, not multi-tag) column to
  `data_sources`, `pipelines`, and `data_types` — set only at create time, additive,
  owner-scoped, RLS-covered by the existing owner policies (V35). New migration V73.
- Accept optional `tag` on `DataSourceService`/`PipelineService`/`DataTypeService`
  create paths and their request protocols; return `tag` on reads.
- Extend `GET /api/data-sources`, `GET /api/pipelines`, `GET /api/types` with an
  optional `?tag=` filter (owner-scoped, exact match).
- New `POST /api/workspace/teardown {tag, dryRun?}` endpoint (`WorkspaceRoutes` +
  `WorkspaceTeardownService`): validates the full tagged set first — refuses (200,
  `blocked: true`, nothing deleted) if any tagged resource has a dependent **outside
  this same tag batch** (untagged, or tagged into a different batch) that existing
  single-delete cascades would otherwise reach (tagged DataSource with an
  out-of-batch dependent Pipeline; tagged output DataType with an out-of-batch
  producing Pipeline) —
  then deletes Pipelines, then DataTypes, then DataSources inside one app-pool DB
  transaction (raw DBIO deletes, not calls into the existing per-resource
  service-layer delete methods), re-checking the same safety conditions those
  methods already enforce: panel-bound DataType conflict, and a source-companion-link
  conflict that is scoped to exclude a source tagged into the same teardown batch
  (see design.md Decision 6). `dryRun: true` runs the same validation
  and returns the same `{ sourcesDeleted, pipelinesDeleted, typesDeleted }` shape
  (or the blocking conflicts) without deleting anything.
- MCP: `tag` param on `create_data_source`/`create_pipeline`/create-type-producing
  tools, `tag` exposed on read/context tools and `get_workspace_context`, new
  `teardown_resources` tool wrapping the endpoint (dry-run first is the documented
  recommended flow).
- `schemas/` + `openspec/` updated for the `tag` field and the teardown endpoint.

## Capabilities

### New Capabilities

- `resource-tagging`: `tag` column + create/read/filter support on data sources,
  pipelines, and DataTypes.
- `workspace-tag-teardown`: the validate-then-bulk-delete-by-tag endpoint, its
  refuse-on-untagged-dependent semantics, dry-run, and per-kind delete counts.

### Modified Capabilities

_(none — `data-source-persistence`, `pipeline-*`, `data-type-persistence` gain an
additive field via the new capabilities above, not a requirements change to their
existing specs.)_

## Impact

Backend: new migration, `DataSourceService`/`PipelineService`/`DataTypeService`
create+read paths, new `WorkspaceTeardownService` + `WorkspaceRoutes`, `ApiRoutes`
wiring, `JsonProtocols`. MCP: `helio-mcp/src/tools/write.ts`, `helio-mcp/src/tools/read.ts`,
`helio-mcp/src/helioApi.ts`, `helio-mcp/src/context.ts`. `schemas/`, `openspec/`.

## Non-goals

- Multi-tag / namespaced-tag support (single free-form tag only — see design.md).
- Tagging or deleting dashboards (out of scope per ticket; sources/pipelines/types only).
- Retro-tagging existing untagged resources via update endpoints.
- Automatic garbage-collection of orphaned resources.
- HEL-367/368/369/624 (queued behind this ticket) — not absorbed here.
