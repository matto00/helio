# Files modified — HEL-1027 server-side sort/filter for Output rows

Enumerated against the live-resolved review base (`resolve-review-base.sh`, `main`/`origin`),
currently `55ad1d6d`.

## Backend

- `backend/src/main/resources/db/migration/V111__safe_cast_functions.sql` — new: `safe_numeric`/`safe_timestamptz` SQL functions (D2), copied close to verbatim from design.md's live-Postgres-18-verified definitions.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala` — extends `listRowsPaged` with optional `sort`/`filter` (bound-parameter-only WHERE/ORDER BY fragments, D1/D2/D4/D6); adds `hasAnyRow` (D5 amendment); adds `sortCastFor` + `SortSpec`/`FilterSpec`/`SortCast`/`SortDirection` on the companion object.
- `backend/src/main/scala/com/helio/services/pipelines/OutputRowsQuery.scala` — new: route/service-boundary `SortParam`/`FilterParam` types and the schema-eligibility resolution logic (D2/D3), factored out to keep `OutputService.scala` within its file-size budget.
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — `rows` resolves `sort`/`filter` against `output.schema` before querying; `materializedFor` decouples the `materialized` signal from a (now possibly-filtered) `paged.total` (D5 amendment).
- `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala` — parses/validates `sort`/`filter` query params (D1/D3/task 3.2) before calling `OutputService.rows`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — new test coverage: V111 functions (task 1.1), `sortCastFor` (1.2), `listRowsPaged` sort/filter incl. LIKE-metacharacter escaping (2.1/2.2), the required RED-FIRST SQL-injection probe (2.3), route/service sort-filter validation (3.1-3.3), the RED-FIRST `materialized` fix proof (3.4), and the two mandated end-to-end RED-FIRST proofs (7.1 sort-ranks-the-whole-Output, 7.2 filtered total/hasMore) — both independently confirmed red (via a temporary revert, restored) and green.

## Frontend

