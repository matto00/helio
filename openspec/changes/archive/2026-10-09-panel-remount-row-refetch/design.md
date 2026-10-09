## Context

Measured live on origin/main 7ee3f8e3 (`probe-premise.md`, 8 output-bound panels, dev build):

- `PanelGrid.tsx` renders `MobilePanelStack` when the grid CONTAINER is < 768px (`panelGridConfig.breakpoints.sm`),
  else `DesktopPanelGrid`. The container is viewport - 288px sidebar, so the swap happens at ~1056px viewport. Every
  crossing unmounts every card and mounts a different tree — this is the remount root cause (a branch swap, not RGL key
  churn: within desktop, RGL children keep `key={panel.id}` and lg/md/sm changes remount nothing, measured).
- Theme toggle: no remount, zero requests (measured, refuted). No layout/dashboard writes on any crossing (the
  `useLayoutSave` unmount flush only writes when a layout change is pending).
- Refetch root cause, rows: `usePanelData`'s skip guard is `prevFetchKey.current === currentFetchKey && paginationEntry`;
  `prevFetchKey` is a fresh `useRef(null)` per mount, so every mount dispatches `fetchPanelPage` even though
  `state.panels.paginationState[panel.id]` already holds the window (paginationState is never cleared on unmount).
- Refetch root cause, metadata: `useOutputMeta` is plain `useState`+`useEffect` with no cache; it is called 2+ times per
  card (`PanelCardBody`, `usePanelRunRefresh`, `PanelContent` fallback, ...), and StrictMode doubles each in dev:
  32-48 `GET /api/outputs/:id` per crossing for 8 panels.
- Remaining per-crossing requests: `runs/latest` + `run-events` (the fan-out closes the shared SSE when its last
  subscriber unsubscribes, then the new tree reopens it) and, on the way up, one `assertion-status` per Output.
- Cold load: 16 row requests for 8 panels. Hypothesis (to verify, task 1.3): StrictMode's dev double effect run — the
  second run sees `prevFetchKey === key` but the closure's `paginationEntry` is still `null`, so it re-dispatches.

## Goals / Non-Goals

Goals: zero row and zero metadata requests from cards remounting within the freshness window; one metadata request per
Output for concurrent consumers; never serve data older than an Output/pipeline write or a pipeline run the client
observed. Non-goals: limiter changes (C2), keeping cards mounted across the swap, HEL-1418 (C5), changing
refresh/poll/SSE semantics.

## Decisions

**D1 — One freshness module keyed by Output id, with refcounted retention (revised round 2, CR4).** New module
(e.g. `frontend/src/features/panels/state/outputFreshness.ts`): per-Output monotonically increasing `generation`;
`invalidateOutput(id)`, `invalidatePipeline(pipelineId)` (bumps every Output known to belong to it — from cached
metadata `pipelineId`), `invalidateAll()`; and a per-Output **retention refcount**: `retain(outputId)` on card mount,
`release(outputId)` on card unmount, recording `releasedAt` when the count reaches 0. An Output is **retained** while
its count > 0 or within `REMOUNT_GRACE_MS = 30_000` of its last release. Because a desktop<->phone swap unmounts the
old tree and mounts the new one in the same commit, the Output is continuously retained across a crossing no matter
how long the user had been reading the dashboard before it (round-2 CR4: the window is anchored to the last time the
card was on screen, not to fetch time). Navigating away for more than 30s and coming back behaves exactly as today
(full refetch). Module-level (not Redux) so services and the SSE fan-out can invalidate without an import cycle; a
test-reset helper is exported.

**D2 — Rows reuse: one owner per mount, read from live store state (revised round 2, CR1/CR2/CR5/CR6; replaces the
round-1 `computeSettledPanelQuery` idea — no second derivation of the query exists anywhere).** Two fetchers fire
page-0 on mount today: `usePanelData`'s stripped mount query (in the parent `PanelCard`/`MobilePanelStack`), and
`usePanelSortFilter`'s one-time persisted-default correction effect (in the child `PanelCardBody`), which dispatches
when a persisted sort/filter default, a URL control op, or a cross-filter server term (`useCrossFilterServerOps`)
applies. Revised mechanism:

