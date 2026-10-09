## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 7ee3f8e36a71c7ee1027cb4d1481ddb7f9bfddf2 (= origin/main; only the untracked change dir differs).

### What I verified (with evidence)

- **Remount root cause holds.** `frontend/src/features/panels/ui/grid/PanelGrid.tsx:69-76` swaps
  `MobilePanelStack` / `DesktopPanelGrid` on `width < panelGridConfig.breakpoints.sm`. Every card is a new tree.
- **Rows refetch root cause holds.** `usePanelData.ts:92` gives each mount a new `prevFetchKey = useRef(null)`, so the
  guard at `:130` always misses on mount. `paginationState` is never cleared on unmount (`panelsSlice.ts:123` is
  the only delete, via `resetPanelPagination`).
- **Metadata root cause holds.** `useOutputMeta.ts:16-58` is a plain useState+useEffect with no cache. It is called by
  `PanelCardBody.tsx:97`, `usePanelRunRefresh.ts:15`, `usePanelCardInspect.ts:33`, and `PanelContent.tsx:217`
  (fallback), plus the modal and editor callers.
- **StrictMode is on.** `main.tsx:61`, React ^19.3.0. The cold-load hypothesis in D6 is plausible: the second effect
  run keeps the ref but has a closure `paginationEntry` of `undefined`. It is correctly labelled as unverified (task 1.3).
- **Ticket and owner ruling coverage.** Rows (D2), metadata cache with merge (D3), invalidation on write/run (D4),
  an all-/api burst proof with StrictMode stated (V3), cold-load investigation (D6), and no limiter change (spec
  requirement plus C2) each map to a task. I found no placeholders.
- **The four specific concerns.** Each is checked below against the code. Three of them turn up real defects.

### Verdict: REFUTE

### Change Requests

1. **D2 misses the second mount-time row fetcher, so the AC is not met for configured tables. (Spec
   divergence: "zero rows requests" across a crossing.)** `usePanelSortFilter.ts` (the
   `appliedPersistedDefaultRef` effect, around lines 200-225) always dispatches its own page-0 `fetchPanelPage` on
   every mount once `output` seeds. It does this whenever the table has a persisted `columnSort`/`columnFilters`
   default, a URL viewer control is active, or a cross-filter `eq` applies. A persisted `columnSort` is written by
   `TableRenderer.tsx:252` every time an owner clicks a column header, so this is the common case. D2 changes only
   `usePanelData`. It also compares `lastQuery` against `usePanelData`'s _stripped_ mount query (`replayableQuery`
   with `full=false` drops sort and columns). For a table with a persisted default:
   - `lastQuery` holds the sorted query, so the comparison never matches and `usePanelData` refetches.
   - The corrective effect then fetches again.

   That is two rows requests per such panel per crossing, the same as today. The probe fixture had no persisted
   defaults, so V1 and V3 as planned would pass while the AC fails.

   Revise D2 to define reuse against the query the remounted card will actually settle on: the seeded
   persisted defaults composed with control ops and cross-filter. Make the corrective effect skip when the fresh,
   same-generation entry's `lastQuery` already equals that query. Require V1 and V3 fixtures to include at least one
   table with a persisted `columnSort` default and one panel with an active URL viewer control. Name the expected
   per-crossing count for each.

2. **D3's synchronous cached metadata reverses the dispatch order that the sort/filter correction depends on.
   (Desync: rows that do not match the remounted controls.)** Today `output` arrives asynchronously, so
   `usePanelSortFilter`'s corrective fetch is dispatched _after_ `usePanelData`'s unsorted mount fetch. The
   `latestFetchRequestId` guard (`panelsSlice.ts:295`, `:333`) then lets the corrective response win. The existing
   `PanelCard`/`MobilePanelStack.staleFetchSequencing.test.tsx` suites cover exactly this sequencing.

   With D3, `output` is available on the first render. `usePanelSortFilter` seeds during that render, and its effect
   runs in `PanelCardBody`, a _child_ of `PanelCard`/`MobileStackPanelBody`. Passive effects run child-first, so:
   - The sorted corrective fetch is dispatched first.
   - `usePanelData`'s unsorted mount fetch is dispatched second and becomes "latest".
   - The sorted response is discarded.

   The table then shows a sort/filter indicator over unsorted, unfiltered server rows, with the wrong
   `total`/`hasMore`. This happens on any mount where row reuse fails but metadata is cached: a stale window, a
   generation bump after an owner's sort persist, or the CR1 mismatch.

   The design must specify how ordering stays correct when metadata is served synchronously. One option is to have
   `usePanelData` not dispatch its stripped mount query when a corrective fetch for the same panel is already
   pending or due. Another is to sequence the two. Add a jest test that primes the metadata cache, mounts a
   persisted-default table, and asserts the final settled `lastQuery`/`total` is the sorted/filtered one. Record a
   mutation that turns it red.

