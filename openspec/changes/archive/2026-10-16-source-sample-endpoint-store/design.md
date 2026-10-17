## Context

See proposal.md for motivation; behaviour is in the two specs. Ground truth (verified at Setup, d777803c1):
- `InProcessPipelineEngine.loadRowsWithStats` (`InProcessPipelineEngine.scala:522`) is the single source-loading
  dispatch a run uses. REST/SQL reads are already capped at `MaxRunRows` = 1,000 (`:113`, `:661`) and report
  `SourceReadStats(truncated, availableRowCount)`; `availableRowCount` can be `None` while `truncated` is true (SQL's
  `maxRows + 1` probe, `ConnectorDriver.scala:39-52`). Dataset/CSV/text/PDF/image are uncapped and report `(false, None)`.
- Engine REST/SQL reads resolve credentials with `ConnectorResolveContext.Internal`; the run path is the "existing
  fetch path" this endpoint must match. Image loading with a `sourceUrl` writes the fetched bytes to `config.path`.
- `DataSourcePreviewRoutes` and `SourcePreviewRoutes` apply `rateLimited` inside their own `pathPrefix`
  (`ApiRoutes.scala:932-934`, `sourceFetchRateLimitDirective` `:315`). Both preview services authorize with
  `DataSourceRepository.findByIdOwned` (owner filter under `withUserContext`, `:180`).
- The run guard lives in `PipelineRunService.submit`; `truncationFields` is in `PipelineRunSupport.scala:48` (the doc's
  `PipelineRunPreview.scala:294` citation is stale).
- Client: `SpineSourceCard.tsx:49-56` renders one card per root with a `spine-card__meta` kind label; no row label
  exists. Evaluator rows are `Row = Readonly<Record<string, Value>>` with `Integral` for Int/Long
  (`evaluator/value.ts:8-17`); the lossless wire decoding exists only in `evaluator/testing/corpus.ts:37`.
- Frontend `CsvSourceConfig` has no `sourceUrl` field, so the client cannot tell a URL-backed CSV from an upload.

## Goals / Non-Goals

Goals: one authoritative sample per source per page load, exact parity with the rows a run loads, honest labels.
Non-goals: see proposal. No migration, no new limiter, no server-side sample persistence (ruling C).

## Decisions

**D1. Route `GET /api/data-sources/:id/sample` inside `DataSourcePreviewRoutes`' `rateLimited` block.** It sits next to
`/preview`, so it is charged to the same per-user source-fetch bucket and needs no new directive. A `SourcePreviewRoutes`
mount (`/api/sources/:id/sample`) was rejected: that surface is REST/SQL-only, and the sample covers every kind.

**D2. New `SourceSampleService` owning its own `InProcessPipelineEngine`, constructed in `ApiRoutes` with the same
`fileSystem`, `connector` and `sqlUrlResolveHost`/`sqlUrlIsBlocked` that `PipelineRunService` receives.** The URL-fetch
seam is today private to `PipelineRunService` (`urlFetchSeam`, `PipelineRunService.scala:125-139`). It is extracted,
behaviour-preserving, into one shared function (`SourceUrlFetch.seam(system, resolveHost, isBlocked)` in
`services/pipelines` or `services/sources`) that both services call, so a sample's URL-backed CSV/text/PDF read applies
exactly the run's HTTPS/size/blocked-host checks; no copy.
It calls `loadRowsWithStats` directly, never `PipelineRunService`, so the run guard (rate window, concurrency,
`pipeline_runs`) is structurally unreachable. Alternative rejected: exposing `PipelineRunService`'s private engine or
going through `previewAtNode` (pipeline-scoped, any-grant access, wrong limiter).

**D3. Access: `findByIdOwned(sourceId, user)` first; on `None` → 404.** Same check as both preview services. Only after
ownership is established does the engine read with `ConnectorResolveContext.Internal`, exactly as an admitted run does,
so credential handling is the run path's, unchanged. The `ConnectorResolveContext` doc comment
(`ConnectorDriver.scala:21`), which says `Internal` is run-only, is updated to name this owner-checked request path. Errors map to curated messages (source name/id only); the
service never logs rows, cell values, configs or credentials.

**D4. Counts.** Let `(rows, stats)` be the engine result and `head = rows.take(1000)`.
- `stats.truncated` (REST/SQL capped read): `truncated = true`, `sourceRowCount = stats.availableRowCount` (nullable).
- otherwise: `truncated = rows.size > 1000`, `sourceRowCount = rows.size` (the engine loaded every row).
`sourceRowCount` is always present on the wire: a custom writer emits `null` for `None` (spray drops `None` fields by
default; repo convention `ProvenanceProtocol.scala:63`, `HomeSummaryProtocol.scala:77`). The schema marks it required,
type `["integer","null"]`. `capturedAt` is the server clock immediately after the read. `live = true` for `rest_api`, `sql`, and any file kind with
`config.sourceUrl`; computed server-side because the client's CSV type lacks `sourceUrl`.

**D5. Image sources are refused with 400.** Loading a URL-backed image rewrites `config.path`, which a read-only
endpoint must not do, and the evaluator's value model cannot represent a `BinaryRef` row.

