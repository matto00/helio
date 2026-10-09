## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 7ee3f8e36a71c7ee1027cb4d1481ddb7f9bfddf2. Only the untracked change dir differs from main.
I reviewed cold against the live source, not against the round-1 narrative.

### What I verified (with evidence)

**Round-1 change requests, re-checked against code:**

- **CR1 (second mount-time fetcher): mechanism resolved; a load-bearing input gap remains (new CR1 below).**
  - D2 now names `usePanelSortFilter`'s correction effect (`usePanelSortFilter.ts:220-240`) and routes it through a
    shared `computeSettledPanelQuery`.
  - The V1/V3 fixtures now require a persisted-`columnSort` table and an active URL viewer control, with a per-type
    expected count of 0.
- **CR2 (ordering under synchronous metadata): resolved in principle; correctness depends on new CR1.**
  - I confirmed `fetchPanelPage.pending` writes `latestFetchRequestId` and page-0 `lastQuery` synchronously at
    dispatch (`panelsSlice.ts:289-318`). A live-store `isPendingFor` check in the second effect will therefore see
    the first effect's request, and child-first order no longer decides the winner.
  - The StrictMode second run of the correction effect is already absorbed by `appliedPersistedDefaultRef`
    (`:220-223`, refs survive the double-invoke).
  - V2's ordering test with a recorded mutation is the right guard.
  - The claim that order no longer matters holds only if both fetchers compute _identical_ settled queries. If
    they differ, both dispatch and the parent's dispatch (which runs last) wins `latestFetchRequestId`. That is the
    CR2 desync again.
- **CR3 (first-observation rule): partially resolved (new CR3 below).** `lastObservedRunIdByPipeline` surviving
  `closeEntry` closes the case where a baseline was recorded. It does not close the case where no baseline was ever
  recorded.
- **CR4 (enumeration grep): resolved.**
  - `grep -rnE "httpClient\.(post|put|patch|delete)" frontend/src` (tests excluded) returns 108 hits.
  - Every function D4 names exists: `addPipelineRoot`, `removePipelineRoot`, `reorderPipelineSteps`,
    `duplicatePipelineStep`, `updatePipelineStepEnabled`, `expandPipelineShape`, `createPipelineStep` in
    `pipelineService.ts`; `applyPatchSet`/`undoPatchSet` in `patchSetService.ts`; `applyCombinedProposal`.
  - StepId-only writes go to `invalidateAll()`.
  - The only non-httpClient write is `telemetry/track.ts:95`, which is irrelevant.
- **CR5 (error state): resolved as specified**, through `lastFetchOk`/`lastError` set on a page-0 rejection that is
  the latest request. The 429 behaviour (refetch on remount) is stated. The way the error is _surfaced_ introduces
  a regression (new CR2 below).
- **CR6 (live store state): resolved.** Both checks read `store.getState()` at effect time, and the in-flight-skipped
  failure is surfaced through `entry.lastError`.

**D5 against HEL-1174's expectations:**

- `pipelineRunFanout.test.ts` uses a distinct pipeline id per test (e.g. `"pipe-4-1"` in the first-connect
  no-fire test, `:396-410`). A module-level map that survives `closeEntry` therefore does not break those
  expectations. The design's "test reset helper" covers other files that reuse ids.
- `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` starts from `page.goto("/")` (`:138`). Module state is fresh, so
  the "status region empty before any fan-out refresh" first-observation behaviour still holds.

**Other checks:**

- **`computeSettledPanelQuery` inputs.**
  - `PanelCard.tsx:105` and `MobilePanelStack.tsx:49` call `usePanelData(panel)` with no ops and no eq.
  - The correction effect's `controlFilterOps` come from `PanelCardBody.tsx:112-115` (`useViewerControls`, URL).
  - Its `crossFilterEq` comes from `useCrossFilterServerOps(panel, output)` (`PanelCardBody.tsx:130`). That
    function's eligibility depends on capabilities (`useOutputFilterCapabilities`, a 5-minute TTL store), excludes
    timestamp columns, and excludes the case where a control `eq` sits on the same dimension
    (`useCrossFilterServerOps.ts:66-76`).
  - `replayableQuery`'s rule (`usePanelData.ts:281-316`) is a different rule: it replays a previously recorded eq
    only while it still equals the active cross-filter.
