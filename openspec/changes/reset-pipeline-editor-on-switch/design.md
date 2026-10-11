## Context

See proposal.md for motivation. Current state (main bc8ccac45):

- `frontend/src/app/AppRoutes.tsx:115` renders `<Route path="/pipelines/:id" element={<PipelineDetailPage />} />` with no `key`, so an in-app `:id` change re-renders the SAME component instance.
- `usePipelineDetailPage.ts` holds the editor's local `steps` state and seeds it once, in a derived-state block, `if (!stepsInitialized && persistedSteps.length > 0)` (line ~228). `stepsInitialized` is only ever set to `true`. This is the ticket's suspected cause; it is a static reading, not yet a probe-confirmed root cause.
- Many other per-page refs/state are implicitly per-pipeline: `pendingDraftMetaRef`, `draftFallbackMetaRef`, `pendingDraftIds`, `seedToken`/`consumedSeedTokenRef`, `lastAnalyzedFingerprintRef`/`pendingAnalyzeRef`/watchdog, `outputNamePipelineId` (this one IS id-aware), sheet/dialog open flags, `usePipelineRunStream`'s SSE subscription, `usePipelinePageLoad`'s `lastFetchedIdRef` (id-aware), and per-StepCard debounced persists (`useStepCardPersist`, which clears its timer on unmount — so an unmount drops, it does not flush).
- Redux `pipelines` slice: `steps` and `analyzeResult` are keyed by pipeline id, but `currentPipeline`, `currentPipelineStatus`, run status/result are singletons; a `fetchPipelineById(A)` resolving after the switch to B could overwrite `currentPipeline` unless the reducer guards on the requested id (to be probed, not assumed).

## Goals / Non-Goals

**Goals:**
- Probe-confirmed root cause (Iron Law, `systematic-debugging`) before any fix, recorded as evidence.
- After an in-app switch A -> B (every route: list/sidebar, command palette, recents, back/forward) the editor shows B's steps only.
- No write/analyze for B built from A's steps; no late A response replaces B's displayed state.
- Red-first regression test driving the in-app switch.

**Non-Goals:**
- Flushing (rather than dropping) a not-yet-sent debounced step edit when leaving a pipeline. Today, navigating from a pipeline to any other page already unmounts the StepCards and drops the pending debounce; the fix must make a pipeline->pipeline switch behave the SAME as pipeline->elsewhere, not introduce new flush semantics. If the executor finds that today's pipeline->elsewhere behaviour itself loses data in a way the owner would care about, that is a follow-up, not this ticket.
- Any backend change.
- Refactoring the split hooks beyond what the fix needs.

## Decisions

### D1. Probe first; the fix is chosen by the probe

The executor reproduces in the running app (own dev ports 6915/9822, throwaway user, exact-id cleanup) via in-app navigation through each route, and writes a failing jest test that renders the page in a `MemoryRouter`, loads A, navigates to B via the router (not a remount), and asserts B's step cards. Only then is a fix applied. If the probe shows a different or additional cause (e.g. a late `fetchPipelineById` overwrite), that cause is fixed too and recorded.

### D2. Preferred fix: remount the page per pipeline id (key by `:id`)

Render the route element through a thin wrapper that reads `useParams().id` and renders `<PipelineDetailPage key={id} />` (or key inside `PipelineDetailPage` around an inner component). Rationale: the page has dozens of per-pipeline refs/state spread across ~20 hooks; a manual reset effect would have to enumerate every one and would silently rot as hooks are added (HEL-1465/1478/1481 just reshuffled them). A remount makes "pipeline switch == leave and re-enter", which is the behaviour every other navigation already has and every hook is already written for (unmount cleanups exist: StepCard debounce clear, SSE unsubscribe, watchdog clear).

Alternative considered: reset `stepsInitialized`/`steps` (and the other refs) in a derived-state block when `id` changes. Rejected unless the probe shows a remount is unsafe — it fixes the reported symptom but leaves every other per-pipeline ref to be audited by hand.

The executor MUST enumerate in its evidence what the remount resets (unsaved drafts, debounce timers, open sheets/modals, SSE subscription, run-history modal, output-name field, local pending-AI drafts) and confirm each is correct to reset on a pipeline switch.

### D2a. Seed from this mount's own steps fetch, not a stale cache (design-gate REFUTE item 1)