- `frontend/src/features/pipelines/services/outputService.ts` — `getOutputRows` gains optional `sort`/`filter` params (`OutputRowsSort`/`OutputRowsFilter`), serialized to the new query params.
- `frontend/src/features/pipelines/types/output.ts` — adds `isStructuredFieldType` (D2/D3 client-side mirror of `DataFieldType.category`).
- `frontend/src/features/panels/state/panelThunks.ts` — `fetchPanelPage` accepts and forwards optional `sort`/`filter`; fulfilled payload carries the server's `total`.
- `frontend/src/features/panels/state/panelsSlice.ts` — `PanelPaginationState` gains `total`; `fetchPanelPage.pending`/`.fulfilled` populate it.
- `frontend/src/features/panels/types/panel.ts` — `PanelPaginationState.total: number` (D5/D7).
- `frontend/src/features/panels/hooks/usePanelSortFilter.ts` — new: the authoritative sort/filter state hook (D4/D10) — seeds from the Output's persisted default (render-time "adjust state" pattern, not an effect, to satisfy this repo's `react-hooks/set-state-in-effect` rule), fires a reset-then-refetch on either callback, and — a live-UI-verification finding (task 7.3) — also fires that refetch once on mount when the seeded default is itself genuinely active, so a persisted filter/sort is correct from first paint rather than only after the next interaction.
- `frontend/src/features/panels/ui/PanelCard.tsx` — `PanelCardBody` wires `usePanelSortFilter`, overrides `noData` with `!filterActive` (D10 empty-state fix), threads the new callbacks and `totalRowCount` into `PanelContent`.
- `frontend/src/features/panels/ui/PanelContent.tsx` — threads `onSortChange`/`onFilterChange`/`totalRowCount` and the Output's `schema` down to `TableRenderer`.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — accepts `schema`/`onSortChange`/`onFilterChange`/`totalRowCount`; fires the new callbacks from the unconditional (never `canWrite`-gated) first half of `handleSort`/`handleFilterChange` (D4); bypasses client-side reordering only when a real server round trip exists (`usingPagination && onSortChange`); gates each column's sort/filter control on `schema` (D2/D3); collapses the empty-filter message (D10/task 4.8); **fixes a genuine, RED-FIRST-confirmed bug found via task 4.7's own proof**: `usingPagination`'s old `paginationRows.length > 0` check conflated "no fetch yet" with "fetched, zero rows" — a real server-side zero-match filtered result silently fell through to the bare unstyled skeleton instead of `DataGrid`'s own empty state; fixed to `paginationRows !== null/undefined`, with a `schema`-derived column-name fallback for the now-reachable zero-row case (`deriveKeys` has no rows to infer from).
- `frontend/src/features/panels/ui/renderers/LoadedScopeDisclosure.tsx` — the `!filtering` branch (HEL-448's "Sort covers only the loaded rows.") now always returns `null` (D7/task 5.1); the cross-filter call site (`PanelContent.tsx`, always `filtering: true`) is unaffected.
- `frontend/src/shared/ui/DataGrid.tsx` / `DataGrid.css` — `ColumnDef.disabledReason` (D3/task 4.5): a per-column override that suppresses that column's sort control (a titled plain label instead) and disables its filter input, independent of the grid-wide `sortable`/`filterable` flags.
- `frontend/src/features/panels/hooks/usePanelSortFilter.test.ts` (new) — tests for the new
  authoritative sort/filter state hook above.
- `frontend/src/features/panels/ui/PanelCard.filterEmptyState.test.tsx` (new) — the mandated D10
  RED-FIRST proof, independently confirmed red/green.
- `frontend/src/features/panels/ui/renderers/TableRenderer.test.tsx` — updated for the new `total`
  field / new query-param arity / superseded HEL-448 assertions.
- `frontend/src/shared/ui/DataGrid.test.tsx` — updated for the new `ColumnDef.disabledReason`
  override (D3/task 4.5).
- `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx` — updated for the new `total`
  field / superseded HEL-448 assertions.
- `frontend/src/features/panels/state/panelsSlice.test.ts` — updated for the new `total` field /
  new query-param arity.
- `frontend/src/features/panels/hooks/usePanelData.test.ts` — updated for the new `total` field /
  new query-param arity.
- `schemas/outputs/output-rows-response.schema.json` — new: this endpoint's response had no tracked JSON Schema before this ticket; added one (title `OutputRowsResponse`) documenting the unchanged field set and the new filtered-`total` semantics, closing that pre-existing gap rather than leaving task 6.1 a no-op.

## Root-cause / red-first evidence (Iron Laws)

1. **Backend SQL-injection probe (task 2.3).** Root cause class: a naive query-builder that string-interpolates a caller-supplied column name into SQL text is vulnerable to stacked-query injection via `java.sql.Statement`'s simple-query-protocol mode. Probe: a standalone JDBC statement (`OutputRoutesSpec.scala`, "RED:" test) splices a hostile value into a bare SQL string and confirms it drops a real table. Fix: every user-supplied value in `NodeSnapshotRepository` is a bound parameter (never interpolated); confirmed via two GREEN tests (repo-level hostile column name is a harmless literal; route-level hostile column name is rejected `400` before reaching SQL at all, per D3's schema gate).
2. **`materialized` derivation under a filter (task 3.4).** Root cause: `paged.total > 0` was a correct proxy for "has real data" only while `total` always meant the raw row count; once `total` can mean "filtered count" (D5), a legitimate zero-match filter on a real Output would read as `materialized: false`. Probe: `OutputRoutesSpec`'s RED-FIRST test computes the naive proxy's value directly against the fix's own `hasAnyRow` path and asserts it would have been wrong (`naiveWouldReportFalse shouldBe true`) before asserting the real endpoint reports the correct `materialized: true`.
3. **Sort-ranks-the-whole-Output (task 7.1, mandated).** Root cause: pre-ticket, `sort`/`filter` query params had no server-side effect at all — Pekko's `parameters` directive silently ignores unrecognized params, so the endpoint always returned `row_index`-ascending order regardless. Probe: temporarily reverted `OutputRoutes.scala`'s `rows` handler to call `outputService.rows(outputId, page, user)` (ignoring the parsed `sort`/`filter`, exactly current-main's behavior) and re-ran the new test — it failed exactly as expected (`Vector(0..19)` instead of `Vector(59..40)`); reverted the probe, re-ran, confirmed green. Pasted evidence in this cycle's transcript.
4. **D10 filter-aware empty state (task 4.7, mandated) — TWO compounding root causes found.** (a) `PanelContent`'s top-level `noData` short-circuit doesn't know a table filter is active. (b) **Found only by running the RED-FIRST proof, not anticipated by design.md**: `TableRenderer`'s own `usingPagination` gate (`paginationRows.length > 0`) ALSO excludes a genuine zero-row fetched result, independently routing it to a bare unstyled skeleton instead of `DataGrid`'s `emptyText` path — so bypassing (a) alone was not sufficient. Probe: temporarily reverted BOTH fixes (`PanelCard.tsx`'s `effectiveNoData` back to plain `noData`, `TableRenderer.tsx`'s `usingPagination` back to the `.length > 0` check) and re-ran `PanelCard.filterEmptyState.test.tsx` — failed (`No rows match your filter.` never rendered); restored both, re-ran, confirmed green (2/2 passing). Pasted evidence in this cycle's transcript.
5. **Live-UI-verification finding (task 7.3, not anticipated by design.md).** A table Output with a genuinely active PERSISTED filter/sort (no interaction yet this session) showed the WRONG total on first paint — `usePanelData`'s own mount fetch is always unsorted/unfiltered, so the disclosure read the raw total ("60 results.") while the grid itself (seeded from `TableRenderer`'s own, separately-resolved config) correctly showed only the 3 matching rows. Root cause: `usePanelSortFilter`'s seeding only updated LOCAL state; nothing re-triggered the fetch for a persisted-but-not-yet-interacted-with default. Fix: an effect fires the same reset-then-refetch a real interaction uses, once, when the seeded default is genuinely active. Verified live: `curl`-seeded a 60-row real dataset/pipeline/table-Output/dashboard/panel against this worktree's own dev servers (backend pid confirmed via `/proc/<pid>/cwd`, port 9366; frontend port 6459), reproduced the bug pre-fix, confirmed the fix in a real Chromium session in BOTH light and dark theme (screenshots + real network request logs showing `sort=revenue:desc` / `filter={"quick":"target",...}` genuinely reaching the server, correct `59` top-ranked row, correct `3 results.` disclosure).

## Deviation from design.md worth flagging for review