- **Error rendering.** `PanelContent.tsx:439-454` replaces the whole panel body, including `TableRenderer` and its
  filter input, with `InlineError` whenever `error` is non-null.
- **Freshness clock.** D2 makes rows reusable iff `fetchedAt` is within `REMOUNT_FRESHNESS_MS` (30s). D3 applies the
  same rule to metadata. Neither is refreshed while a card stays mounted, except rows on a poll, SSE, or manual
  refresh.

### Verdict: REFUTE

### Change Requests

1. **D2 does not say where `usePanelData` gets the settled query's `controlFilterOps`/`crossFilterEq`, and its
   wording conflates two different cross-filter rules.** The order-independence claim requires byte-identical
   queries from both fetchers.
   - **Problem:** both hosts call `usePanelData(panel)` with no ops or eq (`PanelCard.tsx:105`,
     `MobilePanelStack.tsx:49`). D2 says the helper uses "the live cross-filter (same rules as
     `replayableQuery`/`usePanelSortFilter` today)". Those are two different rules:
     - `replayableQuery` replays the _recorded_ `lastQuery.crossFilterEq` while it still equals the active filter.
     - `usePanelSortFilter` receives `useCrossFilterServerOps`'s eligibility result, which depends on capabilities
       being `ready`, a non-timestamp column, and no control `eq` on the same dimension.
   - **Failure case:** a capabilities entry that is `unavailable`/expired, or a control `eq` on the dimension. If
     `usePanelData` derives eq one way and the correction effect the other, the two queries differ and both
     dispatch. The parent's stripped request is then latest and wins: the CR2 desync returns for every
     cross-filtered table.
   - **Required:**
     - State explicitly that `usePanelData` obtains its inputs from the same sources as `PanelCardBody`:
       `useViewerControls(panel.id, controls)` → `buildViewerControlFilterOps`, and
       `useCrossFilterServerOps(panel, cachedOutput)`.
     - Alternatively, lift those into the host and pass them in. Either way, the helper must take one
       `crossFilterEq` input produced by one function, never a re-derivation.
     - Add to Verification 2 a case with an active server-eligible cross-filter and a URL control on a
       persisted-default table. Assert one rows request and a settled `lastQuery` equal to the correction
       effect's.

2. **D2's "derive `error` from `entry.lastError` when `errorForKey` is empty" regresses the sort/filter UX.**
   - **Problem:** `lastError` would be set by _any_ latest page-0 rejection, including `usePanelSortFilter`'s
     debounced, user-driven sort/filter refetch. Today that path only toasts (`usePanelSortFilter.ts:148-157`) and
     the reducer keeps the rows.
   - **Effect:** under D2, the same failure makes `usePanelData.error` non-null. `PanelContent.tsx:439` then swaps
     the whole table, including the filter textbox, for `InlineError`, and the toast also fires (a double report).
     This is the same "table unmounted mid-interaction" class HEL-1027 Defect 1 fixed.
   - **Required:** scope the derived error to the case it exists for. Surface `lastError` only when it belongs to
     the request this mount skipped, either by recording the skipped request id/query and matching it, or by
     storing the failing query in `lastError` and requiring it to equal this mount's settled query. Otherwise
     leave `usePanelSortFilter` rejections on their toast-only path. Add a jest guard: a failed user-driven sort
     refetch keeps the table mounted. Record the mutation that turns it red.

