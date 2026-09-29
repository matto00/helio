## 1. Backend — migration & SQL casting

- [x] 1.1 Add `backend/src/main/resources/db/migration/V111__safe_cast_functions.sql` creating
  `safe_numeric(text) RETURNS numeric` (plain `LANGUAGE sql IMMUTABLE`, regex-guarded `CASE`, no
  exception handling) and `safe_timestamptz(text) RETURNS timestamptz` (`LANGUAGE plpgsql
  STABLE` — corrected from `IMMUTABLE` per skeptic-design-5.md CR1; `STABLE` because its result for
  a zone-less input depends on the session's `TimeZone` setting, which `IMMUTABLE` disallows
  depending on — with an `EXCEPTION WHEN OTHERS THEN RETURN NULL` guard — D2 round 3: reverted from
  pure SQL because regex digit-shape does not imply calendar validity, and stripping a trailing
  `[Zone/Id]` bracket via `regexp_replace` before casting) exactly as specified in design.md D2 —
  the regex and full behavior were already verified end-to-end against a live Postgres 18 instance
  during design (see D2 rounds 1-3). Verify with `sbt test` running Flyway clean against the new
  migration with no error, plus a repository-level test re-confirming, against THIS environment's
  actual Postgres version: the six original cases (no-seconds, offset+no-seconds,
  full-ISO+bracket, `MM/dd/yyyy`, bare date, garbage) AND the four calendar-invalid cases
  (`2024-02-30`, `2024-13-45`, `9999-99-99`, `13/45/2024`) all return `NULL` — none may throw.
- [x] 1.2 Add a `DataFieldType` → sortable-cast-expression mapping used by
  `NodeSnapshotRepository` (D2): Structured types map to a cast expression
  (`safe_numeric`/`safe_timestamptz`/plain text); Content types and unknown/absent columns map to
  "not sortable". Verify with a unit test covering every `DataFieldType` case.

## 2. Backend — sort/filter in `listRowsPaged`

- [x] 2.1 Extend `NodeSnapshotRepository.listRowsPaged` to accept an optional sort
  `(column, direction, castExpr)` and an optional filter predicate (quick term +
  per-column terms, D1/D6), building the `ORDER BY`/`WHERE` fragments with bound parameters only
  (never string-interpolated column/value) — `row_index ASC` always appended as the final `ORDER
  BY` tiebreaker (D4). Verify with a repository-level test against a real Postgres fixture with
  >1 page of rows, asserting sort order and stable pagination across two offset calls.
- [x] 2.2 Make the count query share the same `WHERE` fragment as the data query so `total`
  reflects the filtered set when a filter is present (D5). Verify with a test asserting `total`
  equals the filtered-row count, not the raw row count, when a filter narrows the set.
- [x] 2.3 Add the required RED-FIRST security probe (D6, Iron Law): a test sending a hostile
  column name (e.g. `'; DROP TABLE node_snapshots; --`) as `sort`'s column or a `filter.columns`
  key, asserting `400` with no SQL error and no data-table effect. Confirm this test FAILS against
  an unparameterized/naive implementation before the real fix, then passes after.

## 3. Backend — service & route wiring

- [x] 3.1 Extend `OutputService.rows` to resolve `sort`/`filter` against `output.schema`
  (Structured-category check, D2/D3), returning a typed rejection (column name + which param) for
  a non-eligible column, before ever calling `listRowsPaged`. Verify with a service-level test for
  both the sort-rejection and filter-rejection cases.
- [x] 3.2 Add `sort`/`filter` query-parameter parsing to `OutputRoutes.scala`'s `rows` route
  (D1): validate `sort`'s direction against `{asc, desc}` in Scala (400 on anything else) and
  parse `filter`'s JSON (400 on malformed JSON), preserving the existing `offset`/`limit`
  validation unchanged. Verify with a route-level test for malformed `sort`/`filter` producing 400.
- [x] 3.3 Confirm `OutputService.rows`'s existing `outputRepo.findById(id, user)` ACL gate still
  runs before any sort/filter-aware query — no new code path bypasses it. Verify with a test: a
  caller with no ACL relationship to the Output gets `404` even when `sort`/`filter` params are
  present.
