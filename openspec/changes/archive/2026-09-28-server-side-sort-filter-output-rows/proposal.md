## Why

`GET /api/outputs/:id/rows` only offset/limit-paginates; table-panel sort (HEL-448) and filter
(HEL-451) operate client-side over whatever page has been fetched (200 rows initial, +50 per
"Load more"), so on an Output larger than one page a sort ranks only the fetched window and a
filter's `hasMore`/count describe the raw set, not the filtered one — both silently wrong. HEL-448
and HEL-451 each explicitly deferred this here; HEL-915 (dashboard variables) needs the same
server-side query surface as its hard prerequisite.

## What Changes

- Add `sort` (`column:asc|desc`) and `filter` (quick + optional per-column terms, mirroring
  HEL-451's shipped case-insensitive "contains" semantics — no richer operator set exists to
  replicate) query parameters to `GET /api/outputs/:id/rows`, applied in SQL before the
  offset/limit window, with `row_index` as a stable ORDER BY tiebreaker.
- Resolve column sortability from the Output's own declared field types (no row-0 inference);
  define non-silent behavior for a column with no declared/resolvable type.
- Return `total` computed over the filtered set (not the raw set) so `hasMore` and any displayed
  count are accurate once a filter is active.
- Frontend: send `sort`/`filter` params, reset pagination coherently on either changing, and fall
  back to a defined (never silent) behavior for a non-server-sortable column.
- Remove or restate HEL-448's truncation qualifier and HEL-451's loaded-scope disclosure
  (`LoadedScopeDisclosure.tsx`) now that both are whole-Output-accurate.
- Update `schemas/` and `openspec/specs/output-routes-api/spec.md` for the new query parameters
  and response semantics.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `output-routes-api`: `GET /api/outputs/:id/rows` gains `sort`/`filter` query parameters; the
  returned `total` reflects the filtered set (not the raw Output) when a filter is present.

## Impact

- Backend: `OutputRoutes.scala`, `OutputService.rows`, `NodeSnapshotRepository.listRowsPaged`
  (new sort/filter SQL, bound parameters only — user-supplied column/value never interpolated),
  Output field-type/schema lookup.
- Frontend: `usePanelData.ts`, `PanelCard.tsx`, `panelThunks.ts`, `panelsSlice.ts`,
  `tableFilterPredicate.ts` (client fallback only), `LoadedScopeDisclosure.tsx`.
- Schemas/openspec: `schemas/` request/response shape for `GET /api/outputs/:id/rows`,
  `openspec/specs/output-routes-api/spec.md`.
- No change to the Output ownership/ACL gate (`outputRepo.findById`) — sort/filter params must
  not introduce a second access path.

## Non-goals

- HEL-915 (dashboard variables) itself — only designing the query params so it can reuse them.
- Chart panels' first-200-rows behavior, and HEL-588 cross-filter / HEL-572 drill-down (both
  operate client-side over already-loaded rows and are unaffected by this ticket).
- A richer filter-operator set beyond HEL-451's shipped "contains" semantics.
