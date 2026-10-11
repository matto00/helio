## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `bc8ccac45160dbd5ddc6a4043bc07055e5c09c39` (the change dir is untracked; no code diff yet).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/pipeline-switch-stale-steps/HEL-1483`.

### What I verified (with evidence)

- **Route reuse claim — TRUE.** `frontend/src/app/AppRoutes.tsx:115` is `<Route path="/pipelines/:id" element={<PipelineDetailPage />} />` with no key.
- **Suspected cause plausible — TRUE (static).** `usePipelineDetailPage.ts:136` `stepsInitialized` state, only ever set true at `:228-230` (`if (!stepsInitialized && persistedSteps.length > 0)`). Nothing resets it on `id` change. Probe-first is still correctly required by D1/task 1.x.
- **Unmount cleanups D2 relies on — TRUE.** `useStepCardPersist.ts:45-49` clears the debounce on unmount (drops, does not flush). `usePipelineDebouncedAnalyze.ts:128` clears its timer. `usePipelineAnalyzeDeferWatchdog.ts` documents `clearDeferWatchdog` "on unmount". `usePipelineDetailPage.ts:308-317` already dispatches `clearRunState()` and `resetRunScopedState()` in an `[dispatch, id]` cleanup, so a remount still clears run state.
- **Per-id Redux state — TRUE as stated.** `steps`, `analyzeResult`, `schedule` and `runHistory*` are keyed by pipeline id. `currentPipeline`/`currentPipelineStatus`/`currentPipelineError*`/`run*` are singletons. `fetchPipelineById.fulfilled` (`pipelinesSlice.ts:465-470`) has no guard on `meta.arg`, so D3.3's concern is real.
- **D2 (key by `:id` via a thin wrapper) — sound in principle.** It turns the switch into "leave and re-enter", which every hook already handles. A manual reset across ~20 hooks would rot. I agree with the preference. But "leave and re-enter" brings along any defect that re-entry already has. See CR1.
- **Non-Goal (no flush of an unsent debounced edit) — acceptable.** It matches pipeline->elsewhere behaviour (verified at `useStepCardPersist.ts:45-49`). An already-sent PATCH still completes, because the request is not cancelled. Only the unsent debounce window (400 ms, `STEP_CONFIG_PERSIST_DEBOUNCE_MS`) is lost. The PR must disclose this, and the design already says it will.
- **Probe-first ordering — enforced well enough.** Tasks 1.1-1.4 (probe, widen, red test) come before 2.x, D1 says "Only then is a fix applied", and AC1 requires the probe to be recorded. Nothing enforces it mechanically, but the evaluator can audit it from the evidence ordering and the red-on-base record.

### Verdict: REFUTE

The core decision (D2) is sound. But the plan misses one AC-relevant defect that D2 brings along unchanged. Its cross-pipeline-write assertion also has a blind spot that would let a test pass vacuously. Both need fixing in the artifacts before execution.

### Change Requests

1. **D2 brings along a stale-cache seed, which breaks AC2 and the spec's "Browser back" scenario. Add a probe and a decision.**
   - The new instance seeds `steps` during its *first render* from `reduxSteps[id]` (`usePipelineDetailPage.ts:96, 228-230`). That data was cached on the previous visit.
   - Local step-config edits never write back to `state.steps[pid]`. The only writer is `fetchPipelineSteps.fulfilled` (`pipelinesSlice.ts:484`). `handleStepConfigChange` (`usePipelineStepMutations.ts:47-54`) only calls `setSteps` locally.
   - Once seeded, `stepsInitialized` is true, so the fresh `fetchPipelineSteps(id)` that `usePipelinePageLoad.ts:50` fires on the remount does **not** reseed.
   - Static prediction: edit a step config on A (PATCH persists), switch to B, then press browser back (or switch to A). The editor shows A's *pre-edit* config, not "exactly A's persisted steps" (spec scenario 2, AC2). The same applies to B if B was edited earlier in the session.
   - This is a static reading. Add a task-1.x probe that edits A, switches A->B->A and compares the cards with `GET /api/pipelines/A/steps`.
   - Add a design decision for the case where the probe confirms it. For example: seed only from a steps fetch that this mount issued and that has fulfilled, or reseed when that fetch fulfils if there are no local edits. The alternative is to scope it out explicitly as a follow-up and soften the spec's "Browser back" scenario to match, with that recorded as an owner-visible decision.
   - As written, D2 plus the current spec would fail its own scenario as soon as a test edits before switching.

