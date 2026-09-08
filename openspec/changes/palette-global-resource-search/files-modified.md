# Files modified — HEL-503

## Final-gate round 1 fixes (skeptic-final-1.md CR1, CR2)

- `frontend/src/features/commandPalette/useResourceSearchActions.ts` — **CR2 fix**: the overflow
  count ("+N more … refine your search") is no longer modeled as a `CommandAction`. It was a
  `CommandAction` with a no-op `run`, which rendered as a real `<button role="option">` reachable
  by arrow keys — the skeptic clicked it live and found it closed the palette, cleared the query,
  and navigated nowhere. `ResourceSearchResult` now returns `overflowNotices: string[]`,
  completely separate from `actions`.
- `frontend/src/features/commandPalette/ui/CommandPalette.tsx` — **CR2/CR1 fix**: renders
  `overflowNotices` as plain, non-interactive `<div>`s OUTSIDE the `role="listbox"` `<ul>` (never
  a `<button>`, never `role="option"`, never counted in `flatIndex`/keyboard traversal), each
  with an empty icon-gutter spacer (`.command-palette__notice-icon`) so its text starts at the
  same x-position as every iconed row's text.
- `frontend/src/features/commandPalette/ui/CommandPalette.css` — **CR1 fix**: added
  `.command-palette__notices`/`.command-palette__notice`/`.command-palette__notice-icon`, tokens
  only (`var(--space-1)`, `var(--space-3)`, `var(--text-lg)`), no literal px.
- `frontend/src/features/commandPalette/ui/CommandPalette.test.tsx` — added a new describe block
  (2 tests) asserting the overflow notice is on screen but NOT among the palette's `role="option"`
  elements, and that ArrowDown cycling never lands `aria-selected="true"` on it. Mutation run and
  confirmed: restoring the overflow notice as a `CommandAction` turns both tests red (6 options
  found, not 5; the "+2 more" text found inside a `role="option"` element).
- `e2e/hel503-palette-global-resource-search.spec.ts` — added a real-browser test asserting (a)
  exactly 5 options render for 7 matching sources (cap=5), (b) ArrowDown cycling past every option
  never sets `aria-activedescendant` to the notice, (c) clicking the notice does not close the
  palette or clear the query, and (d) a MEASURED computed bounding-box comparison shows the
  notice's text starts within 1px of a real option's text (not "by eye"). Ran against the live
  dev server; ran BOTH prescribed mutations (CSS spacer removed → 30px offset measured, red;
  overflow restored as a clickable action → 6 options, red) and confirmed both restore to green.

## Cycle 3 additions (evaluator S1', S2')

