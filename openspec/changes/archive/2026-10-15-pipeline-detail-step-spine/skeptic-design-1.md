## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `cd64409ad828d9024074f907a7ea32800ab71ff3` (planning artifacts are untracked in the change dir; no code diff yet).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/pipeline-detail-step-spine/HEL-1579`.
- **Owner rulings are real.** I checked them in the main checkout's `.concertino/runs/HEL-1579/events.jsonl`. `escalation.answered` id `HEL-1579-1792031374287-ba1634` records five answers: "sub-spine + label", `persist-last-run-counts`, `spine-output-section`, `spine-row-menu` and `header-owns-name`. The HEL-1574 events record the Delete ruling ("it should only be on overview rows. not in detail pages.") at id `HEL-1574-1791966412053-1b31cb`. DESIGN.md §9 also states it. The design follows all six rulings.
- **Analyze has no per-step counts.** `CostVerdict` carries only a whole-pipeline `estimatedRows` (`frontend/src/features/pipelines/types/pipelineStep.ts:631-637`). So the AC's "row count from the latest run or analyze" can only be met from runs. Persisting run counts is the right route.
- **The engine has per-step counts, but they are not passed to the persistence path.** `TreeWalkResult.stepCounts` covers trunk and tail steps (enabled steps only; `InProcessPipelineEngine.scala:96-104,471`). `PipelineRunExecutor.executeRunSuccess` receives `stepCounts` but passes nothing to `onRunSuccess`/`onUnblockedRunSuccess` (`PipelineRunExecutor.scala:290-296`). It only reaches the response (`:311`).
- **The last-run write path is not "one transaction".** `PipelineRunSucceededWrites.scala:240-246` writes the run row (`writeTerminal`) and then the pipeline row (`writeLastRun`, inside `afterTerminalWin`). These are two separate Futures and two separate DB writes.
- **There are more `last_run_*` writers than the design accounts for:**
  - `PipelineRunSucceededWrites.scala:245`
  - `PipelineRunTerminalWrites.scala:117` (execution failure), `:202` (write-back failure), `:235` (blocked)
  - `PipelineRunService.scala:254`
  - `SparkJobSubmitter.scala:88,112`
  - the reaper's raw SQL at `PipelineRunRepository.scala:404` (`last_run_row_count = NULL`)
  - Dry runs never write `last_run_*` (`onDryRunSuccess`, `PipelineRunTerminalWrites.scala:141-185`).
- **V135 is free.** origin/main ends at `V134__dashboard_folders.sql`, and no worktree has V135-V139.
- **RLS test infrastructure exists** for a non-BYPASSRLS proof: `backend/src/test/scala/com/helio/testsupport/TwoUserRlsApiFixture.scala` and others. MISTAKES.md:154 covers the parity gap.
- **`useIsPhoneShell` in jest:** `useIsPhoneShell.ts:9-11,22-29` returns false when `window.matchMedia` is missing. `src/test/jest.setup.ts` defines no `matchMedia`, so every existing `PipelineDetailPage.*.test.tsx` will render the desktop layout. The D1 hedge resolves to "yes, all page tests migrate".
- **Flush-on-unmount is feasible with `useStepCardPersist`.** Today the hook clears the debounce on unmount (`useStepCardPersist.ts:44-48`). Holding the pending `newConfig`/`captureErrors` in a ref and running the PATCH at unmount is straightforward. Side effects are covered in CR7.
- **The command-bar breadcrumb is rendered in `CommandBar.tsx`, not `App.tsx`.** The visible breadcrumb is `CommandBar.tsx:145-170` (`pickerSelection.activeItemName`). `App.tsx:126-150` only drives the sr-only `<h1>` and `document.title`. The HEL-1575 lane's plan (its `proposal.md:26`, `design.md:114`, task 6.1) edits that same breadcrumb block in `CommandBar.tsx` to hide the dashboard name.
- **The Outputs gallery is mounted only on the Outputs tab** (`PipelineDetailPage.tsx:282`, `activeTab === "steps" ? ...`). Each `OutputGalleryCard` fetches `listOutputPanels` in an effect (`OutputGalleryCard.tsx:50-61`). The binding requirement "Pipeline detail boot requests are bounded" (`openspec/specs/pipeline-editor-page/spec.md:393-405`) allows at most one GET of the same resource per page open, including under StrictMode.
- **The footer has affordances the design does not mention** (`PipelineDetailFooter.tsx`):
  - the persisted last-run `StatusChip` "Succeeded"/"Failed" (`:131-135`)
  - the "N steps" stat (`:209-214`), whose tests are `PipelineDetailPage.stepsError.test.tsx:178-209` (no "0 steps" while steps are unknown; "2 steps" after)
  - the `role=alert` "Save error" (`:248-255`)
