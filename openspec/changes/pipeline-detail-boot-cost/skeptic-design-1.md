## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 70b063a47046910b4526f7de0add5901cc39fbb0 (change dir untracked). Spawn-cwd guard: READY.

### What I verified (with evidence)

- **Boot effects match design Context.** `usePipelineDetailPage.ts:301-318`: the mount effect is guarded by `lastFetchedIdRef` and dispatches pipeline/steps/analyze/schedule/outputs; `:320-324` dispatches `fetchSources` only when `sourcesStatus === "idle"`; `:464-468` dispatches `fetchPipelineRunHistory(id)` with no guard, deps `[dispatch, id]`. `main.tsx:61-67` renders under `React.StrictMode`, and React is `^19.3.0`. StrictMode's dev-only effect double-invoke keeps refs, so the ref-guarded effect fires once and the unguarded one twice. That makes D1's leading hypothesis plausible. D1 also requires the hypothesis to flip both ways, which is the right bar.
- **Run-history consumers.** `runs` is read in only two places: `PipelineDetailPage.tsx:188-191` (the persisted truncation banner, gated on `currentPipeline.lastRunTruncated === true`) and `:388` (`RunHistoryModal`). The footer's truncation badge reads `currentPipeline.lastRunTruncated` (`:384`), not `runs`. So the design's claim that the banner is the only first-paint consumer holds.
- **Other refetch sites.** `onTerminal` (`:271`), `handleRunPipeline` (`:1258`) and `handleDryRun` (`:1271`) all dispatch `fetchPipelineRunHistory`. The thunk (`pipelinesSlice.ts:258-269`) has no `condition` and no status. Only `fulfilled` is handled (`:537-539`), so there is no pending/rejected state for a modal to use. D2/D3's new status field is needed.
- **Precedent for the condition pattern.** `fetchPipelines` (`pipelinesSlice.ts:175-186`) uses a `condition`, so D2 is idiomatic.
- **Redux persistence.** `clearRunState` (`pipelinesSlice.ts:371-383`) does not touch `runHistory`. Nothing else resets it, so run history (and any new per-pipeline status) survives across page opens in one session. `fetchPipelineById.pending` (`:420-425`) does not clear `currentPipeline`, so a different pipeline's summary stays in `currentPipeline` while the new one loads.
- **HEL-1298 numbers.** I checked them in the archived `root-cause-evidence.md`:
  - "7 parallel API calls … duplicate run-history GET" and "Outputs tab 2.6-3.4s at 6x / 0.19s idle" are at line 48-49. They were measured on the **loaded** host (load average 10-17, line 10), during the New-pipeline flow, not after a `page.goto`.
  - The hel910 8x figures 26.8/27.2/27.6/28.0 are at line 73. The configuration is at line 65: "throttle R + **3 niced burners** (recorded PIDs, killed by PID) + 2 workers + nice 19", started only once the 1-min load was below 2, with n=20.
- **hel910 reaches the detail page by client-side navigation after creating a pipeline**, not by `goto` (`e2e/hel910-pipeline-to-dashboard-flow.spec.ts:114,153`).
- **Scope and constraints.** Proposal Non-goals cover HEL-1350's files, `ci.yml`, `playwright.config.ts` and `.gitignore`. There is no backend or contract change, so no schema delta is needed. Every AC maps to a task: duplicate root cause → 1.1/1.2/2.1; defer → 1.4/2.2/2.4; before/after → 1.3/3.4; RTL → 3.x. I found no TODO or TBD placeholders.

### Verdict: REFUTE

### Change Requests

