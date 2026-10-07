## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 70b063a47046910b4526f7de0add5901cc39fbb0 (the change dir is untracked). Spawn-cwd guard: READY.

### What I verified (with evidence)

**Round-1 CR3 (the 8x configuration) is resolved.**
- D5 and standing constraint C1 now reproduce the configuration at `archive/2026-10-06-e2e-contention-robustness/root-cause-evidence.md:65,73`: 8x CDP throttle, 3 niced burners killed by recorded PID, 2 workers, nice 19, the 1-min load < 2 gate, n=20 per side, loadavg before and after each batch.
- The per-batch hook-only `diff` is captured.
- The not-like-for-like note on the 2.6-3.4 s figure and the post-create-navigation timing were added.

**Round-1 CR4 (title shows "(0)") is resolved.**
- `RunHistoryModal.tsx:166` currently renders `Run history (${runs.length})`.
- D3 now specifies a count-free title in the loading and error states. The count and the empty state appear only on `succeeded`.
- Two spec scenarios and tasks 2.3/3.2 cover this.

**Round-1 CR2 (in-flight dedupe swallows the refresh) is resolved in the design.**
- `fetchPipelineRunHistory` currently takes a bare `string` and has no `condition` (`pipelinesSlice.ts:258-269`).
- D2 adds `{pipelineId, force?}`, a dedupe keyed on the argument's pipelineId, and latest-request-wins via `runHistoryRequestId`.
- The three post-run callers (`usePipelineDetailPage.ts:271,1258,1271`) pass `force: true`.
- The spec scenario "A run finishing during an in-flight fetch still refreshes" and task 3.3 (red against a bare-`condition` version) cover the exact interleaving.

**Round-1 CR1 (staleness across page opens) is addressed only in part. The new mechanism introduces a defect; see CR1 below.**
- The design now resets status in the existing unmount/`id`-change cleanup (`usePipelineDetailPage.ts:471-479`, deps `[dispatch, id]`).
- It gates the boot fetch on `currentPipeline?.id === id` plus "the pipeline fetch succeeded".
- The spec adds the revisit scenario.

**Ground truth behind the new defect:**
- `main.tsx` renders under `React.StrictMode`. StrictMode's dev mount sequence runs every effect, then every cleanup, then every effect again, with the same render closure and with refs preserved.
- Nothing resets `currentPipeline`/`currentPipelineStatus` on unmount:
  - `clearRunState` at `pipelinesSlice.ts:371-383` does not.
  - `fetchPipelineById.pending` at `:420-425` sets only `currentPipelineStatus = "loading"`.
  - `currentPipeline = null` occurs only on rejected (`:433`) and deletePipeline (`:470`).
- So on a revisit to the same pipeline in one session, the first render's closure still sees `currentPipeline.id === id` with status `succeeded` from the previous visit.
- The RTL harness `renderDetailPage` (`PipelineDetailPage.test.tsx:332-347`) does **not** wrap in `StrictMode`. Precedent for a StrictMode RTL test exists at `features/panels/ui/PanelCard.staleFetchSequencing.test.tsx:10,119`.

**Existing tests that will change** (checked, not blocking):
- `PipelineDetailPage.test.tsx:2352` ("dispatches fetchPipelineRunHistory on mount") inverts by design.
- The modal tests at `:2291-2345, :3361, :3500, :3521` seed `runHistory` and assert synchronously after `openRunHistory()`. Under D3's status gate they will show a loading state instead.

**Scope and AC coverage are unchanged from round 1 and still complete.** I found no TODO/TBD placeholders and no contract or schema impact.

### Verdict: REFUTE

### Change Requests

1. **D3's cleanup reset brings back a StrictMode duplicate run-history GET, and lets a late response mark a revisit "fresh".**
   - **(a) Duplicate GET on revisit.** Take a revisit, in one session, to a pipeline whose `lastRunTruncated === true`, in dev or e2e (StrictMode):
     1. The boot gate (`currentPipeline?.id === id` and status `succeeded`) is already true on the first render. It is true from the previous visit's stale store, not from this page open's fetch.
     2. Effect run #1 dispatches the fetch, so the status becomes `loading`.
     3. StrictMode's simulated unmount runs the cleanup at `usePipelineDetailPage.ts:471`, which now dispatches `resetRunHistoryStatus(id)`, so the status becomes `idle`.
     4. Effect run #2, with the same closure, dispatches again. The in-flight `condition` sees `idle` and lets it through.
     5. Result: **two GETs**, which violates the new requirement ("SHALL NOT … more than one GET … including React StrictMode") and the scenario "exactly one run-history GET".
     - This is the same StrictMode mechanism D1 names as the ticket's leading root cause, reintroduced by the fix.
     - It is invisible to every planned test: the RTL harness is not StrictMode, and the 2.2 probe only checks a first visit.
   - **(b) Late response marks a revisit fresh.**
     1. A fetch is in flight at unmount (the modal was just opened, or a forced post-run fetch).
     2. Its `fulfilled` still matches the latest `runHistoryRequestId`, so after the reset it sets the status back to `succeeded`.
     3. The next visit's modal then shows the previous visit's list without refetching. That violates "a list loaded on an earlier visit SHALL NOT be shown without being refetched".
   - **(c) Stale boot gate.** The gate "the pipeline fetch succeeded" reads the store's `currentPipelineStatus`, which on a revisit is the previous visit's value. The truncated-boot decision is then made on a stale `lastRunTruncated`.
   - **Required revision:** pick a mechanism that closes (a) and (b) together, and state it in D2/D3 and the spec. For example:
     - drop the cleanup reset entirely, have the modal-open path always dispatch (non-forced) so only the in-flight `condition` dedupes, and drive freshness from this page open;
     - or keep a per-page-open token (a hook ref, set per mount/`id`, not reset by StrictMode's re-run) that records "fetched during this open";
     - or, if a store reset is kept, make it StrictMode-safe and make it invalidate the in-flight request so a late response cannot set `succeeded`.
   - Also make the boot gate this page open's pipeline fetch, not the persisted `currentPipelineStatus`.
   - Add tests:
     - an RTL test rendered inside `<StrictMode>` (precedent: `PanelCard.staleFetchSequencing.test.tsx`) for a **revisit** to a truncated pipeline, asserting exactly one run-history GET;
     - a test where a response lands after unmount, and the next visit's modal open still issues a GET.
   - Each must be red against the round-2 design's reset-in-cleanup version.

### Non-blocking notes
- Task 3.x should say how the existing modal tests (`PipelineDetailPage.test.tsx:2291-2345, 3361, 3500, 3521`) are migrated. Mocking `fetchRunHistory` to resolve the run and awaiting it keeps them exercising the new fetch-on-open path. Seeding `succeeded` status would bypass it and could mask a regression.
- The `:2352` "dispatches on mount" test should be rewritten as the "no fetch on a non-truncated open" assertion, not just deleted.
- Two forced GETs per run remain (the post-submit dispatch plus SSE `onTerminal`). That is the same as today and is not a regression, but it is worth one line in `boot-audit.md`.