Design.md D4 describes `TableRenderer`'s `columnSort`/`columnFilters` props becoming fully
"controlled" by `PanelCardBody`'s lifted state. The actual implementation keeps `TableRenderer`'s
own local `useState`-owned `filters`/`sortState` as the value rendered (unchanged from
pre-ticket), and only ADDS the new `onSortChange`/`onFilterChange` callbacks alongside it —
`PanelCardBody`'s `usePanelSortFilter` state is consulted only for (a) `filterActive` (D10) and
(b) the params sent on the next fetch, never threaded back down as `TableRenderer`'s rendered
value. This was a deliberate choice to avoid reintroducing the exact "two independent
`useOutputMeta` fetches of the same Output racing" defect class this codebase already fixed once
(`PanelContent.tsx`'s own evaluation-1.md CR1/CR2, cited in-file) — `PanelCardBody` necessarily
resolves `output` via a second `useOutputMeta` call (reused from `PanelCard`'s existing
`chartInspectConfig` one, not a new fetch) that is NOT guaranteed to resolve in lockstep with
`OutputPanelContent`'s own. The functional intent (sort/filter changes drive a correct
server-side round trip; D10's empty state fix; a persisted default is honored) is fully met and
tested; only the literal "props become the single source of truth for rendering" mechanism
differs. Flagging explicitly per the executor brief's instruction to treat a genuine
design/implementation conflict as a finding, not license to silently improvise.

## Known, accepted, documented limitation

`usePanelSortFilter`'s Output-config seed (for `filterActive`/the persisted-default refetch) comes
from a SEPARATE `useOutputMeta` call than `TableRenderer`'s own (see the deviation note above and
the hook's own doc comment). In the narrow case where these two independent fetches of the same
Output settle more than one render apart, `filterActive` could theoretically read a stale value
for one extra render — bounded, purely cosmetic, and never a wrong PERSISTED value once both
resolve. Not reproduced in any test or the live verification above; documented rather than
silently accepted.

`MobilePanelStack`'s `MobileStackPanelBody` does not pass the new `output` prop to
`PanelCardBody` at all (mirrors evaluation-1.md CR1/CR2's explicit decision not to add a second
`useOutputMeta` there) — `usePanelSortFilter` degrades gracefully (no persisted-default seeding,
but the interactive sort/filter round trip still works fully) for the read-only mobile stack.

## Cycle 2 — skeptic-final-1.md (REFUTE), two blocking defects fixed

Full report: `openspec/changes/server-side-sort-filter-output-rows/skeptic-final-1.md`. Both
defects were live-reproduced by the skeptic against this worktree's own dev servers; both are now
fixed, covered by a NEW regression test each (independently red-first proven by this executor —
see below), and re-verified live in a fresh Chromium session against this worktree's own dev
servers (backend pid/cwd and frontend pid/cwd re-confirmed via `/proc/<pid>/cwd`, ports 9366/6459
unchanged from cycle 1).

### Files changed this cycle

- `frontend/src/features/panels/hooks/usePanelSortFilter.ts` — (a) the server refetch
  `handleSortChange`/`handleFilterChange` trigger is now DEBOUNCED (`REFETCH_DEBOUNCE_MS = 300`),
  separate from `TableRenderer`'s own unconditional local UI update and separate from its
  `canWrite`-gated persist debounce (Defect 1, CR1); (b) no longer dispatches
  `resetPanelPagination` at all — relies on `fetchPanelPage.pending`'s existing "keep previous
  rows visible, `isLoadingMore: true`" behavior instead, which is what keeps `TableRenderer` (and
  the filter input itself) mounted through a refetch instead of `usePanelData.isLoading` flipping
  back to `true` and swapping in the full skeleton (Defect 1, CR1); (c) now exposes
  `activeSort`/`activeFilter` so a caller's own "Load more" can carry them (see
  `PanelCard.tsx` below — a self-found, related AC #2 gap, not one of the skeptic's four CRs).
- `frontend/src/features/panels/state/panelsSlice.ts` — new `latestFetchRequestId: Record<string,
  string>` on `PanelsState`, populated in `fetchPanelPage.pending` and checked in
  `.fulfilled`/`.rejected`: a response whose OWN dispatch is no longer the latest one recorded for
  the panel is discarded, regardless of which promise happens to resolve first (Defect 2, CR2).
- `frontend/src/features/panels/ui/PanelCard.tsx` — `handleLoadMore` (page > 0) now carries the
  current `activeSort`/`activeFilter` (a self-found, related AC #2 gap: "Load more" previously
  fetched page N+1 with NO sort/filter at all, silently reverting an appended page to the raw
  unfiltered/unsorted default).
- `frontend/src/features/panels/state/panelThunks.ts` — comment-only update reflecting the above
  (no `resetPanelPagination` call anymore; sequencing lives in `panelsSlice.ts`, not here).
- `frontend/src/features/panels/ui/PanelCard.filterTyping.test.tsx` (new) — CR3's mandated
  regression test: a REAL DOM typing sequence (`fireEvent.change` per keystroke through the actual
  rendered quick-filter AND a per-column filter input, via a real `PanelCardBody` + real
  `usePanelData`/`useOutputMeta`), asserting the input stays mounted and shows the full typed
  value after EVERY keystroke, and that exactly one debounced request carries the FULL final term.
- `frontend/src/features/panels/ui/PanelCard.staleFetchSequencing.test.tsx` (new) — CR4's mandated
  regression test: mounts a panel with a persisted `columnFilters` default inside
  `<React.StrictMode>` (real double-invoke, not mocked away), controls exactly when the stale
  unfiltered vs. correct filtered `getOutputRows` promises resolve (filtered first, stale
  unfiltered last), and asserts the settled `total`/rows match the server's filtered result.