- **Mount ownership — explicit, per-card token, first mount dispatch only (revised round 3, CR1).** No global
  `panelId` registry. `PanelCard` and `MobileStackPanelBody` each create `const mountOwnership = useRef(false)` and pass
  it (a) to `usePanelData(panel, [], null, { mountOwnership })` as a new optional options argument and (b) as a prop to
  their own `PanelCardBody` -> `usePanelSortFilter`. The correction effect sets `mountOwnership.current = true` in its
  effect when it has terms to apply (persisted sort/filter default, URL control op, or cross-filter server term) — it is
  the single source of the settled query (its existing `dispatchFetch`, no second derivation). Passive effects run
  child-first (verified on react-dom 19.2.8, including StrictMode's reconnect), so the parent's mount effect sees it.
  `usePanelData` consults the token ONLY for that hook instance's FIRST mount decision for a given fetch key: when it
  skips because the token is set, it records `ownershipSkippedKey.current = K` (ref, not state). Any later run of the
  same effect with fetch key K and an unchanged `refreshToken` — including StrictMode's dev double run of the same mount
  (round-4 CR1), whatever the closure's `paginationEntry` looked like at render — returns early, so the stripped query is
  never dispatched for an owned mount. `ownershipSkippedKey` is cleared when `refresh()` is called, when the fetch key
  changes, or once live state shows an entry for this panel (from then on the ordinary prevFetchKey path applies).
  The token itself is set by the child's effect and is never reset in a cleanup (a StrictMode cleanup/re-run of the
  child must not clear it between the child's two runs and the parent's). The token is consulted never for
  `refresh()`, never for a later fetch-key change (e.g. the bound Output
  changing on a mounted card, which fetches page 0 as today). Callers that do not pass `mountOwnership` — notably
  `PanelDetailModal` (explicit args) — are never skipped by ownership: they apply the reuse/pending check to their OWN
  query and fetch when it does not match (so the modal over a card with a session column filter fetches its own
  query, as today). When the child has no terms (or metadata is not yet known, i.e. a true cold load), `usePanelData`
  keeps today's stripped query as the settled query and today's cold-load sequence (stripped fetch, later correction) is
  unchanged. When metadata is cached there is exactly one dispatcher per card mount, so the CR2 ordering bug cannot
  occur.
- **Reuse predicate.** Pure `isReusable(entry, query, outputId)`: entry exists, `!entry.isLoadingMore`, last page-0
  request succeeded (`lastFetchOk === true`), the Output is **retained** (D1), its generation equals the one recorded on
  the entry, the bound pipeline (its id read from the D3 metadata cache entry for the Output; no cached metadata means not
  reusable) has a **run baseline** in the fan-out (D5), and `normalize(entry.lastQuery) ===
normalize(query)` where `normalize` treats absent and `undefined` keys as equal (test it). `isPendingFor(entry,
query)`: `isLoadingMore` and `normalize(lastQuery) === normalize(query)`. Whichever fetcher owns the mount skips its
  dispatch when `isReusable || isPendingFor` for its own query; both read `store.getState()` via `useStore()` at effect
  time, never the render closure (this is what removes the StrictMode duplicate).
- **Bookkeeping in `usePanelData` after a skip** (round-2 non-blocking): set `prevFetchKey.current` to the current key
  either way; on a pending-skip, set `inFlightRef` and clear it when live state shows the request settled, so a
  `refresh()` during it does not dispatch a duplicate.
- **Pagination state fields (CR5).** There is no thunk-arg `origin`. `fetchPanelPage` reads the D1 generation at request
  start (inside its payload creator) and returns it in the fulfilled payload. Page-0 `pending` sets
  `lastFetchOk: undefined` and `lastError: null` (not reusable while pending); page-0 `fulfilled` (latest) sets
  `lastFetchOk: true, generation, lastError: null`; page>0 (load-more) `pending`/`fulfilled`/`rejected` carry
  `lastFetchOk`/`generation`/`lastError` forward unchanged, so a "Load more" does not silently disable reuse; page-0
  `rejected` (latest) sets `lastFetchOk: false` and, for every rejection except a cross-filter-eq one, records
  `lastError: {requestId, message, kind}`. A failed page-0 request is never reusable, so a remount after a 429 refetches.
- **Error surfacing, scoped (N3).** `lastError` is recorded for any page-0 failure, but `usePanelData` surfaces it only
  when it belongs to the request id this hook instance waited on (captured from live `latestFetchRequestId` when it
  skipped for ownership or a pending request). A later user-driven sort/filter failure has a different request id, so it
  is never surfaced by a waiting card and keeps today's toast-only behaviour (table and filter input stay mounted). Jest
  guards for both. Cross-filter-eq rejections keep their self-heal path and never set `lastError`.