- **Insert semantics:** `handleInsertStep(opType, index)` (`usePipelineStepCreation.ts:144-166`) takes a flat `stepsRef` index, resolves the anchor from root 0's trunk (`computeInsertAnchor`), and always creates drafts with `rootId: roots[0]`. Today's "Insert step here" gaps exist only on root 0's trunk (`PipelineRiverView.tsx:264-288`).
- **Truncation spec:** `pipeline-run-truncation-reporting` "A persisted row count is never displayed without its truncation context" (`openspec/specs/pipeline-run-truncation-reporting/spec.md:228-245`) applies to every surface that shows a persisted row count.
- **Spec list:** I grepped `openspec/specs/*` for the requirements that task 1.1 lists. Several more specs describe the removed desktop UI (listed in CR9).
- **docs/live-draft-preview.md:** checked the selection, the per-edit PATCH and the counts touchpoints. Nothing in the plan contradicts it: draft mode is not built, and the per-edit PATCH stays (doc :64, :369).

### Verdict: REFUTE

The overall shape is sound, follows the rulings, and is mostly well grounded. But several decisions are deferred, misplaced or missing in ways an executor would have to guess at. A wrong guess either breaks a binding spec or hits another lane's file.

### Change Requests

1. **Make D9's persistence semantics a decision now, not "documented in the PR".**
   - In design.md, list every `last_run_*` writer named above and say what happens to `pipeline_runs.step_row_counts` and `pipelines.last_run_step_row_counts` on each path. Cover succeeded, execution-failed, write-back-failed, blocked, `PipelineRunService.scala:254`, both Spark paths and the reaper SQL at `PipelineRunRepository.scala:404`. Skipping the reaper would leave stale counts next to a `failed` status.
   - State the user-visible result. If you mirror `last_run_row_count`, a failed latest run blanks every spine count to "—" on reload. That is acceptable under the AC's "latest run", but say so explicitly.
   - Fix the "same transaction" wording in design D9 and in the `pipeline-run-step-row-counts-persistence` spec. It should read "in the same statement as `row_count` (run row) / `last_run_row_count` (pipeline row)", or an equivalent that matches the two-write reality.
   - Add a task for passing `stepCounts` through `onRunSuccess` → `onUnblockedRunSuccess` → `writeTerminal`/`updateRunTerminal(Internal)` and `writeLastRun`/`updateLastRun(Internal)` (`PipelineRunExecutor.scala:290-296`).

2. **Persisted per-step counts need truncation context.** The spine's persisted counts are persisted row counts, so the truncation-reporting requirement covers them. When `lastRunTruncated === true` and a count comes from the persisted run (not an in-session run), the spine must mark it as partial without relying on colour alone, for example with `TruncatedRowCountBadge` or an equivalent marker. Add this to D5 and the spine spec, plus a unit test. Also cover the in-session case if the run result's `sourceTruncated` is true.

3. **Account for the boot-request bound.** The spine's OUTPUTS section moves N `listOutputPanels` GETs onto first paint (today they fire only when the Outputs tab opens). The StepPreviewTable adds a step-preview GET on open. Under StrictMode, naive effects double both, which violates "Pipeline detail boot requests are bounded" (`pipeline-editor-page/spec.md:393`). That requirement also lists "Outputs tab with its count, footer last-run metadata" as first-paint elements that must render unchanged.
   - In design.md, say how both fetches are deduplicated per page open: a single-flight/cache keyed by page open, or a batched placement count.
   - Add that requirement to the task 1.1 MODIFIED list.
   - Name `e2e/hel1392-remount-request-burst.spec.ts` and any request-count unit tests in the migration.

4. **Retarget the command-bar change and settle the HEL-1575 overlap.** The visible breadcrumb is in `CommandBar.tsx:145-170`, not `App.tsx`. HEL-1575 is editing that exact block for the dashboard view, and C6 forbids touching HEL-1575's files.
   - Update D3, task 4.3, C6 and the proposal's Impact list to name `CommandBar.tsx`.
   - Specify the minimal conditional, which must be desktop only (the phone title at `:172-190` must stay unchanged).
   - Record the merge-conflict plan. Ideally use one shared predicate (for example "item name hidden on this route") that both lanes can converge on, not two competing conditionals.

5. **Give a home to the footer affordances the design leaves out:**
   - the persisted last-run status (Succeeded/Failed when there is no in-session run). D3's "run status chip" covers only SSE/redux status. Specify in-session status, else persisted `lastRunStatus`, else hidden.
   - the "N steps" stat, including the stepsError rule that no count shows while steps are unknown (tests `PipelineDetailPage.stepsError.test.tsx:178-209`).
   - the "Save error" alert.

   Each needs a location in D3/D5 and a ledger target. Otherwise "no lost assertions" cannot be met without improvising.

