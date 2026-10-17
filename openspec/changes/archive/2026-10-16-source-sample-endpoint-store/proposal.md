## Why

The HEL-1581 client evaluator recomputes a draft pipeline over a cached sample of each source's rows, but nothing
serves that sample: no endpoint returns up to 1,000 engine-loaded REST/SQL rows, and today's step preview re-reads
the live source on every edit. HEL-1628 is split item (b) of HEL-1581 (`docs/live-draft-preview.md` §4, §12), under
owner rulings C (`client-memory`) and D (`head-1000-manual-refresh`).

## What Changes

- New read-only `GET /api/data-sources/:id/sample` returning `{rows, capturedAt, sourceRowCount, truncated, live}`:
  the engine-loaded head (at most 1,000 rows) of a source, rows value-encoded losslessly for the client evaluator.
- Mounted inside the HEL-505 source-fetch limiter scope (30/min per user, own bucket); never touches the
  pipeline-run guard. Owner-only access exactly like the existing source preview routes.
- New committed JSON Schema `schemas/sources/source-sample-response.schema.json` plus a two-sided seam test.
- New client in-memory sample store (Redux, not persisted): automatic first capture when the pipeline page opens with
  nothing cached, manual refresh only, never re-fetched per edit; selectors shaped as the evaluator's
  `RootFrame`/`SourceFrames` inputs for HEL-1631 (e).
- A sample label with capture age and a refresh button on each source card of the pipeline page, following the §4
  rules (non-static always labelled with age; any source over 1,000 rows gets the prefix label plus caveat; only a
  static exact sample keeps "Static · N rows").

## Capabilities

### New Capabilities
- `source-sample-api`: the 1,000-row engine-loaded source sample endpoint, its access, limits and wire contract.
- `pipeline-source-sample-store`: the client in-memory sample store and the source sample label on the pipeline page.

### Modified Capabilities

## Impact

Backend: new service + route under `DataSourcePreviewRoutes`, `ApiRoutes` wiring, JSON protocol. Schema: one new
response schema. Frontend: `features/sources` service + new slice, `features/pipelines` spine source card label,
evaluator value decoding promoted out of `testing/`. No migration, no new dependency.

## Non-goals

- Wiring the evaluator into the UI, draft state, removal of the per-edit step preview/PATCH (HEL-1631 (e)).
- The draft-preview NDJSON endpoint (d) and the bulk Save & run endpoint (c).
- Sampling a source the caller does not own (editor grantees of a shared pipeline); see design Risks.
- Image sources (a sample would rewrite the stored image; the evaluator cannot represent its binary row).