3. **D5's "staleness is bounded by 30s" is false given the fan-out's first-observation rule.** `closeEntry`
   (`pipelineRunFanout.ts:121-128`) deletes the per-pipeline entry when the last subscriber leaves. A new
   subscription therefore starts with `lastObservedRunId === undefined`. `reconcile` (`:192-207`) then deliberately
   does _not_ notify for an already-succeeded run. Its stated justification is that "the panel's own initial data
   fetch ... already reflects whatever the pipeline's current state is at mount time". D2 removes exactly that
   initial fetch.

   Scenario: rows fetched, then cards unmounted (desktop/phone swap, or dashboard A to B to A, since D2 applies to
   _every_ mount). A run then succeeds without this client observing it: a scheduled run, a dataset-write auto-run
   (HEL-1093), a form-submit auto-run, another tab, or MCP. If remount happens within 30s, it reuses pre-run rows,
   and the reconnect silently adopts the new run id as the baseline. The panel then shows stale rows
   _indefinitely_ (until a poll, manual refresh, or the next remount after the window), not for at most 30s.

   Revise D4/D5 to close this. Options: keep `lastObservedRunId` per pipeline across `closeEntry`, so a reconnect
   after reuse is not a "first observation". Or record the run id the cached rows reflect and invalidate or refresh
   when `runs/latest` differs. Add a staleness test to V2: fetch, unmount, run succeeds while no subscriber is
   registered, remount within the window, and assert that a rows request is issued. Restate D5's bound accurately.

4. **D4's "mechanical" enumeration grep would find nothing as specified, and the named list has gaps.** The grep
   `apiClient.(post|put|patch|delete)` matches zero sites, because this codebase uses `httpClient`. Even corrected,
   anchoring on `/api/outputs` and `/api/pipelines` misses:
   - every step write (`/api/pipeline-steps/...`, `pipelineService.ts:146,160,169,174`)
   - `applyPatchSet`/`undoPatchSet` (`patchSetService.ts:24`, plus the undo POST; EditTarget kinds include
     `pipeline` and `pipelineStep`)
   - `applyCombinedProposal` (`combinedProposalService.ts:11`)
   - `expandPipelineShape` (`/api/pipeline-shapes/...`), if it writes

   Also, `deletePipelineStep(stepId)` returns `void` and has no `pipelineId`, so "→ `invalidatePipeline(id)`" is not
   implementable there as written.

   Replace the grep with a correct, broader one: `httpClient\.(post|put|patch|delete)` across `features/**/services`,
   with every hit classified as affects-Output-data yes/no, recorded and justified. Add patch-set apply/undo and
   combined-proposal apply to the list (`invalidateAll()` is acceptable there). Specify how stepId-only writes get
   their pipeline: a caller-supplied id, or `invalidateAll()`.

5. **D2's "entry has no error" condition cannot be implemented against current state.** `PanelPaginationState` has
   no error field. Errors live in `usePanelData`'s component-local `errorForKey`, which is lost on unmount. The
   `.rejected` reducer (`panelsSlice.ts:350-363`) keeps old rows and does not touch any timestamp.

   Specify the mechanism, for example clearing `fetchedAt` or setting `lastFetchFailed` on `rejected` via
   `meta.arg`. Also state the intended behaviour when a refresh fails with 429 after an earlier success: should the
   remount reuse the old rows or refetch?

6. **D2's in-flight skip cannot absorb the StrictMode double run if it reads the render closure.** The existing
   guard reads `paginationEntry` from the render closure, which is `undefined` on StrictMode's second effect run. That
   is the D6 hypothesis itself. An in-flight check written the same way sees nothing in flight.

   Specify that the mount-path reuse and in-flight checks read live store state (`useStore().getState()` at effect
   time), not the closure. Also specify what an in-flight-skipped mount does with that request's failure. It has no
   `.catch` to set `errorForKey`, so today it would render as `noData` instead of an error.

### Non-blocking notes

- **D5 is defensible as a bounded behaviour change once CR3 is fixed.** The reused window is the same data the card
  showed moments earlier, and refresh, poll, and SSE stay on the fetch path. State whether metadata uses
  `REMOUNT_FRESHNESS_MS` too. D3 says only "fresh".
- **Deep-equality detail.** `lastQuery.filter` is `composeOutputRowsFilter`'s object, which carries explicit
  `quick: undefined`/`columns: undefined` keys. The comparison must treat absent and undefined as equal. Name that in
  D2 or the test will be flaky by construction.
- **Lost reuse after owner sorts.** An owner's sort click persists via `updateOutput`, which bumps the generation, so
  the next remount refetches identical rows. This is acceptable but worth stating in the burst-proof expectations.
- **`PanelDetailModal` will start reusing card rows.** It calls `usePanelData` with explicit args on the same
  `paginationState[panel.id]`, so it will now reuse the card's window when the queries match. This is probably
  desirable; mention it.