6. **Scope "Insert step before/after".** D5 and the spine spec offer it per row with no scope, but `handleInsertStep` only inserts into root 0's trunk (flat index, `rootId: roots[0]`). Offered on a lane row or a non-primary root's row, it would put the step in the wrong place. Restrict both items to root-0 trunk rows, as today's gaps are, or design lane and other-root insertion explicitly. Also define the index mapping from a spine row to the flat `stepsRef` index that `handleInsertStep` expects. Update the spec's "Per-row actions" sentence to match.

7. **Specify the D7 flush-on-unmount edge cases:**
   - **Scope:** `useStepCardPersist` is shared with the phone `StepCard`, so an unconditional change alters phone behaviour on page leave and card unmount, against C4. Either limit the flush to `variant="focused"`, or accept the phone change explicitly and update C4.
   - **Removal:** when the unmount is caused by removing that step, do not flush a PATCH for a step being deleted.
   - **Errors:** a `captureErrors` editor (cast, enum, fillnull/window/pivot, upsertsource) that gets a 422 from a flushed PATCH would report it into an unmounted card, so the rejection is silently lost. That conflicts with the spec's "SHALL never drop an edit". Specify where that error surfaces, for example a page-level alert or the spine row's validation marker.

8. **Settle AC 5 against native control `accent-color`.** D12 keeps `accent-color: var(--app-accent)` on op-editor checkboxes and radios (`PipelineDetailPage.css:923-926`), citing DESIGN §0. AC 5 says literally that only Run, the selected step and focus rings use the accent, and the brief puts ACs above DESIGN.md.
   - Either neutralise native `accent-color` on the desktop page, or raise the conflict for an owner ruling. Do not decide it unilaterally.
   - D11's audit compares only `background-color`/`border-color`/`color`, so it cannot see `accent-color`, SVG `fill`/`stroke` or `outline`/`box-shadow`. Add those properties. Also scope the audit to the page root (`.pipeline-detail-page`): the shell's active rail item legitimately uses the accent (DESIGN §9) and would otherwise fail it.

9. **Complete the task 1.1 spec reconciliation list.** I confirmed by grep that these binding requirements describe UI this change removes or moves on desktop. They are missing from the list:
   - `pipeline-step-preview`: "StepCard Preview button fetches and renders sample rows" and "The step card preview tray shows the named reason". The named STEP_CONFIG_INVALID reason must render in the StepPreviewTable error state; say so in D8.
   - `pipeline-dry-run-ui`: "Pipeline detail page exposes a 'Dry run' button" (footer wording).
   - `pipeline-step-reorder`: "Pipeline editor supports drag and keyboard reordering of steps" (step-card wording).
   - `pipeline-outputs-rail`: all requirements (no rail on desktop).
   - `pipeline-run-truncation-reporting`: "A persisted row count is never displayed without its truncation context" (the detail-footer wording).
   - `pipeline-lane-run-reporting`: "Row counts render per node across every lane" (on `StepCard`).
   - `pipeline-step-schema-diff`: "StepCard renders the real schema diff as chips".
   - `pipeline-step-lifecycle`: "The editor offers disable/enable and duplicate per step".
   - `pipeline-editor-page`: "Pipeline detail boot requests are bounded" and "A step card cannot be expanded while its create is in flight".
   - `pipeline-edit-flow`: Save/Cancel requirements if their wording names the footer.

   Keep the grep catch-all, but list these now.

### Non-blocking notes

- **D1:** replace the hedge with the fact: jsdom has no `matchMedia`, so `useIsPhoneShell()` is false and every page test hits the desktop layout. For the phone-path test, stub `window.matchMedia` the way `app/shell/useIsPhoneShell.test.tsx` does.
- **D9 RLS proof:** point the executor at the existing non-BYPASSRLS fixtures (`TwoUserRlsApiFixture.scala`) instead of building new ones. Cover both the owner-run path (`updateLastRun`, RLS-enforced) and the editor-run path (`updateLastRunInternal`).
- **Task 5.2:** derive the e2e migration list from a recorded grep, not "at least …". `grep -l "/pipelines/" e2e/*.ts` returns 47 files. The ones most likely to break and missing from the list are `hel1277-output-history-scrubber` (gallery "History for"), `hel910-pipeline-to-dashboard-flow`, `hel909-output-picker-panel-sheet`, `hel1331-history-payloads-toggle` and `hel1392-remount-request-burst`.
- **Source card "Remove source":** this removes a root from the pipeline, not a data-source Delete, so the Delete ruling and DESIGN §9 are not violated. Label it clearly (e.g. "Remove from pipeline") so a final-gate reviewer does not read it as a source delete.
- **D6:** `?step=` and `?outputId=` are written by different hooks. Use the functional `setSearchParams(prev => ...)` form so one write never clobbers the other.
- **D5 disabled steps:** the engine gives disabled steps no `stepCounts` entry, so they always show "—". That is consistent with the "off" marker, but say so explicitly.
- **HEL-1585:** the plan adds the no-scroll guard for this page only. The final report should state the 1440×900 measurement, as task 5.6 already plans.