3. **D5 still leaves silently stale reused rows whenever no baseline was ever recorded for the pipeline (CR3 is
   only partly closed).**
   - **Why the baseline can be missing:** `lastObservedRunId` is set only when `reconcile` sees a _terminal_ latest
     run, or when the live SSE path sees a terminal event (`pipelineRunFanout.ts:189,213,288`). It stays
     `undefined` when, at first connect:
     - the latest run is `queued`/`running`, which is common: auto-run debounce plus the 30s tick
       (HEL-1093/1174);
     - the pipeline has never run (404);
     - the `runs/latest` call failed.
   - **Scenario:** the dashboard loads while a run is in progress, so the rows are pre-run. The user navigates
     away or crosses the boundary in the gap, the run succeeds unobserved, and the cards remount within 30s.
     Reconcile is then a "first observation", stays silent, and the reused pre-run rows (or a stale
     "never materialized" prompt) persist indefinitely.
   - **Required:** record a baseline in every case, so that a later terminal run is always a real observation. For
     example, persist a sentinel for "observed none / observed non-terminal X". Alternatively, make row reuse
     conditional on a recorded baseline for the Output's pipeline. Add both cases to Verification 3(b):
     - in-flight-at-load, then unmount, the run succeeds, then remount;
     - never-run, then unmount, first run succeeds, then remount.

     Each must assert that a rows request is issued.

4. **The 30s freshness clock runs from fetch time, so the ticket's own scenario still refetches everything, and
   neither the design nor the verification says so.**
   - **Problem:** a user who reads a dashboard for more than 30s and then rotates a tablet or drags the window edge
     gets a full row and metadata refetch on the first crossing. Rows are fetched once at load, and metadata is
     fetched once per mount and never refreshed while mounted.
   - **Why the verification misses it:** the burst spec (Verification 4) crosses right after load, so it will pass
     while this behaviour ships.
   - **Conflict with the AC:** the original AC ("doesn't refetch rows already in redux/pagination state") has no
     recency qualifier. The owner ruling applies "recently" to metadata only.
   - **Required, one of:**
     - (a) Re-anchor the rows window. With D5 (plus CR3 above) catching runs, row content changes only by run or by
       an Output edit. Consider reuse gated on generation and run observation rather than a 30s fetch clock, or a
       window measured from unmount.
     - (b) Keep the fetch-anchored clock. Then state the deviation from the literal AC explicitly, justify it with
       the resulting worst-case per-minute request count, and add a "dwell over 30s, then cross" case to
       Verification 4 that reports the measured count.

     If (b) is chosen, it is a scope reading of the AC that the orchestrator should confirm with the owner rather
     than decide unilaterally.

### Non-blocking notes

- **`fetchPanelPage.pending` overwrites `lastQuery` but would carry forward `lastFetchOk`/`fetchedAt`/`generation`
  from the previous success.** `isReusable` could then report "reusable" for a query whose rows are not yet on
  screen. It is harmless today because the pending request is still latest and lands, but the predicate should not
  depend on that. Either reset `lastFetchOk` on page-0 pending, or require `!isLoadingMore` in `isReusable`.
- **The source of `fetchedAt`/`generation` is phrased two ways.** D2 says they are "passed in via the thunk arg"
  and also "computed in the thunk". Pick one. Read via `meta.arg` is the pattern the reducer already uses.
- **Keep `prevFetchKey` in step after a skip.** When `usePanelData`'s mount skips (reusable or pending), it must
  still set `prevFetchKey`. Its effect re-runs on every `paginationEntry` change (deps at `usePanelData.ts:210`).
  A pending-skip also leaves `inFlightRef` false, so a `refresh()` during the other fetcher's request will dispatch
  a duplicate.
- **D5 now also notifies `terminalListeners` (HEL-1207 provenance and history consumers) on a reconnect after an
  unobserved run.** This is probably desirable, but it changes those consumers' behaviour. State it in D5.
- **Remounts after the window may fetch rows twice.** When reuse fails and the reconnect also notifies, the mount
  fetch plus the `refresh()` can produce two rows requests. This is acceptable but worth reporting in the burst
  numbers.

### Gate defects

None. No mtime-ordering evidence was involved.
