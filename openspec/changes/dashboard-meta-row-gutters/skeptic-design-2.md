## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585. The change dir is still untracked, so the artifacts were read from the working tree. The scope under review is what the orchestrator wants to run now: group 1 (gutter token, DESIGN.md bullet, content-fit check) and task 3.1 (the `useDashboardMeta` derivation with live update, not mounted visibly). I also checked how each round-1 item was handled.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/dashboard-meta-row-gutters/HEL-1576`.
- **Escalation is real:** `.concertino/runs/HEL-1576/events.jsonl:7` is an `escalation.raised` for `HEL-1576-1792053980784-c95b08`. It has three sub-questions: shell rows, `drag-only-in-edit|drag-always`, and the AC4 gap options. workflow-state.md `OPEN_ESCALATION` matches and blocks `tasks 2.x, 3.2-3.4, 5.1`. CR1 and CR2 are routed correctly.
- **Group 1 is sound:**
  - `panelGridConfig.ts:34` `margin: [18, 18]` is the only source.
  - Its consumers are `DesktopPanelGrid.tsx:143` and `DesktopPanelGridSkeleton.tsx:53`, so the skeleton follows automatically.
  - `theme.css:50` declares `--space-3: 0.75rem; /* 12px */`, and D7 now converts rem at 16px.
  - Stale-literal sweep: `grep -rnE "18, ?18|332|262|..."` over `frontend/src`, `e2e`, `DESIGN.md` and `openspec/specs` hits only `panelGridConfig.ts:34`, `DesktopPanelGrid.processedWidth.test.tsx:66`, `openspec/specs/panel-content-sizing/spec.md:76`, a comment at `MobilePanelStack.css:9` ("margin:[18,18]") and unrelated landing `rects.json` geometry. Task 1.2's grep pattern `margin.*18` catches all of the relevant ones, including the MobilePanelStack comment.
  - DESIGN.md §9 (`:986-993`) has "No dashboard title" and "Meta row" but no grid-gutter rule. The planned bullet is what makes AC3 checkable. The arithmetic (5·52 + 4·12 = 308, minimum 262→244) is correct.
  - Task 1.3 (CR8) orders the "before" capture ahead of 1.1. Nothing in group 1 depends on the escalation. **No change requested for group 1.**