- `frontend/src/features/commandPalette/useResourceIndexing.test.tsx` — **S1' fix**: replaced the
  unbounded `mockedGet.mockRejectedValue(...)` with a SELF-LIMITING `mockRejectingWithCap(50)`
  that answers every call past the cap with a promise that never settles. Without this, the
  retry-loop mutation fed the buggy hook an endless supply of freshly-rejecting promises, each
  one a fresh reason for `act()` to keep flushing — a microtask cascade with no macrotask
  boundary that starved the event loop (observed hanging 150s+ with no `--testTimeout` help).
  Re-ran the exact mutation (`statuses.*` back in `useResourceIndexing.ts`'s effect deps) after
  this fix: it now fails in ~10s with a concrete, named assertion ("Expected: 4, Received: 54")
  instead of hanging. Restored and confirmed green (5/5, ~3s).
- `frontend/src/features/dashboards/state/dashboardsSlice.test.ts` — **S2' fix**: added a
  `fetchDashboards condition` suite (4 tests, mirroring `pipelinesSlice.test.ts`'s own condition
  tests) pinning the widened condition's intent LOCALLY: dispatches from `idle`/`failed`, blocked
  from `loading`/`succeeded`. Mutation run and confirmed: reverting the condition to
  `status === "idle"` only turns the "dispatches when the previous fetch failed" test RED;
  restoring the widened condition turns it back green.

## Cycle 2 additions (evaluator CR1, CR2, S1)

- `frontend/src/features/commandPalette/model/resourceSearch.ts` — **CR2 fix**: `SearchableItem`
  widened to a discriminated union mirroring `ResourceRef` (output arm's `pipelineId` is now
  REQUIRED, not optional). The previous flat-with-optional shape let
  `useResourceSearchActions.ts` coalesce a missing `pipelineId` to `""` — the exact invalid state
  (`ResourceRef`'s union) was chosen to make unrepresentable, reintroduced one file away.
- `frontend/src/features/commandPalette/model/resourceSearch.test.ts` — added the
  `@ts-expect-error` compile-time guard for the CR2 fix (mutation run and confirmed: making
  `pipelineId` optional again turns the guard into a real TS2578); updated the `item()`/added
  `outputItem()` test helpers to match the union.
- `frontend/src/features/commandPalette/useResourceSearchActions.ts` — **CR2 fix**: `buildRef`
  rewritten as an exhaustive `switch` (TypeScript enforces exhaustiveness on this value-returning
  switch automatically) instead of an `?? ""` coalesce.
- `frontend/src/features/pipelines/state/outputsSlice.test.ts` — **CR1 fix**: added
  `fetchAllOutputs`'s prescribed pagination test (task 2.1's own requirement — mock a >1-page
  response, assert every item indexed) and a rejected-request test. Mutation run and confirmed:
  temporarily hardcoding `listAllOutputs()` to a single page turned the pagination test RED;
  restoring the loop turned it back green.
- `frontend/src/features/commandPalette/useResourceIndexing.test.tsx` — **S1 fix**: rewritten to
  mock `httpClient` at the bottom layer (real thunks run and genuinely settle) instead of mocking
  the slice thunks, so the retry-loop mutation (`statuses.*` back in the effect's dependency
  array) is now actually discriminating — confirmed by running that exact mutation and watching
  the new assertions go red, then restoring and confirming green.
- `frontend/src/features/dashboards/state/dashboardsSlice.ts` — **real defect found while fixing
  S1**: `fetchDashboards`'s own `condition` only allowed a dispatch from `status === "idle"`,
  never from `"failed"` — so `useResourceIndexing.ts`'s "retry a failed kind on the next open"
  (task 2.2b) silently never worked for the dashboard kind specifically, one layer below where
  this ticket's own guard could see it. Widened to mirror `pipelinesSlice.ts`'s existing
  `fetchPipelines` guard (`status !== "loading" && status !== "succeeded"`). Found via the S1
  rewrite's real-`httpClient` dispatch-count assertion coming up one call short on a genuine
  re-open after a genuine rejected dashboards fetch — not a hypothetical.


## Source

- `frontend/src/shared/chrome/resourceNavigation.ts` — widened `ResourceKind`/`ResourceRef` into a
  discriminated union with `"output"` (design.md D1); `hrefFor` and `useResourceNavigator` both
  handle the new kind, the latter with an explicit `never` exhaustiveness assertion (task 1.3).
- `frontend/src/features/commandPalette/model/recentHistoryStore.ts` — retyped `RecentEntry.kind`
  and `recordVisit`/`pruneMissing`'s `kind` params to a new `RecentKind = Exclude<ResourceKind,
  "output">`; `VALID_KINDS` is now derived from an exhaustiveness-checked `Record<RecentKind,
  true>` map instead of an array annotation (task 1.0).
- `frontend/src/features/commandPalette/model/builtInActions.ts` — added `SEARCH_SECTION` and
  inserted it into `SECTION_DISPLAY_ORDER` (task 3.3).
- `frontend/src/features/commandPalette/model/ranking.ts` — exported `titleMatchRank`, a
  numeric-rank wrapper around the existing (still-private) `titleTier`/`Tier` enum, so the search
  selector can reuse the same title-prefix/substring/subsequence ordering without duplicating it.
- `frontend/src/features/commandPalette/model/resourceSearch.ts` (new) — the pure
  `searchResourceItems` selector: matches a flattened `SearchableItem[]` against a query, groups
  by kind, and caps each kind at `SEARCH_RESULTS_PER_KIND_CAP` (5), reporting `overflowCount`
  (design.md D5/D7).
- `frontend/src/features/pipelines/state/outputsSlice.ts` — added `allItems`/`allStatus`/
  `allError` and the `fetchAllOutputs` thunk (reuses `listAllOutputs()`, never a new single-page
  client), plus `selectAllOutputs`/`selectAllOutputsStatus`; exported the previously-private
  `AsyncStatus` type (design.md D3, task 2.1).
- `frontend/src/features/commandPalette/useResourceIndexing.ts` (new) — dispatches each kind's
  list thunk on the palette's `isOpen` open-EDGE only (not on every status change — the fix for
  the retry-loop bug found while testing), guarded on that kind's own live status; retries a
  `failed` kind on the next open (design.md D2, tasks 2.2/2.3).
- `frontend/src/features/commandPalette/useResourceSearchActions.ts` (new) — builds the palette's
  search-result `CommandAction`s (debounced matching via a local `useDebouncedValue`, design.md
  D6/task 3.5) and the live-derived coverage message (`buildCoverageMessage`, design.md D4).
- `frontend/src/features/commandPalette/ui/CommandPalette.tsx` — wires in
  `useResourceIndexing`/`useResourceSearchActions`; merges search actions into the same array
  `rankActions` scores (design.md D5); renders the coverage caveat and an "indexing in progress"
  empty state distinct from "no matching commands" (design.md D4, task 4.4).
- `frontend/src/features/commandPalette/ui/CommandPalette.css` — `.command-palette__coverage`
  caption, tokens only (`var(--app-text-muted)`, `var(--text-sm)`).

## Tests

- `frontend/src/shared/chrome/resourceNavigation.test.ts` (new) — the `@ts-expect-error` compile-
  time guard for task 1.1 (an Output ref without `pipelineId` must not compile).
- `frontend/src/shared/chrome/resourceNavigation.test.tsx` — extended with `hrefFor`/
  `useResourceNavigator` output-kind cases.
- `frontend/src/features/commandPalette/model/resourceSearch.test.ts` (new) — ranking order, kind
  grouping, empty-query behavior, and the cap/overflow guard (mutation run and confirmed — see
  in-file comment).
- `frontend/src/features/commandPalette/useResourceIndexing.test.tsx` (new) — task 2.2/2.3's
  dedup-on-succeeded and retry-on-failed behavior, and the no-boot-time-fetch guard.
- `frontend/src/features/commandPalette/useResourceSearchActions.test.ts` (new) —
  `buildCoverageMessage`'s task 4.1/4.2/4.3 behavior, including the hardcoded-message mutation
  guard (mutation run and confirmed).
- `frontend/src/features/commandPalette/useResourceSearchActions.debounce.test.tsx` (new) — task
  3.5's debounce/stale-match behavior (mutation run and confirmed).
- `frontend/src/features/commandPalette/ui/CommandPalette.test.tsx` — added the `outputs` reducer
  to every ad-hoc test store (now required by `useResourceIndexing`).
- `frontend/src/app/App.test.tsx`, `frontend/src/app/ShareDialogFocusRestore.test.tsx` — same
  `outputs` reducer addition; `CommandPalette` (mounted transitively via `AppShell`) now reads
  `state.outputs.allStatus` unconditionally.
- `e2e/hel503-palette-global-resource-search.spec.ts` (new) — the primary `/`-route acceptance
  test (no prior navigation) across all four kinds, output deep-link sheet presentation, dashboard
  selection, source navigation, and the coverage caveat under a slow network. Run against the live
  dev server (port 5935) throughout this delivery, including the required indexing-removed
  mutation (confirmed RED, then restored).

## Task 6.4 — the two-axes question

**What does no source text carry?** The per-kind result CAP (`SEARCH_RESULTS_PER_KIND_CAP = 5`) is
declared exactly once, in `resourceSearch.ts`, and both `useResourceSearchActions.ts` and its test
import the exported constant rather than repeating the literal `5` — so "5" as a magic number does
not appear a second time anywhere in source. Similarly the four search kinds
(`dashboard`/`source`/`pipeline`/`output`) are declared once as `SEARCH_KINDS` in
`useResourceSearchActions.ts` and iterated everywhere else (coverage message, `isIndexing`); no
second literal list of the four kinds exists in source (this is what task 4's "never hardcoded"
requirement is actually checking).

**What path did the gates not exercise?** Two real gaps:

1. **The `failed`-kind retry path (task 2.2b) is proven at the unit level
   (`useResourceIndexing.test.tsx`) but NOT in a real browser.** The e2e suite never forces a
   `GET /api/outputs`/sources/pipelines/dashboards request to fail (e.g. via `page.route` returning
   a 500) and then confirms a *second* palette open re-fetches it — `page.route`'s ability to do
   this was demonstrated in the "slow network" coverage test, but the retry-on-failure branch
   itself was only exercised with a mocked Redux store, not against the live dev server. This is a
   real gap in real-browser coverage, not a false claim of completeness.
2. **The visual-cohesion screenshots (task 5.6) capture "rest"/"hover"/"focused" as three separate
   calls, but the resulting PNGs are byte-identical within each theme** — i.e., the hover/focus
   states did not visibly change the row that was already keyboard-selected by default (index 0).
   The screenshots ARE real (captured against the live dev server, both themes, confirming the
   `Search results` section renders with tokens/`.eyebrow` labels and correct light/dark contrast
   alongside the existing empty state) but they do not independently prove a *distinct* hover style
   from the default active-row style, because in this fixture the default-active row and the
   hovered row were the same element. A follow-up capture hovering a NON-active row would close
   this gap; it was not done here.

## Known limitation

Task 6.5 (re-verifying HEL-1038/HEL-1041 are still open in Linear with matching titles) could not
be performed — no Linear MCP tool was available in this session. This is flagged as an open item
for the evaluator/orchestrator, not silently skipped.