- `frontend/src/features/panels/ui/PanelCard.loadMoreCarriesSortFilter.test.tsx` (new) — regression
  test for the self-found "Load more" gap above.
- `frontend/src/features/panels/hooks/usePanelData.test.ts`,
  `frontend/src/features/panels/ui/PanelCardBody.fanoutStatus.test.tsx`,
  `frontend/src/features/panels/state/panelsSlice.test.ts`,
  `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx`,
  `frontend/src/test/renderWithStore.tsx` — add the new required `latestFetchRequestId: {}` field
  to hand-built `PanelsState` fixtures/harnesses (a genuinely NEW required field breaks any fixture
  that constructs `PanelsState` without going through `panelsReducer(undefined, init)` — these were
  the ones missing it). `panelsSlice.test.ts` also gained explicit `.pending` dispatches ahead of
  hand-constructed `.fulfilled`/`.rejected` actions (matching REAL dispatch order, which every
  production call site already follows) plus two new direct reducer-level tests for the
  `latestFetchRequestId` staleness guard itself.

### Root-cause / red-first evidence for this cycle (Iron Laws)

**Defect 1 (keystrokes dropped).** Root cause: `usePanelSortFilter.refetchFirstPage` (as shipped in
cycle 1) dispatched `resetPanelPagination` — a hard `delete` of the pagination entry — synchronously
on EVERY `onFilterChange`/`onSortChange` call, i.e. every keystroke. `usePanelData.isLoading`
(`paginationEntry == null || (isLoadingMore && rows.length === 0)`) then went `true` again
immediately, and `PanelContent`'s `if (isLoading) return <PanelBodySkeleton/>` unmounted the ENTIRE
`TableRenderer` — including the filter textbox itself — mid-keystroke. Probe: reverted
`usePanelSortFilter.ts`/`PanelCard.tsx` to the exact cycle-1-committed (`ad84d7f6`) versions via
`git show ad84d7f6:<path>`, ran `PanelCard.filterTyping.test.tsx` — failed exactly as predicted:
by the SECOND keystroke, `screen.getByRole("textbox", {name: "Quick filter across all columns"})`
could no longer be found at all — the DOM showed only the `panel-body-skeleton` loading state.
Restored the fix, re-ran — 2/2 passing. Also re-verified live: `page.pressSequentially("revenue",
{delay: 60})` on the real dev server now keeps the input attached and showing `"revenue"`
throughout, and the network log shows exactly ONE `filter=` request, carrying the full term.

**Defect 2 (stale response overwrites a newer one).** Root cause: no site in `fetchPanelPage`'s
dispatch/reducer chain discarded a response whose dispatch had already been superseded by a later
one for the same panel — `fetchPanelPage.fulfilled` unconditionally overwrote
`rows`/`total`/`hasMore` from whichever response's promise happened to resolve last, regardless of
which was dispatched last. Probe: reverted `panelsSlice.ts` to the cycle-1-committed version, ran
`PanelCard.staleFetchSequencing.test.tsx` (mounts inside `<React.StrictMode>`, resolves the
correct filtered response FIRST then the stale unfiltered one LAST) — failed exactly as predicted:
settled `total` was `60` (the stale unfiltered value) instead of `3` (the correct filtered value).
Restored the fix (`latestFetchRequestId`), re-ran — passing. Also re-verified live: seeded a
persisted `columnFilters` default via the API, loaded the dashboard fresh (not from a prior
in-session interaction), and confirmed the settled disclosure reads `"3 results."` (server ground
truth, independently confirmed via a direct `GET .../rows?filter=...` call) — never the raw `60`.

**Self-found "Load more" gap.** Root cause: `PanelCard.tsx`'s `handleLoadMore` never included
`sort`/`filter` in its page>0 dispatch at all (this simply didn't exist before this ticket added
server-side sort/filter — the omission was never exercised until now). Probe: temporarily removed
the `sort`/`filter` fields from `handleLoadMore`'s dispatch, ran
`PanelCard.loadMoreCarriesSortFilter.test.tsx` — failed (`sort` argument was `undefined` instead of
the active sort). Restored the fix, re-ran — passing.

### Gate results this cycle (fresh)