1. **Run history goes stale across page opens; the design and spec disagree.**
   - The problem:
     - D3 fetches on modal open only "if not already loaded or loading **for this pipeline**", keyed on a per-pipeline `runHistoryStatus`.
     - That state lives in Redux, and nothing resets it between page opens (`clearRunState`, `pipelinesSlice.ts:371-383`, leaves `runHistory` alone).
     - So a second visit to the same pipeline in one session finds status `succeeded`. It would show the old list and miss runs made since: scheduled runs, dataset-write auto-runs, other tabs.
     - Today every page open refetches (`usePipelineDetailPage.ts:464-468`), so this is a behaviour regression the ticket forbids.
     - The spec scenario says "has not been loaded **for this page open**", which contradicts D3.
   - The fix:
     - Define freshness per page open: either reset the pipeline's status when the page unmounts or `id` changes, or always dispatch on modal open and rely on the in-flight `condition` alone.
     - Apply the same rule to the truncated-boot fetch.
     - Gate that fetch on `currentPipeline.id === id` with a succeeded status, not merely "currentPipeline has loaded". `fetchPipelineById.pending` (`:420-425`) leaves the previous pipeline in `currentPipeline`.
     - Add an RTL test: open page → open modal → navigate away → return → open modal again issues a new GET.
2. **The in-flight dedupe can swallow the post-terminal refresh, so the spec's "a finished run still refreshes" scenario is not guaranteed.**
   - The sequence:
     1. A modal-open (or truncated-boot) fetch starts before a run finishes.
     2. That fetch is still in flight when `onTerminal` (`:271`) or the post-submit dispatch (`:1258`/`:1271`) fires.
     3. D2's `condition` skips the refresh.
     4. The pre-run response lands, and the modal never shows the finished run.
   - D2 only says "a post-terminal refresh must still go out when a fetch completed earlier", which leaves this race unaddressed.
   - The fix: specify the mechanism. Options include a trailing "refetch-after-current" flag consumed on settle, or a `force` argument that the terminal and post-submit callers pass to bypass the dedupe. Extend task 3.3 to cover this exact interleaving, red against the bare-`condition` version.
3. **D5's "HEL-1298 8x configuration" is not HEL-1298's configuration.**
   - The AC requires "the hel910 scenario duration at the HEL-1298 8x configuration".
   - HEL-1298's 26.8-28.0 s figures came from 8x CDP throttle, 3 niced burners (recorded PIDs), `--workers 2`, `nice -n 19`, a load gate of 1-min load below 2 before each batch, and n=20 (`root-cause-evidence.md:65,73`).
   - D5 runs that comparison on a "quiet host" with burners used "only if a loaded-host comparison is reported", and n ≥ 10. That is a different, lighter configuration.
   - The fix:
     - Revise D5 (and task 1.3/3.4) to reproduce the configuration exactly: 8x, 3 niced burners killed only by recorded PID (driver constraint), 2 workers, nice 19, the load-below-2 gate, and n=20 per side.
     - Record loadavg before and after each batch.
     - Capture the `diff` of the hook-only copy against the committed spec.
4. **The modal title still claims emptiness while loading.**
   - `RunHistoryModal.tsx:166` titles the modal `Run history (${runs.length})`. That reads "Run history (0)" while loading or after an error, which states emptiness just as the empty state does.
   - D3 and the spec ban only the "No runs recorded yet" body.
   - The fix: specify the title for the loading and error states (for example, no count until `succeeded`). Cover it in the 3.2 RTL tests.

### Non-blocking notes

- D5's Outputs-tab time-to-interactive (TTI) is measured from `page.goto`. HEL-1298's 2.6-3.4 s was measured on a loaded host (load 10-17), after New-pipeline client navigation. Say in `measurements.md` that the ticket's figure is not like-for-like with your own "before", rather than comparing against it. Consider also timing the post-create navigation path, since that is how hel910 reaches the page.
- 1.4 `boot-audit.md`: it is reasonable to expect that none of the other six calls can be deferred, but note `analyzePipeline`. It feeds the river input schemas, so check whether its render cost (not its request) dominates TTI under throttle. That is the most likely follow-up candidate.
- D2's `condition` should read the status keyed by the thunk's `pipelineId` argument, so two pipelines never dedupe each other. The implementation will probably do this; state it.