- **3.1 inputs that do exist:**
  - `subscribeToPipelineTerminal(pipelineId, onTerminal: () => void)` (`pipelineRunFanout.ts:123`) shares the refcounted entry.
  - `fetchOutputMeta` / `getOutputMetaCached` (`outputMetaCache.ts:31,37`; the cached read is served only while the Output is retained, so D2's fetch-into-local-state is right).
  - `formatRelativeTime(iso, now)` (`utils/formatRelativeTime.ts:7`).
  - `Panel.outputId: string` with a default of `""` (`panel.ts:186,344`).
  - `PipelineSummary.lastRunAt/lastRunStatus/roots[].dataSourceName` (`pipelineStep.ts`).
- **3.1's refresh source does not work (see CR1 below):**
  - `fetchPipelines` has `condition: status !== "loading" && status !== "succeeded"` (`pipelinesThunks.ts:58-84`). Once it has loaded in a session, re-dispatching it is a silent no-op.
  - It is dispatched from the palette on open (`useResourceIndexing.ts:83`), `ScheduledContextList.tsx:115`, `PipelinesPage.tsx:96`, `useOutputPickerData.ts:60` and `useOnboardingHost.ts:90`, so it is routinely already loaded, possibly hours earlier.
  - `fetchPipelineById.fulfilled` writes only `state.currentPipeline` and the HEL-1483 `currentPipelineRequestedId` latest-request slot (`pipelinesSlice.ts:112-140`). It never touches `items`.
  - The only reducers that write `items` are `fetchPipelines.fulfilled` (wholesale), `createPipeline.fulfilled` (upsert) and `deletePipeline.fulfilled` (`pipelinesSlice.ts:101,175,207-209`).
  - Run completion writes nothing to `items`.
  - The fanout's listener gets no payload (`() => void`), so D2's "patch the summary from the event's own run status/time if the event carries them" branch is unavailable.
  - A pipeline's first connect in the page lifetime sets the baseline **without** firing listeners (`reconcile`, `isFirstObservation`).
- **Round-1 disposition:**
  - CR1 and CR2 are escalated (above).
  - CR3: partly addressed. The Output→pipeline resolution is now specified, but the summary refresh path is still unworkable (CR1 below).
  - CR4: task 2.3, blocked.
  - CR5 and CR6: D3, blocked scope.
  - CR7: D10b and the amended C3.
  - CR8: D10a and task 1.3.
  - Non-blocking notes: Escape guard in D4, Share provider/focus in 3.2, rem in D7, and "Done" not accent in D3 are all addressed.
  - Still open:
    - Merge-order disclosure for AC1 when this lane merges before HEL-1575 is not in tasks or the PR-body list.
    - Which button is ghost and which is bordered is still "secondary/ghost".
    - The capability rename was **not** applied to the spec tree (CR3 below).

### Verdict: REFUTE

Group 1 needs no revision. The REFUTE is confined to task 3.1's D2 mechanism (CR1) plus artifact-consistency fixes (CR2-CR4). Once CR1 is fixed, 3.1 is independent of the escalation as claimed.

### Change Requests

1. **D2 / task 3.1: specify a refresh path that actually reaches the data the hook reads.** As written, the meta row's "refreshed" time is wrong in two ordinary cases:
   - **Stale on mount.** D2 dispatches `fetchPipelines` "only if not loaded". If the palette, the Pipelines context list or the Pipelines page loaded it earlier in the session, `items[].lastRunAt` is as old as that load. A scheduled or manual run since then is invisible, and the fanout's first-observation rule will not fire a listener to correct it.
   - **Live update is a no-op.** On a terminal event, "re-read through the existing pipelines fetch" means either:
     - `fetchPipelines`, which the `condition` guard skips; or
     - `fetchPipelineById`, which writes `currentPipeline`, not `items`. It also hijacks the pipeline detail page's HEL-1483 latest-request slot and status/error, and with several feeding pipelines only the last response lands.
   - The spec scenario "A run completes while the dashboard is open → shows the new time" cannot pass through either path. The "executor reads … and records which" deferral is exactly where this gets decided wrongly.
   - Required: pick one concrete mechanism and write it into D2 and 3.1. For example:
     - (a) The hook keeps its own per-pipeline summaries in local state, fetched with the service `getPipelineById` (`pipelineService.ts:57`) for each feeding pipeline on mount, on a feeding-set change, and on each terminal event. It never reads the slice for `lastRunAt`. A failed or 404 fetch omits that pipeline.
     - (b) Add a reducer that upserts a single summary into `items` (by id, like `createPipeline.fulfilled`), fed by a new thunk that does not touch `currentPipeline*`.
   - Add to 3.1's tests:
     - a slice/cache pre-seeded with an older `lastRunAt` while the server returns a newer one: the hook shows the newer one on mount;
     - a terminal event: the newly fetched time appears without a remount;
     - with (b), the pipeline detail page's `currentPipeline`, status and error are untouched by the hook's fetches.

2. **The tasks and design still present D1 as decided.** Task 4.3 lists "D1 placement under the command bar after HEL-1575" as an overnight reversible decision. The Risks section still says "Meta row sits under the command bar after HEL-1575 → … raised as a follow-up in the PR body". Both contradict D0, which routes D1 to the owner.
   - Required: change 4.3's D1 and D4 entries and that Risks bullet to "per the owner's answer to escalation c95b08 (questions 1/2)". Otherwise an executor running 4.3 writes a PR body that misreports an owner-routed decision as a driver one.

3. **The capability rename was not applied.** proposal.md names the new capability `dashboard-layout-edit-toggle`, but the delta still lives at `specs/dashboard-layout-edit-mode/spec.md`. Archiving would create `openspec/specs/dashboard-layout-edit-mode/` next to the existing `panel-edit-mode`, which is the confusion the rename was meant to avoid.
   - Required: rename the directory to match the proposal, or revert the proposal's name. Either way, make the Purpose line say how it differs from `panel-edit-mode`.

4. **The edit-mode spec's Escape requirement disagrees with D4.** The spec says "focus outside an editable element and no dialog open". D4 and task 2.2 also exclude an open popover/menu and an event already `defaultPrevented`.
   - Required: bring the spec requirement up to D4's guard list, so the archived contract matches the tested behaviour. This is blocked scope; it can be done in the post-answer revision, but the artifact must not stay as it is.

### Non-blocking notes

- The merge-order disclosure from the round-1 notes is still missing. If this lane merges before HEL-1575, the command-bar breadcrumb still shows the dashboard name, which bears on AC1. Add it to 4.3's PR-body list.
- D3 should name which of Edit layout and Share is borderless ghost and which is bordered secondary. On the board, Edit layout is ghost and Share is secondary.
- D2's derivation should skip panels whose `outputId` is `""` (the unbound default, `panel.ts:344`). Add a test case.
- Form panels bind a dataset via `dataSourceId`, not an Output, so a dataset that feeds only a form panel never appears in "sources". That is probably right, since the board's "source" means the data a panel reads. State it in D2 so it is a decision, not an accident.