Frontend-only cycle (no backend files touched — `git status --short` confirmed clean on every
`backend/` path before this cycle's edits, so the backend gate is unaffected and was not re-run;
cycle 1's fresh `sbt test` run — 4854/4854 — stands).

- `npm run lint` — clean (0 warnings).
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm test` — 28 helio-mcp suites / 271 tests + **359 frontend suites / 3892 tests, all passing**
  (up from 356/3885 at the end of cycle 1: +3 new test files, +7 new tests net).
- `npm --prefix frontend run build` — succeeded (pre-existing chunk-size warning only, unrelated).

## Cycle 3 — skeptic-final-2.md (REFUTE), one remaining defect: hardened, not confirmed-reproduced

Full report: `openspec/changes/server-side-sort-filter-output-rows/skeptic-final-2.md`. Owner
authorized proceeding past the final-gate round budget via escalation
`HEL-1027-1790637619254-5e0366` (resolution: "fix-and-reescalate-if-needed"). The skeptic reported
a table panel bound to a persisted-`columnFilters`-default Output settling on the WRONG total ("60
results." instead of "3 results.") after a genuinely fresh full-page reload, reproduced 3 times
(including with browser caches/storage cleared), and confirmed via React DevTools fiber
introspection that `paginationState[panelId].total` genuinely held `60` in the live Redux store.

### Investigation (honest account — extensive probing, inconclusive live reproduction)

Per the driver's explicit instructions, I instrumented rather than guessed, and specifically tested
the named leading hypothesis before anything else:

1. **Checked whether the effect never fires, or fires with stale values.** Added temporary
   `console.log("[HEL1027-PROBE] ...")` at the render-time seed block, the correction effect, and
   inside `dispatchFetch` (removed before commit — confirmed via `git diff --stat` showing zero diff
   after restoring from a pre-edit backup). Ran against a freshly-restarted dev server
   (backend pid 1411716, frontend pid 1655765 at the time, both `readlink /proc/<pid>/cwd`-confirmed
   against this worktree) with a real seeded Output (`fb968d18-34bc-442a-a32c-93ba6ca0199d`,
   persisted `columnFilters: {"quick": "target"}`). Across 11+ full-page-reload Playwright runs:
   - A plain reload: the seed block set `seededOutputId`/`activeSort`/`activeFilter` together, the
     correction effect fired, `dispatchFetch` was called, and the network showed the filtered
     request landing (`probe1.mjs`, `probe2.mjs`).
   - Exact StrictMode double-invoke timeline (`probe2.mjs`): two unfiltered `/rows` requests at
     +3022ms/+3049ms (React's double-invoke of `usePanelData`'s own mount effect), then the FILTERED
     request at +3165ms — always AFTER both unfiltered ones, so the sequencing guard
     (`latestFetchRequestId`, cycle 2) always correctly kept the filtered result.
   - Five artificially-skewed relative-timing configurations between the Output-metadata call and
     the rows call (`probe3.mjs`: 300/0ms, 0/300ms, 150/50ms, 50/150ms, 0/0ms delays) — all 5 runs
     settled on the correct filtered total.
   - Ruled out confounds explicitly: only one panel bound to this Output (checked via
     `GET /api/dashboards/:id/panels`); the dev server's service worker is not registered at all
     during `npm run dev` (`vite.config.ts`'s `devOptions: { enabled: false }`), so a stale
     service-worker cache cannot explain it either.
   - **None of the above reproduced the skeptic's reported symptom** in this environment.
2. **Widened `PanelCard.staleFetchSequencing.test.tsx`'s mock timing per CR3** — added a second
   test case using a genuinely deferred `getOutputById` (not `mockResolvedValue`), so
   `usePanelData`'s own unfiltered fetch(es) can fully SETTLE (store shows `total: 60`) BEFORE the
   Output's persisted config is even known, then resolves the Output and asserts the corrective
   filtered fetch fires and the store settles on `total: 3`. **This test passed against the
   currently-committed code (`2f24ea23`) without my fix applied** — i.e. it did not go red first.
   I could not construct a timing/ordering variant (in either the Playwright live probes or this
   Jest test) that reproduced the reported defect against the committed code, despite deliberately
   modeling the exact "metadata resolves after data" ordering the skeptic's DevTools trace implied.
3. **Conclusion, stated plainly**: I was unable to obtain probe-confirmed evidence of the specific
   mechanism causing the skeptic's live-reproduced symptom. This does not mean the defect is not
   real — the skeptic reproduced it 3 times with DevTools fiber introspection confirming real
   store state, which is strong evidence — only that I could not reproduce it in this environment
   with the timing orderings and confounds I was able to construct.

### Fix applied: hardening against a genuine, if-unconfirmed, structural fragility

The driver's message named a specific hypothesis to check: that the correction effect's dependency
array (`[seededOutputId]` alone, cycle-2-committed) rests on an UNVERIFIED assumption — that
`setSeededOutputId`/`setActiveSort`/`setActiveFilter` (three separate `useState` calls in the
render-phase seed block) always commit together in the same render, so the effect's closure could
never observe `seededOutputId` already updated while `activeSort`/`activeFilter` still held their
pre-seed (`null`) values. I could not prove this happens in this React version/environment, but I
also could not prove it can't — React does not document per-`useState`-call atomicity as a
contract, and relying on it un-declared (via an `eslint-disable-next-line react-hooks/exhaustive-deps`
suppression) is exactly the shape of bug this ticket's cycles 1-3 have repeatedly hit.

**Fix** (`frontend/src/features/panels/hooks/usePanelSortFilter.ts`): widened the correction
effect's dependency array from `[seededOutputId]` to
`[seededOutputId, activeSort, activeFilter, dispatchFetch]`, added an `appliedPersistedDefaultRef =
useRef(false)` guard to preserve the "fire the corrective fetch at most once" contract (later
`activeSort`/`activeFilter` changes from real user interaction continue to go through
`handleSortChange`/`handleFilterChange`'s own `debouncedRefetch`, never this effect), and removed
the now-unnecessary `eslint-disable-next-line` (all values the effect reads are now real
dependencies). This eliminates the theorized closure-staleness mechanism entirely, regardless of
whether it was the actual cause: if `activeSort`/`activeFilter` are ever set on a LATER render than
`seededOutputId` for any reason, the effect now re-runs with the correct values instead of being
permanently stuck with a stale closure.

**This is reported as a hardening measure, not a confirmed-root-caused fix**, per the
verification-before-completion Iron Law — I am not claiming certainty I don't have. The next
reviewer attempting live reproduction with React DevTools attached (as the skeptic did) may reveal
whether devtools instrumentation itself subtly alters effect scheduling in a way a bare
Playwright/jsdom session does not, which would explain why my probes never reproduced it.

### Feasibility analysis: "fold persisted default into the initial fetch" (owner's stated preference)

The owner's stated preference was to fold the persisted sort/filter into `usePanelData`'s FIRST
fetch, rather than "fetch unfiltered first, then correct." I evaluated this and did not implement
it, for a concrete reason: `usePanelData` is a shared, Output-kind-agnostic hook used by
`PanelCard`, `PanelDetailModal`, and `MobilePanelStack`, and its initial mount-effect fetch has no
existing dependency on Output metadata resolution at all — it fires as soon as the panel/outputId
is known. Making its FIRST fetch carry the persisted sort/filter would require either (a) delaying
every panel's initial fetch, of every Output kind, until Output metadata resolves (a behavior
change for chart/KPI/etc. panels that have no sort/filter concept and currently render as soon as
data arrives, not metadata), or (b) threading Output metadata as a new required input into
`usePanelData` itself and special-casing table panels inside a hook that is deliberately kind-
agnostic today. Both are broader, riskier refactors than this "narrow, targeted fix" cycle's scope
— per the owner's own explicit fallback permission ("only fall back to a corrective-second-fetch
approach if folding isn't feasible without a larger, riskier refactor"), I kept the existing
corrective-second-fetch shape (now hardened) rather than attempting the refactor.

### Files changed this cycle

- `frontend/src/features/panels/hooks/usePanelSortFilter.ts` — widened the persisted-default
  correction effect's dependencies (`[seededOutputId]` → `[seededOutputId, activeSort,
  activeFilter, dispatchFetch]`) plus an `appliedPersistedDefaultRef` guard; removed the
  now-unneeded `eslint-disable-next-line react-hooks/exhaustive-deps`. See "Fix applied" above for
  full rationale, documented in-file as well.
- `frontend/src/features/panels/ui/PanelCard.staleFetchSequencing.test.tsx` — added a second test
  (CR3): a genuinely deferred `getOutputById` (vs. the first test's `mockResolvedValue`), modeling
  `usePanelData`'s unfiltered fetch fully SETTLING before Output metadata (and the persisted
  filter default) is even known. Confirmed passing both before and after the fix (did not go red
  against `2f24ea23` — see "Investigation" above for why this is reported honestly as inconclusive
  rather than a red-first proof).

### Gate results this cycle (fresh)

- `npm run lint` — clean (0 warnings).
- `npx prettier --check` (both modified files) — clean.
- `npm run typecheck` — clean.
- `npm test` — 28 helio-mcp suites / 271 tests + **359 frontend suites / 3893 tests, all passing**
  (+1 net test from this cycle's new `PanelCard.staleFetchSequencing.test.tsx` case).
- `npm --prefix frontend run build` — succeeded (pre-existing chunk-size warning only, unrelated).
- Backend unaffected (no `backend/` files touched this cycle) — not re-run.

### Live re-verification (fresh dev-server restart)

Frontend dev server killed and freshly restarted via `scripts/concertino/start-servers.sh`
(new pid 1682514, `readlink /proc/1682514/cwd` confirmed pointing at this worktree's `frontend/`,
started after the fix was applied). Backend reused (already healthy, pid 1411716, cwd confirmed
against this worktree — unchanged since cycle 1). Re-seeded the Output's persisted filter
(`columnFilters: {"quick": "target"}`) via a direct authenticated `PATCH` and ran 4 independent
genuinely-fresh full-page Playwright reloads against `http://localhost:6459`:

```
=== /api/outputs/ calls (relative ms) ===
  +1259ms  GET  .../fb968d18-.../rows?offset=0&limit=200
  +1378ms  GET  .../fb968d18-.../rows?offset=0&limit=200&filter=%7B%22quick%22:%22target%22%7D
=== settled disclosure === 3 results.
=== filter= request count === 1
```
(repeated identically across all 4 runs — screenshot evidence:
`.concertino/runs/HEL-1027/evidence/HEL-1027-cycle3-post-fix-light.png`, showing the "target"
quick-filter chip, 3 matching rows, and "3 results." disclosure). The Output's config was reset to
`{columnSort: null, columnFilters: null}` afterward, matching cycle 2's end-of-cycle hygiene.

No pre-fix ("red") live capture was obtained this cycle, consistent with the investigation section
above — every attempt to reproduce the reported defect against the pre-fix code in this environment
settled correctly, so there was no red state to capture on this environment/these dev servers.

## Cycle 4 — skeptic-final-3.md (REFUTE), root cause found: mobile-stack prop-threading gap

Full report: `openspec/changes/server-side-sort-filter-output-rows/skeptic-final-3.md`. Owner
authorized proceeding via escalation `HEL-1027-1790641194186-60dd48` (resolution
"fix-mobile-path-and-reescalate"). The skeptic ROOT-CAUSED the defect cycle 3 could not
reproduce: it is not a timing race at all — `MobilePanelStack`/`MobileStackPanelBody` never
threaded a resolved `Output` into `PanelCardBody`/`usePanelSortFilter`, so the persisted-default
correction effect's own guard (`seededOutputId === null` → return) never cleared on the
phone-stack path, categorically, on every load — deterministic, not a race. The skeptic's own
controlled A/B (same build, same server, only viewport width changed) reproduced this twice:
375×812 → "60 results." (wrong, zero `filter=` requests); 1440×900 → "3 results." (correct)
immediately after. This explains why cycle 3's 11+ trials (all desktop-width) and the desktop-only
`PanelCard.staleFetchSequencing.test.tsx` never once caught it — they were testing a code path
where the bug cannot occur.

### Correcting cycle 3's characterization (per CR3)

Cycle 3's `usePanelSortFilter.ts` dependency-widening/ref-guard hardening STAYS (independently
confirmed safe and beneficial by both `evaluation-3.md` and `skeptic-final-3.md`) but is no longer
described as targeting an "unconfirmed mechanism" — the real mechanism is now known, root-caused,
and located one level up the component tree (mobile-stack prop-threading), not in that hook's
dependency array. The in-file comment and this document have been updated accordingly (see the
Cycle 3 section above, left historically accurate as "what was known/reasoned at the time," plus
this section's correction).

### Root cause, precisely

- `PanelCardBody`'s `output` prop (read by `usePanelSortFilter` to seed the persisted-default
  correction effect) was an OPTIONAL external prop only `PanelCard` (desktop) ever supplied, from
  its own separate `useOutputMeta(outputId)` call (kept for `chartInspectConfig`).