- [x] 3.4 Add `NodeSnapshotRepository.hasAnyRow(pipelineId, nodeStepId, explicitRootId):
  Future[Boolean]` (D5 amendment) and wire `OutputService.rows`'s `materialized` derivation to use
  it instead of `paged.total > 0` whenever a filter is active (unfiltered requests keep today's
  exact `paged.total > 0` check, unchanged). Do NOT modify `PagedResult[A]`'s shape or
  `PublicDashboardRoutes.scala:95`'s own unrelated `listRowsPaged` call site. Verify with a
  RED-FIRST test: seed an Output with real rows, apply a filter matching zero of them, confirm
  this test FAILS against the current `paged.total > 0` logic (reports `materialized: false`),
  then passes after the fix (`materialized: true`); also verify the genuinely-never-materialized
  case (no rows at all, no filter) is unaffected.

## 4. Frontend — state ownership, request wiring & pagination reset

- [x] 4.1 Lift authoritative sort/filter state from `TableRenderer`'s local `useState` up to
  `PanelCardBody` (D4 rewrite): add `activeSort`/`activeFilter` state there, seeded from the
  Output config's `columnSort`/`columnFilters` defaults. Verify with a component test asserting
  the seeded values reach `TableRenderer` unchanged on first render.
- [x] 4.2 Add `onSortChange`/`onFilterChange` callback props threaded `TableRenderer` →
  `PanelContent` → `PanelCardBody` (D4). Call them from the UNCONDITIONAL first half of
  `handleSort`/`handleFilterChange` (alongside `toggleSort`/`setFilters`), leaving the existing
  `canWrite`-gated second half (the debounced `persistColumnSort`/`persistColumnFilters` PATCH,
  lines 507-550) completely unmodified — D4's explicit reconciliation with HEL-448 D7. Verify with
  TWO component tests: (a) an owner (`canWrite: true`) interacting with sort/filter fires both the
  new callback AND the existing debounced config PATCH; (b) a non-owner shared-dashboard viewer
  (`canWrite: false`) interacting with sort/filter fires the new callback (drives the server
  refetch) but does NOT fire the config PATCH — the exact split D4 mandates, and the specific
  regression (silently no-op for viewers) skeptic-design-2.md's change request 2 flagged as
  possible under an under-specified design.
- [x] 4.3 On either callback firing, `PanelCardBody` dispatches `resetPanelPagination(panelId)`
  (wiring its first real call site) and calls `fetchPanelPage` with `page: 0` and the new
  `sort`/`filter` params (D4), serializing `TableColumnFilters` as `filter`'s JSON. Verify with a
  thunk/component test: changing sort/filter after "Load more" has run clears previously appended
  rows and the next request's URL carries the new `sort`/`filter` params, with no duplicated or
  dropped rows across two subsequent page fetches at the new sort/filter.
- [x] 4.4 Remove `useSortedRows`'s active client-side re-sort for server-sortable columns (D4) —
  rows rendered are the server-sorted rows as-received; only `tableFilterPredicate.ts`'s
  `rowMatchesFilters` remains, now reading `activeFilter` from `PanelCardBody` rather than local
  state (transient-window masking only, D7). Verify with a test asserting no client-side reordering
  occurs after a server-sorted response is received.
- [x] 4.5 Gate the sort control and per-column filter input on `output.schema`'s Structured-type
  check (D3) so a Content-category or undeclared column's sort/filter control is disabled, with a
  visible reason (tooltip or similar) — never silently absent with no explanation. Verify with a
  component test rendering a Content-category column.
- [x] 4.6 Handle a `400` sort/filter-rejection response (defense-in-depth, D3) with a visible
  non-silent error rather than a swallowed failure. Verify with a component test simulating the
  400 response.