With D2 a fresh instance would seed `steps` on its FIRST render from the cached `reduxSteps[id]` (only written by `fetchPipelineSteps.fulfilled`; local config edits never update it), and `stepsInitialized` then blocks the reseed when the page's own fresh fetch lands. So A -> edit A -> B -> back to A would show A's pre-edit config. Decision: the editor seeds `steps` only once the steps fetch issued by THIS mount for THIS id has fulfilled (e.g. track the mount's request id / a `seededFromFetch` marker, or seed in response to `stepsStatus[id]` transitioning loading -> succeeded after this mount's dispatch), never from a cache entry that pre-dates the mount. The executor probes the stale-revisit symptom on base first (red), then fixes. Showing a loading state for the steps until the fetch lands is acceptable (it is what a cold open already shows). This is a reversible implementation choice inside the ticket's scope (the editor showing wrong steps for the current pipeline), not a new product call.

### D3. Cross-pipeline write safety is verified, not assumed

Independently of D2, the executor tests (red-first where a defect exists):
Rule (design-gate REFUTE item 2): step PATCH/enable/duplicate/DELETE go to `/api/pipeline-steps/:stepId` with NO pipeline id in the URL, so a URL-based check is vacuous. The assertion is: **after the switch, no request issued from the B page carries any of A's step ids, in the URL or the body** (covers step PATCH/DELETE/enable/duplicate, reorder, create-with-parent/anchor, preview, analyze), and no request for A's pending debounce fires after the switch.

1. A step-config edit on A whose debounce is pending at the switch: no request carrying A's step id fires after the switch (with D2, the StepCard unmounts and clears the timer; prove it).
2. An already-sent A write/thunk (step PATCH, create, delete, reorder) resolving after the switch does not replace B's displayed steps or `currentPipeline` (Redux steps are keyed by pipeline id — verify the fulfilled reducers use the request's id, not `currentPipeline`).
3. A late `fetchPipelineById(A)` / `fetchPipelineSteps(A)` / `analyzePipeline(A)` resolving after the switch does not make the B page render A's name/steps/analyze.
4. On base, with stale A cards on B's page, record whether an edit issues a request carrying an A step id (URL or body) — this answers the ticket's "widen" question (on base it is expected to PATCH A's step from B's page) even though the fix removes the path.

Any defect found in 2/3 is fixed in the slice (guard the singleton fields on `meta.arg` matching the latest requested id) and covered by a test. Any such guard MUST NOT leave `currentPipelineStatus` stuck at "loading" (the page-load hook skips while loading).

### D5. Singleton Redux fields a remount does not reset (design-gate REFUTE item 3)

A remount resets component state only; these shared `pipelines` slice fields survive it and must be handled, each red-first:
- (a) **Failed-load latch.** `usePipelinePageLoad` skips the fetch while `currentPipelineStatus === "failed"`, so if A failed to load (404/403), switching to B never fetches B and B's page shows A's error (with no Retry for not-found/forbidden). Fix: the failed/loading skip applies only when that status belongs to the CURRENT id (record which pipeline id the status/error is for, e.g. `meta.arg` on pending/rejected), so a different id always fetches.
- (b) **Late run result.** `submitPipelineRun.fulfilled` writes `runResult`/`runStatus`/row counts unconditionally, so A's run resolving after the switch (after the unmount's `clearRunState`) lands on B's page. Fix: ignore a run fulfilment/rejection whose `meta.arg` pipeline id is not the pipeline the run state currently belongs to (cleared state = none).
- (c) The brief flash of A's name/header on B's first render (`currentPipeline` still A until B's fetch lands): the page must treat `currentPipeline.id !== id` as loading, not render A's data as B's.

### D6. Other same-instance switch sites

Besides list/sidebar, command palette, recents and back/forward, the executor checks the other in-app paths that change `:id` on the mounted page (create-pipeline modal navigating to the new pipeline, `?outputId=` deep links, source-conflict links) and confirms each lands on a clean editor.

### D4. Tests

- Jest (RTL) integration test alongside the existing `PipelineDetailPage.*.test.tsx` files, driving the switch via router navigation within one render; red on base, green after. Plus slice-level tests for any D3 guard.
- Playwright e2e only if a behaviour (e.g. browser back/forward, command palette) cannot be shown in jest. Known flakes hel1028 / hel813 are not this ticket's concern.

## Risks / Trade-offs

- [Remount drops an un-flushed debounced edit on switch] -> Same as navigating to any other page today; documented, not changed (Non-Goal). Called out in the PR.
- [Remount re-runs page-open fetches (pipeline, steps, analyze, schedule, outputs, sources)] -> These already re-run on id change via `usePipelinePageLoad`; `fetchSources` is guarded by sources status. Executor confirms request counts on a switch are not worse than a fresh open (HEL-1354 "boot requests are bounded" requirement).
- [Singleton Redux fields (`currentPipeline`, run state) flash A's values on the new instance's first render] -> The loading/`currentPipeline.id !== id` handling must not render A's data as B's; probe and guard if seen.
- [Overlap with concurrent lanes HEL-1307/1306 in Output editor files] -> Keep the diff out of Output editor files where possible; re-sync with origin/main before the PR.