- `MobileStackPanelBody` never had a resolved Output to offer — `output` was `null` there,
  forever — so `usePanelSortFilter`'s `seededOutputId` state never transitioned off `null`, and
  the correction effect's own guard returned immediately on every render, permanently, for every
  table panel rendered through the phone stack.

### Fix: `PanelCardBody` becomes the single, shared Output-resolution point

Per CR1's explicit constraint — do NOT add a second, independent `useOutputMeta(outputId)` call
inside `MobileStackPanelBody` (that would reintroduce the DIFFERENT, already-fixed
`evaluation-1.md` CR1/CR2 race: a second independent fetch there, used for cross-filtering,
racing against `OutputPanelContent`'s own) — the fix instead makes `PanelCardBody` itself (the
actual shared ancestor of BOTH `PanelCard`'s desktop grid and `MobilePanelStack`'s phone stack)
own a single `useOutputMeta(outputId)` call, threaded to both consumers that need it:

- `frontend/src/features/panels/ui/PanelCard.tsx` — `PanelCardBody` now calls
  `useOutputMeta(outputId)` itself (removed as an externally-supplied `output` prop). This value
  feeds (a) `usePanelSortFilter`'s seed, exactly as before, and (b) is now ALSO threaded down into
  its own `<PanelContent output={output} outputMetaLoading={isOutputMetaLoading} />` call, so
  `OutputPanelContent` (below) no longer performs its own independent fetch for a
  `PanelCardBody`-rendered panel — eliminating a SECOND, hidden source of duplication that existed
  on desktop too (see "Bonus" below). `PanelCard`'s own separate `useOutputMeta` call (used for
  `chartInspectConfig`, an unrelated purpose in a different subtree) is untouched — still
  independently justified (HEL-572 D1/D5), not a regression.