- [x] 4.7 (D10, owner-ruled scope addition, skeptic-design-5.md CR2) `PanelCardBody` computes
  `filterActive = isFiltering(activeFilter ?? undefined)` (skeptic-design-6.md non-blocking note:
  `activeFilter` is typed `TableColumnFilters | null` per D4, while `isFiltering` takes
  `TableColumnFilters | undefined` — `?? undefined` is required for this to compile under this
  repo's strict-mode frontend tsconfig; `isFiltering`'s runtime body already treats `null`/
  `undefined` identically, so this is a type-only fix with no behavior change) — reusing
  `tableFilterPredicate.ts`'s existing `isFiltering`, no new predicate — and passes
  `noData: rawNoData && !filterActive` to
  `PanelContent` instead of `usePanelData`'s raw `noData`, so `PanelContent`'s top-level
  `noData`/`neverMaterialized` short-circuit (`PanelContent.tsx:348-378`) is bypassed — falling
  through to mount `OutputPanelContent`/`TableRenderer` — whenever a table filter is genuinely
  active, regardless of `materialized`. RED-FIRST test required: seed a >1-page Output, apply a
  filter matching zero rows across the whole Output, confirm this test FAILS against current
  `main` (renders `PanelContent`'s generic "No data available", dropping the filter UI and Clear
  Filters affordance entirely), then passes after the fix (renders `TableRenderer`'s own
  `emptyText`/`emptyAction` "No rows match your filter." + working "Clear filters" button, which
  clicking clears the filter and refetches the unfiltered set). Also verify: (a) an UNFILTERED
  empty/never-run Output is completely unaffected — `PanelContent`'s `neverMaterialized`/`noData`
  states still render normally; (b) round 4's `hasAnyRow`-derived `materialized` value is
  unchanged by this task (D10 only changes which render path is taken, never `materialized`'s
  value).
- [x] 4.8 (D10) Restate `TableRenderer.tsx:632-634`'s "in the N rows loaded so far... load more to
  widen the search" / "...may match" strings — collapse all three `filtering && isEmpty` cases
  (truncated-with-load-more, truncated-without-load-more, not-truncated) to the single
  `"No rows match your filter."`, matching design.md D10's rationale (once filtering is
  server-side, `rowsTruncated` is itself false whenever the true filtered total is 0, so "more
  rows may match" is no longer a real state). Do not change `showLoadMoreBtn`'s existing gating —
  it already correctly hides the "Load more" button in the true zero-total case. Verify with a
  component test asserting the new copy for both the truncated (transient) and non-truncated
  cases, and grep for the removed "rows loaded so far"/"widen the search" strings with zero hits.

## 5. Frontend — disclosure rewrite

- [x] 5.1 Remove `LoadedScopeDisclosure`'s `!filtering` truncation-note branch ("Sort covers only
  the loaded rows.") entirely (D7). Verify by grepping for the removed string with zero hits and
  updating/removing its now-obsolete test cases.
- [x] 5.2 Collapse the `filtering` branch to a single "{total} {result|results}." using the
  server's filtered `total` (D7), removing the "N of M loaded rows match" loaded-vs-matched
  wording. Verify with a component test asserting the new copy for both the exact-fit and
  truncated-total cases.
- [x] 5.3 Confirm `tableFilterPredicate.ts`'s `rowMatchesFilters` is retained (client-side render
  filter for the currently-loaded page) but no longer feeds the displayed count (D7). Verify by
  reading its call sites and confirming the count now reads from the server response.

## 6. Schema & OpenSpec contract

- [x] 6.1 Update `schemas/` for `GET /api/outputs/:id/rows`'s new `sort`/`filter` query
  parameters and the filtered-`total` semantics. Verify with the repo's schema-drift check
  (pre-commit hook) passing.
- [x] 6.2 Confirm `openspec/specs/output-routes-api/spec.md`'s delta (already drafted in
  `specs/output-routes-api/spec.md`) matches the implemented behavior exactly; amend either side
  if they've drifted during implementation. Verify with `openspec validate
  server-side-sort-filter-output-rows --type change` passing.

## 7. Tests — end-to-end / UI verification

- [x] 7.1 Add a backend integration test seeding an Output with >1 page of rows (some with
  malformed numeric values) and asserting: (a) sort ranks the WHOLE Output — the red-first proof
  required by the Iron Laws, confirmed FAILING against current `main` (client-side sort ranks only
  the fetched window) before the fix, then passing; (b) pagination is stable across two page
  fetches; (c) a malformed row sorts last, not 500.
- [x] 7.2 Add a backend integration test seeding an Output with >1 page of rows where a filter
  matches fewer than one page across the WHOLE Output, asserting `total`/`hasMore` describe the
  filtered set — red-first against current `main` (raw total), then passing after the fix.
- [x] 7.3 Live UI verification (both light and dark theme) against this worktree's own dev
  server (confirm `readlink /proc/<pid>/cwd` points at this worktree, not a reused server): sort a
  table panel bound to a >1-page Output by a numeric column and confirm the top-ranked row is
  genuinely the Output's max, not the fetched window's max; filter it and confirm the displayed
  count and "Load more" affordance describe the filtered set.