**D6. Lossless value encoding.** Rows serialize via a new `SampleRowJson.encode` mirroring the corpus encoding: Int →
`{"$int":n}`, Long → `{"$long":"n"}`, non-finite or negative-zero Double → `{"$double":"NaN"|"Infinity"|"-Infinity"|
"-0.0"}`, other numbers plain, String/Boolean/null as JSON. No nested values can occur: `PipelineRowJson.jsValueToAny`
(`:54-63`) stringifies every JSON object/array on load, and the only loader producing a nested map is the image row,
refused by D5. A nested map, or any value class the encoder does not recognise, reaching the encoder is therefore a server bug: the
encoder fails the request with a 500 (curated message, no row contents), never a `toString` fallback. The committed
schema pins a closed cell type (`$defs/cell`): `null | boolean | string | number | {"$int": integer} | {"$long": string
matching ^-?[0-9]+$} | {"$double": "NaN"|"Infinity"|"-Infinity"|"-0.0"}`, each object form `additionalProperties:
false`; `rows` items are objects whose `additionalProperties` is `$defs/cell`. A test keeps `SampleRowJson.encode` in
step with the test-only `ParityCorpus.encodeValue` over the same value set. `decodeValue`/`decodeRow` move unchanged
from `evaluator/testing/corpus.ts` to a production module `evaluator/wire.ts` (the corpus re-imports them); there is no
`evaluable` marker.

**D7. Store = Redux slice `sourceSamplesSlice` (`features/sources/state`), raw JSON in state, decoded via memoized
selectors.** Entry: `{status: idle|loading|ready|error, sample?, error?, requestedAt}`. Thunk `fetchSourceSample`
with a `condition` that skips when an entry is `loading`, and a `force` flag used only by refresh. A response that resolves after sign-out
(`clearAuth`) is ignored (the reducer drops fulfilments whose request predates the last reset), so it cannot repopulate
the store. Hook `useSourceSamples(sourceIds)` dispatches a capture only for ids whose entry is absent and that appear in the
caller's own sources list (a root whose source is not visible to the caller would certainly 404, so no limiter budget
is spent on it; its label reads "Sample unavailable"); it is called from the pipeline
page, not from any step editor, so edits cannot trigger it. Not persisted: the slice is not in any persistence/
localStorage path; it is reset on sign-out alongside the existing auth reset. API for HEL-1631:
`selectSourceSample(state, sourceId)`, `selectRootFrames(state, roots: PipelineRoot[]) → RootFrame[]` (each frame's
`rootId` is the pipeline root id, rows looked up by that root's `dataSourceId`),
`selectSourceFrames(state, ids) → SourceFrames` (`complete = !truncated`); a source with no `ready` entry is omitted.
In (b) the page passes its root source ids; join/union/lookup input sources are not captured here. HEL-1631 passes
those ids through the same hook (still capture-once each).
Raw JSON in state keeps Redux's serializability check meaningful (`Integral` instances are not serializable).

**D8. Label.** Pure function `describeSampleLabel(sample, now) → {text, caveat?, showAge}` implementing the spec table
(unit-tested over all four cases plus unknown total). Component `SourceSampleLabel` renders it inside
`SpineSourceCard` under the kind meta, with a neutral icon button "Refresh sample" (accent only on focus ring; disabled with `aria-busy` while loading), age
re-rendered on a 30 s tick via `formatRelativeTime`. Loading → "Loading sample…"; error → muted "Sample unavailable"
plus the refresh button. Phone layout: the same `SourceSampleLabel` (compact variant: text + caveat + refresh icon button) renders under each
source chip in `PipelineDetailHeader` (`PipelineDetailHeader.tsx:205-238`), so phone users see and can refresh what
they paid limiter budget for. Placement on the source card and under the phone chips is a reversible visual choice
recorded in the PR body. Age wording uses `formatRelativeTime` as-is ("fetched 3 minutes ago"); reversible.

**D9. Error messages.** Unknown/unowned id → 404 "Data source not found"; image → 400; missing uploaded file →
404 "Data file not found; the source may need to be re-uploaded" (as `DataSourceService.previewCsv`); an engine
`IllegalArgumentException` (the engine's curated failures) → 502 with its message (source name/id, no rows, no
credentials); any other exception → 502 with a generic "Failed to read source" message; encoder bug → 500.

**D10. Playwright (task 3.6).** Static cases (dataset exact, uploaded CSV over 1,000 rows) use real sources end to end.
The non-static cases cannot reach a real REST/SQL host from the dev stack (blocked-host checks refuse localhost), so
those two screenshots fulfil `/sample` with `page.route` using a fixture that validates against the committed schema;
the network-count assertions (capture once, zero on edits, one on refresh) run against the real endpoint.

## Risks / Trade-offs

- [Editor grantee on a shared pipeline gets 404 for a source they do not own] → label shows "Sample unavailable";
  matches the existing preview routes per the ticket; flagged as a follow-up candidate for (e).
- [A 50,000-row CSV loads fully before `take(1000)`] → identical to a run's own load; bounded by `CsvLimits`.
- [Sample endpoint shares the 30/min bucket with preview/test] → intended (ticket); a 3-root pipeline costs 3.
- [`sourceRowCount` null] → label "first 1,000 of 1,000+ rows"; wording is reversible.

## Migration Plan

None. Additive endpoint and client state; rollback is a revert.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or pre-commit script is touched.

## Planner Notes

Self-approved: route path (D1), image refusal (D5), `live` field addition beyond the ticket's four fields (D4), label
placement and wording (D8). Driver claims verified: `loadRowsWithStats` is the engine path; no existing route returns
this; limiter scope is inside the route classes.