2. **The cross-pipeline-write assertion is URL-scoped, but the step endpoints carry no pipeline id. Reword the spec scenario and D3.**
   - `updatePipelineStep`, `updatePipelineStepEnabled`, duplicate and delete all hit `/api/pipeline-steps/:stepId` (`pipelineService.ts:146-181`). They never include a pipeline id.
   - Spec scenario 3 ("no ... request is sent to pipeline B's endpoints carrying one of A's step ids") and D3.4 ("request to B's URL with an A step id") would both pass vacuously on base. A stale A card edited on B's page PATCHes **A's** step, a write the user meant for B that lands on A, and neither assertion inspects that URL.
   - Restate the invariant as: *while the B page is shown, no request of any kind carries one of A's step ids*. That includes `PATCH/DELETE /api/pipeline-steps/:id`, `POST /api/pipeline-steps/:id/duplicate`, `PUT /api/pipelines/B/steps/order` (A ids in the body), `POST /api/pipelines/B/steps` (A id as parent or anchor) and `/api/pipelines/B/steps/:stepId/preview`.
   - Make D3.4's base-recording task and the regression test assert on the step id wherever it appears (URL or body), not on the pipeline id in the URL.

3. **Extend D3 to cover the singleton Redux leaks that D2 does not fix. Probe each one and record "fixed" or "follow-up".**
   - (a) **Failed-status latch.** `usePipelinePageLoad.ts:45` returns early when `currentPipelineStatus === "failed"`, and only a successful or new fetch clears that status. If A failed to load (deleted, 404 or 403), switching to B never fetches B, and the page shows A's "Couldn't load this pipeline" (`PipelineDetailPage.tsx:126-147`). No Retry is offered for `not-found`/`forbidden`. A fresh instance (D2) does not help, because the latch lives in Redux. This falls directly under AC2/AC5.
   - (b) **Late `submitPipelineRun(A)` resolution.** If A's run resolves after the switch, `submitPipelineRun.fulfilled` (`pipelinesSlice.ts:560-569`) writes `runResult`/`runStepRowCounts`/truncation state *after* the unmount's `clearRunState()`, so they show on B's page. D3 lists `fetchPipelineById`/`fetchPipelineSteps`/`analyzePipeline`, but not the run thunk or `setRunStatus` from A's SSE. Add them.
   - D3 already covers `fetchPipelineById` (keep it). When the guard is designed, make sure it cannot leave `currentPipelineStatus` stuck at `"loading"`. `usePipelinePageLoad.ts:45` also skips while the status is `"loading"`, so B's fetch would never be dispatched.

### Non-blocking notes

- AC2's route list (list/sidebar, palette, recents, back/forward) is a subset of the same-instance switch sites. `CreatePipelineModal.tsx:102` (creating from the sidebar while on A), `PanelDetailModal.tsx:244`/`OutputPanelSection.tsx:45` (`?outputId=` deep link) and `SourceDeleteConflictNotice.tsx:68` also navigate `/pipelines/A` -> `/pipelines/B`. D2 covers all of them, but one jest case using the `?outputId=` deep link would also exercise the deep-link effect after a remount.
- Risk 3 (the first render of the B instance sees `currentPipeline` = A): `usePipelineDetailPage.ts:223-226` seeds `outputName` from A's name and then corrects it when B arrives. The header can also briefly show A's name. A cheap guard is to treat `currentPipeline?.id !== id` as loading in `PipelineDetailPage.tsx:150`. Worth doing if the probe shows the flash.
- Task 3.2's "no duplicate/excess boot requests vs a fresh open" is a good check (HEL-1354). Keep the request-count evidence when switching.
