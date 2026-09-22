## Why

HEL-933 was filed 2026-09-01 as a carve-out of four scope items from HEL-906. Premise validation
against current `main` (see `ticket.md` and `.concertino/runs/HEL-933/evidence/premise-validation.md`)
found three of the six original items already shipped — in some cases under a simpler design than
originally scoped — since the ticket was written. The three remaining, genuinely-outstanding items
are all JSON Schema documentation gaps: three response shapes are already implemented, tested, and
correct on the wire, but have no matching `schemas/**/*.schema.json` file, so `check:schemas`
(`check-schema-drift.mjs`) cannot catch future drift on them.

## What Changes

- Add `schemas/sources/data-source.schema.json` documenting the `DataSourceResponse` union
  (`GET/POST /api/data-sources`, `GET /api/data-sources/:id`), including the already-shipped
  `inferredSchema` field.
- Add `schemas/pipelines/node-capabilities-response.schema.json` documenting
  `NodeCapabilitiesResponse` (`GET /api/pipelines/:id/capabilities`) — the ticket's own addendum
  named this `output-capabilities-response.schema.json`, but no `OutputCapabilities*` type exists;
  the corrected name matches the actual case class this endpoint returns.
- Add `schemas/pipelines/expand-pipeline-shape-response.schema.json` documenting
  `ExpandPipelineShapeResponse` (`POST /api/pipeline-shapes/:id/expand`), `{ steps, outputs? }`
  with `outputs` modeled as absent-not-null.
- No route, case class, or persisted behavior changes — every shape documented here is already
  implemented and covered by existing backend tests.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — no spec-level requirement changes; the response shapes documented by these schema files are
already fully implemented, and none of the affected capability specs (`data-source-persistence`,
`pipeline-capabilities-api`, `pipeline-shape-registry`) currently cross-reference `schemas/` file
paths, matching this repo's existing convention of keeping JSON Schema files as a drift-check
artifact separate from openspec requirement prose. `skip_specs: true` set in `.openspec.yaml`.)

## Impact

- `schemas/sources/`, `schemas/pipelines/` — three new schema files, zero behavior changes.
- `scripts/check-schema-drift.mjs` — no changes needed; it validates any schema file present
  against its titled case class, which these three already satisfy once added.
- No frontend, backend route, or migration changes.