- `frontend/src/features/panels/ui/PanelContent.tsx` — `PanelContentProps` gains optional
  `output`/`outputMetaLoading`. `OutputPanelContent` now accepts these as optional props: when a
  caller supplies `output` (even `null`, meaning "resolving upstream"), it is used directly and
  `OutputPanelContent`'s own `useOutputMeta` call is skipped entirely (`useOutputMeta(null)` —
  genuinely no fetch, not just an ignored result). When absent (`undefined` — `PanelFullscreenOverlay`
  and `PanelDetailModal`, which don't have a resolved Output to offer), `OutputPanelContent` falls
  back to its own fetch exactly as it always has — **zero behavior change for those two callers**,
  keeping this fix narrowly scoped as instructed.
- Net independent-fetch count for a mobile-stack-rendered table panel: **unchanged at 1** — just
  relocated from `OutputPanelContent` up to `PanelCardBody`, where its result can also seed
  `usePanelSortFilter`. For desktop: unchanged at 2 (`PanelCard`'s own for `chartInspectConfig` +
  `PanelCardBody`'s own, now shared with `OutputPanelContent`) — down from what would otherwise be
  a THIRD independent fetch, since `OutputPanelContent`'s previously-separate one is eliminated.
- **Bonus, not previously requested**: this also resolves the desktop-side "Known, accepted,
  documented limitation" from Cycle 1 (two independent `useOutputMeta` fetches — `PanelCard`'s own
  vs. `OutputPanelContent`'s own — could theoretically settle one render apart). `OutputPanelContent`
  now renders from the SAME fetch `usePanelSortFilter` seeds from, on desktop too, so that window
  is closed by construction, not just documented as bounded/cosmetic.

### Why this does not reintroduce `evaluation-1.md`'s race

That race was specifically: a SECOND independent fetch (previously added to `MobileStackPanelBody`
for cross-filtering) computing a value that had to stay in sync, render-by-render, with
`OutputPanelContent`'s own independently-resolving copy, for as long as both existed — a genuine
"two sources of truth that can disagree" hazard. This fix produces the OPPOSITE structure:
`OutputPanelContent` no longer has its own fetch AT ALL once a caller supplies `output` — there is
exactly ONE fetch, and cross-filtering (still computed entirely inside `OutputPanelContent`, per
that fix, untouched) reads from that single source. No two independently-resolving copies exist
anywhere in the mobile-stack render path for a `PanelCardBody`-rendered panel.

### Regression test (CR2, mandatory red-first)

- `frontend/src/features/panels/ui/grid/MobilePanelStack.staleFetchSequencing.test.tsx` (new) —
  renders the REAL `MobilePanelStack` component (not `PanelCard`) with a table panel bound to an
  Output carrying a persisted `columnFilters` default, and asserts the corrective filtered fetch
  fires and the store settles on the server's filtered total. Confirmed genuinely RED against the
  exact committed `03137f28` content (temporarily reverted `PanelCard.tsx`/`PanelContent.tsx` to
  `git show 03137f28:...`, ran the new test — failed exactly as predicted: `filteredCalls.length`
  was `0`, not `>= 1`, since the corrective fetch categorically never fired on this path). Restored
  the fix, re-ran — passing. This is the first test in this ticket's history that actually exercises
  `MobileStackPanelBody`/`MobilePanelStack` with a persisted filter default — neither
  `PanelCard.staleFetchSequencing.test.tsx` case can ever catch this class of defect, since both
  exercise `PanelCard` (desktop) exclusively.

### Incidental fix: a pre-existing test-timing assumption invalidated by this cycle's change

- `frontend/src/features/panels/ui/PanelCard.test.tsx` — the `React.memo` prop-reference-
  stability regression test ("`PanelCardBody` does not re-render when only unrelated `PanelCard`
  state changes") started failing after this cycle's change: `PanelCardBody` now owns its own
  internal `useOutputMeta` state (previously an external prop), and that hook's mount effect fires a
  redundant same-value `setIsLoading(true)` microtask that causes React to invoke `PanelCardBody`'s
  function body one extra time while bailing out of committing (react.dev's documented "Bailing out
  of state updates" behavior: React may still render once to confirm the bail-out). This is a
  one-time settling event during `PanelCardBody`'s OWN mount, unrelated to the parent re-render the
  test actually cares about — the test's `callsBeforeRerender` baseline was simply captured too
  early (right after `usePanelData`'s own fetch was dispatched, but before `useOutputMeta`'s mount
  effect had a chance to settle). Fixed by flushing two microtask ticks (`await act(async () => {
  await Promise.resolve(); await Promise.resolve(); })`) before capturing the baseline — the actual
  regression the test guards against (an UNRELATED parent prop change like a title-edit keystroke
  causing an extra render) is unaffected and still correctly asserted. Not a defect in the fix;
  confirmed by reading the render-count math and the "Bailing out of state updates" mechanism
  directly, not by simply loosening the assertion.

### Gate results this cycle (fresh)

```
npm run lint            → clean, 0 warnings
npm run typecheck       → clean
npm run format:check    → clean (after `prettier --write` on the new test file)
npm test                → helio-mcp: 28 suites/271 tests passed
                           frontend: 360 suites / 3894 tests passed, 1 snapshot passed
                           (+1 suite, +1 test vs. cycle 3: the new mobile-stack regression test)
npm --prefix frontend run build → succeeded (pre-existing chunk-size warning only)
```
Backend unaffected (no `backend/` files touched this cycle) — not re-run.

### Live re-verification at BOTH viewport widths (fresh dev-server restart)

Killed the frontend dev server the skeptic had left running (pid 1735623) and restarted fresh via
`scripts/concertino/start-servers.sh` (new pid 1799261, `readlink /proc/1799261/cwd` confirmed
against this worktree's `frontend/`, started `Mon Sep 28 18:20:34 2026` — after this cycle's fix).
Backend reused (pid 1411716, cwd-confirmed against this worktree, unchanged since cycle 1).
Re-seeded the Output's persisted filter (`columnFilters: {"quick": "target"}`) via authenticated
PATCH, then ran fresh full-page reloads at BOTH widths on the SAME server:

```
=== desktop (1440x900) ===
disclosure: 3 results. | filter= requests: 1
  +7176ms  GET .../rows?offset=0&limit=200&filter=%7B%22quick%22:%22target%22%7D

=== mobile (375x812) ===
disclosure: 3 results. | filter= requests: 1
  +1337ms  GET .../rows?offset=0&limit=200&filter=%7B%22quick%22:%22target%22%7D
```
Repeated the mobile trial twice more (3 total) — identical result every time: "3 results.",
exactly 1 filter request. Screenshots: `.concertino/runs/HEL-1027/evidence/HEL-1027-cycle4-desktop.png`
and `.concertino/runs/HEL-1027/evidence/HEL-1027-cycle4-mobile.png` (the mobile screenshot shows the
phone-stack chrome — bottom pill nav, no sidebar — exactly matching the skeptic's own described
failure-mode viewport, with the "target" filter chip active, 3 matching rows, and "3 results."). No
pre-fix ("red") live capture was taken this cycle at mobile width — the skeptic's own
`skeptic-final-3.md` already provides that evidence (twice-reproduced "60 results." at 375×812
against this exact `03137f28` build), and the mandatory red-first Jest proof above independently
confirms the same defect against the same commit. The Output's config was reset to
`{columnSort: null, columnFilters: null}` afterward, matching prior cycles' end-of-cycle hygiene.