- **Known remaining fetchers, disclosed:** (i) a card whose sort/filter was changed by the user this session refetches
  on every crossing (its re-seeded controls differ from the window's query — correct, not reuse); (ii) with an active
  cross-filter and the filter-capabilities cache (5 min) expired, the control-change effect in `usePanelSortFilter`
  refetches once after a crossing — measured in the burst spec's cross-filter case and reported, not fixed here.
- Retention: each card calls `retain(outputId)` in an effect and `release(outputId)` in its cleanup (StrictMode-safe:
  cleanup/re-run nets to one retain).
- Refresh (manual, poll, SSE) never goes through these checks — it always dispatches.
- `PanelDetailModal` calls `usePanelData` with explicit args on the same `paginationState[panel.id]`; it will reuse the
  card's window when the queries match. Intended; verify in the running app.

**D3 — Shared metadata cache (`frontend/src/features/panels/state/outputMetaCache.ts`, consumed by `useOutputMeta`).** A module-level `Map<outputId, {promise, value?, generation}>`:
concurrent consumers share one promise; a value at the current generation for a **retained** Output (D1) is returned
synchronously as the initial state (no loading flash, no request); a rejected fetch is evicted (never cached).
`getOutputMetaCached(id)` is the sync read and `fetchOutputMeta(id)` the shared fetch. There is no `primeOutputMeta`: a write only invalidates, so the next mount refetches. Hook API unchanged. Mounted consumers are not forced to refetch on invalidation (same as
today); invalidation affects the next mount. Retention is driven by the card (one `retain` per mounted card), not by
each of the several `useOutputMeta` calls inside it.

**D4 — Invalidation points (revised for CR4).** Enumeration is mechanical and recorded: run
`grep -rnE "httpClient\.(post|put|patch|delete)" frontend/src --include=*.ts` (excluding tests) and classify EVERY hit
as affects-Output-metadata/rows yes/no with a one-line reason in `files-modified.md`. Orchestrator pre-enumeration
(executor must re-run and reconcile, not trust):

- `invalidateOutput(id)`: `outputService.updateOutput`, `deleteOutput`.
- `invalidatePipeline(pipelineId)`: `createOutput`, `updatePipeline`, `deletePipeline`, `createPipelineStep`,
  `addPipelineRoot`, `removePipelineRoot`, `reorderPipelineSteps`, `runPipeline`, `expandPipelineShape` (if it writes).
- `invalidateAll()` (no pipeline id available, or multi-entity writes): `updatePipelineStep`,
  `updatePipelineStepEnabled`, `duplicatePipelineStep`, `deletePipelineStep` (stepId-only), patch-set apply/undo
  (`patchSetService.ts`), combined-proposal apply (`combinedProposalService.ts`), pipeline-proposal apply
  (`pipelineProposalService.ts`), dashboard-proposal apply (`proposalService.ts`) if it creates/changes Outputs,
  first-run dashboard/template (`firstRunService.ts`).
- Not invalidating (justify in the record): data-source/dataset row writes and form submit — they change Output rows
  only through a pipeline run (auto-run), which is covered by the run path below.
- SSE fan-out: on every observed `succeeded` (live or reconciled) call `invalidatePipeline(pipelineId)` before
  notifying listeners. Logout / user change: `invalidateAll()` and clear the metadata map.

**D5 — Run baseline and the staleness bound (revised round 2, CR3).** Output rows change only when a pipeline run
succeeds. Today `closeEntry` (`pipelineRunFanout.ts`) deletes the per-pipeline entry, so a resubscribe is a "first
observation" that never notifies — safe today only because the mount refetched. Fix:

- Keep a module-level `lastObservedRunIdByPipeline` that survives `closeEntry`; a new entry is initialised from it, so
  a reconnect after a run that finished while no card was subscribed is a real observation: `invalidatePipeline` then
  notify listeners (mounted cards `refresh()`, always fetches). HEL-1207's `terminalListeners` (provenance/history)
  will ALSO fire on such a reconnect — a deliberate, stated behaviour change (they learn about a run they missed).
- `hasRunBaseline(pipelineId)` is true only once a terminal run id has been recorded for the pipeline. Rows are
  **reusable only when it is true** (D2). So a pipeline whose latest run was queued/running at first connect, that has
  never run, or whose `runs/latest` call failed, is never reused — its mount refetches exactly as today.
- A pipeline never observed in this page lifetime keeps today's first-observation semantics (HEL-1174's e2e "status
  region empty before any fan-out refresh" and `pipelineRunFanout.test.ts`'s per-test pipeline ids are unaffected).
- Resulting bound: reused rows can only be served within the retention window (card on screen, or released < 30s ago),
  with a recorded run baseline, and any run that finished since that baseline is detected on reconnect and triggers a
  refresh. Reused metadata is bounded the same way, and this client's own writes invalidate immediately. Edits made by
  ANOTHER client to an Output's config are as stale as they already are for a mounted card today. Pre-existing race,
  unchanged: a run finishing between the first rows response and the first run-status check is recorded silently as
  the baseline (exists today; not introduced here). When reuse fails AND
  the reconnect notifies, a remount can issue two rows requests (mount + refresh) — report it in the burst numbers.

**D6 — Cold-load double fetch.** Investigate first (task 1.3). Expected: StrictMode's dev double effect run reading
the closure; D2's live-state pending check removes it in dev; production unaffected (state so). If it is instead a real
double mount, fix only if it is the same remount/cache-miss root cause; otherwise file as follow-up.

**D7 — Out of scope remainder, measured not fixed.** SSE close/reopen (`runs/latest`, `run-events`) and
`assertion-status` per crossing are counted in the burst proof and reported; if together they keep 3 crossings/min well
under 120 in production, they are listed as a follow-up, not fixed here.

**D8 — Design-gate round-5 execution notes (binding, C6).** N1: in `usePanelData`, the `ownershipSkippedKey` early
return comes before any clearing; its "entry present" clear uses the render-captured `paginationEntry`, never
`store.getState()` (else StrictMode's re-run clears it and re-sends the stripped query). N2: an ownership/pending skip
never leaves `inFlightRef` stuck — `refresh()` dispatches after the owned request settles or fails (jest check). N3: the
parent records the request id it skipped/waited on (from live `latestFetchRequestId`) and surfaces `lastError` for THAT
request whatever its origin, so a card with no rows never shows the empty state on a failed request it waited on.

## Verification (binding — C3/C4)

Fixtures for V1 and V3 MUST include, besides plain table/chart panels: (a) a table Output with a persisted `columnSort`
default (and one with a persisted `columnFilters` default if cheap), and (b) a panel with an active URL viewer control.
Expected per-crossing count for EVERY panel type after the fix: 0 rows requests, 0 `GET /api/outputs/:id`.

1. Jest red-first (rendered under `<React.StrictMode>`): render the PanelGrid shell with those panel types, cross 768, count rows (`fetchPanelPage` network
   calls via mocked httpClient) and `getOutputById` calls: red on main, green after. Record the red run.
2. Jest ordering (CR2): prime the metadata cache, mount (a) a persisted-default table and (b) a panel under an active
   cross-filter whose server term comes from `useCrossFilterServerOps`, each with a window that is NOT reusable; assert
   exactly one page-0 dispatch per mount and that the settled `lastQuery`/`total` is the owner's (sorted/filtered/
   cross-filtered) one; record a mutation (e.g. dropping the `mountOwner` skip) that turns it red.
3. Jest staleness: (a) updateOutput then remount -> 1 metadata request, new config rendered; (b) fetch, unmount, a run
   succeeds while no subscriber is registered, remount within the window -> the reconnect notifies and a rows request
   is issued; (b2) no run baseline (latest run running at first connect / never run / `runs/latest` failed) -> remount
   refetches; (b3) card mounted > 30s, then cross -> 0 rows, 0 metadata requests (retention, not fetch age);
   (b4) unmounted > 30s, remount -> refetch; (c) concurrent consumers -> 1 metadata request; (d) failed metadata fetch not cached; (e) a page-0
   429 after success -> remount refetches, and an in-flight-skipped mount surfaces the failure as an error, not noData;
   (f) StrictMode cold mount -> 1 rows request per panel; (f2) `PanelDetailModal` opened over a card that owns its
   mount and has a session column filter fetches its own query; (f3) a mounted card whose bound Output changes fetches
   page 0; (f4) reuse still works after a "Load more"; (f5) under `<React.StrictMode>`, a duplicate panel on an Output
   whose metadata is cached but that has NO rows entry, with a persisted sort default: exactly one page-0 request, and
   the final `lastQuery` is the sorted one — with a recorded mutation (dropping the `ownershipSkippedKey` early return)
   that turns it red; (g) a failed user-driven sort refetch shows the toast and
   keeps the table + filter input mounted (no error banner). Each guard needs a recorded mutation that turns it red.
4. Playwright burst spec (running app, throwaway user, exact-id cleanup): count ALL `/api/*` requests across N=3
   desktop<->phone crossings, before (main) and after; assert after-fix rows=0 and outputs/:id=0 per crossing; report
   totals and the remainder by endpoint; include a "read for > 30s, then cross" case; explicitly state StrictMode
   doubling (dev) and the production expectation.
   Wait on RGL processed width per HEL-1413's pattern rather than fixed sleeps (do not retrofit other specs — HEL-1418).
5. Live staleness in the running app: edit an Output's config (HEL-1389 patch path) and kind if editable, re-run its
   pipeline, cross the boundary, confirm fresh metadata/rows render. Visual check in BOTH themes at desktop and phone
   width.

## Risks / Trade-offs

- Stale data after an unobserved external write, bounded by 30s on remount (D5).
- Missed invalidation path → stale metadata after an edit until the window lapses; mitigated by mechanical enumeration
  (D4) and the staleness tests.
- Module-level caches leak between jest tests — expose a test reset and call it in setup.
