## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `cd64409ad828d9024074f907a7ea32800ab71ff3`. The planning artifacts are untracked in the change dir and there is no code diff yet.

### What I verified (with evidence)

**Setup**
- **Spawn guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/pipeline-detail-step-spine/HEL-1579`.
- **Change validates:** `openspec validate pipeline-detail-step-spine --type change` → "Change 'pipeline-detail-step-spine' is valid".

**Owner rulings**
- Re-read `.concertino/runs/HEL-1579/events.jsonl` (main checkout): six events, one `escalation.raised` and one `escalation.answered` (`HEL-1579-1792031374287-ba1634`) carrying the five answers.
- The design follows all five. It also follows the HEL-1574 Delete ruling: D3 says no Delete, D5 renames the source-card action to "Remove from pipeline" (a root removal, not a delete), and C3 restates the ruling.
- `persist-last-run-counts` named "one new jsonb column on pipeline_runs". The design adds a second column, `pipelines.last_run_step_row_counts`, following the `last_run_*` precedent. That extends the ruling without contradicting it.

**Round-1 change requests, re-checked against the tree**
1. **CR1 (D9 writers): resolved.** I re-derived every `last_run_*` and terminal writer:
   - `PipelineRunSucceededWrites.scala:242,245`
   - `PipelineRunTerminalWrites.scala:114/117, 199/202, 232/235`
   - `PipelineRunService.scala:251,254`
   - `SparkJobSubmitter.scala:88/96, 112/116`
   - the reaper CTE at `PipelineRunRepository.scala:404` (it never sets the run row's `row_count`, so NULL there is correct)

   No other writer exists (I grepped `last_run_status`/`lastRunStatus` updates). The "same statement as its sibling" wording now matches `updateLastRun`/`updateLastRunInternal` (`PipelineRepository.scala:540-591`) and `updateRunTerminalInternal` (`PipelineRunRepository.scala:319-330`). The plumbing task 2.2 exists.

   Engine coverage holds: `InProcessPipelineEngine.scala:425-495` records `counts` for every enabled step across all roots and lanes, not only the primary trunk. So lane rows will have counts.
2. **CR2 (truncation context): resolved** in D5 and in the spine spec's "Partial persisted counts are marked" scenario.
3. **CR3 (boot bound):**
   - *D13 is feasible on the ACL claimed.* `listPanels` (`OutputService.scala:252-259`) does an RLS-scoped `outputRepo.findById` (`outputs_select USING helio_can_access_pipeline`, `V94__outputs_model.sql:238-240`) and then the system-context `findByOutputIdInternal`. `panelCountsFor` → `countByOutputIdsInternal` (`PanelRepository.scala:200-209`) is the same system-context scope. `listByPipeline` gates on `requireAccess("pipeline", …)` at any level, the same set `outputs_select` admits. So a grantee sees exactly the counts `listOutputPanels` would show them.
   - `panelCount` already exists as optional in `schemas/outputs/output.schema.json:36` and `types/output.ts:53`.
   - *D8's single-flight is defective.* See Change Request 1.
4. **CR4 (CommandBar): resolved.**
   - The second conditional is `CommandBar.tsx:159-170`. `activeItemName` for pipelines comes from `usePickerSelection.ts:138`, and the heading "Data Pipelines" from `ContextListBody.tsx:20`.
   - HEL-1575's plan (its `design.md:177`, `tasks.md` 6.1, `proposal.md:26`) touches only the first, dashboard conditional and has no code yet (`git status` shows only its change dir). The plans do not conflict: the lanes touch adjacent lines, and D3 states the merge plan.
   - HEL-1575's design.md:63 says "No Flyway migration (V135 stays free)". origin/main ends at V134, and no worktree has V135-V139.
5. **CR5 (footer affordances): resolved.**
   - The persisted Succeeded/Failed chip is in D3. It uses `StatusChip` intents success/error, not accent (`StatusChip.css`).
   - "Save error" is in D3.
   - "N steps", with the loading/failed rule, is in D5.
6. **CR6 (insert scoping): resolved.** I confirmed `computeInsertAnchor` (`state/insertAnchor.ts:17-31`) treats the index as root 0's primary-lane gap index. `renderGap(i)` passes trunk indices (`PipelineRiverView.tsx:356,467`). D5's "i+1 in root 0's trunk lane" matches. See the non-blocking note on the last row.
7. **CR7 (flush-on-unmount): resolved** in D7 and task 3.5. The flush is opt-in for the focused variant only, is skipped on remove, and failures go to page-level `stepSaveErrors`.
8. **CR8 (native `accent-color`): resolved.**
   - D12 neutralises the native `accent-color` sites. They exist at `PipelineDetailPage.css:925,1358`.
   - The AC-over-DESIGN precedence is cited correctly from the brief.
   - D11's audit now covers `accent-color`, `outline-color`, `box-shadow`, SVG `fill`/`stroke` and `background-image`, scoped to `.pipeline-detail-page`.
   - Shared components the new table will reuse carry accent rules (`DataGrid.css:316` pin-toggle pressed, `:616-617` active filter toggle). The audit would catch them if the preview variant renders them.
9. **CR9 (spec list): resolved.** Every requirement from round 1 is now listed in task 1.1.

**Task 5.2 recorded command**
- `grep -l "/pipelines/\|pipeline-detail-page" e2e/*.ts` returns 48 files.
- Every named spec exists: hel1392-remount-request-burst, hel1392-remount-staleness, hel1277, hel910, hel909, hel1331, state-surface-contrast-guard, focus-presence-guard.

**New issue: preview freshness under the revised D7/D8**
- Today's `configFingerprint` is `${stepIndex}:${enabledBits}:${JSON.stringify(step.config)}`. See `useStepCardPreview.ts` (the docstring on `configFingerprint`) and `PipelineRiverView.tsx:249` for `enabledBits`. It does not include upstream steps' config.
- Today the tray resets `lastFetchedFingerprint` to null whenever it deactivates, so every re-open fetches fresh.
- D8 now says "an in-flight **or settled** entry for the same key is reused". Its next clause says "a later selection or config change issues a new one". These contradict each other, and the literal cache rule serves stale rows (Change Request 1).

### Verdict: REFUTE

All nine round-1 change requests are addressed, and I confirmed each against the tree. The CR3 fix introduced one defect into D8 that an executor following the text literally would ship. That defect breaks AC 2 ("selecting a step updates … the preview table") and the spine spec's "Selecting a row SHALL show … the preview of rows after it".

### Change Requests

1. **D8 / task 3.6 / spine spec: make the step preview fresh on every selection, and order it after the flushed save.**
   - **(a) Settled reuse gives stale rows.** Reusing a *settled* single-flight entry keyed by `stepId + configFingerprint` returns stale rows whenever anything upstream changed: an edit to step 1, a reorder within a lane, a source change, or a run's refresh. Example: select step 3, select step 1, edit its filter, re-select step 3. Step 3's key is unchanged, so the cached pre-edit rows are shown. D8 also contradicts itself ("settled entry is reused" vs "a later selection … issues a new one").

     Restrict deduplication to the **in-flight** request only. That alone satisfies StrictMode: the second effect runs while the first GET is still pending. State plainly that every selection change and every relevant config change issues a new GET. A settled cache is fine only if it is invalidated on every step config PATCH, step create/remove/reorder, root change, and run completion, and the design names that invalidation explicitly.
   - **(b) The new GET races the flushed PATCH.** D7 flushes the previously selected step's pending PATCH on unmount. D8 fetches the newly selected step's preview "on selection immediately". "Edit step 1, then click step 2" is now the primary flow, so step 2's GET races step 1's PATCH and can return rows computed with the old step 1 config. Specify that the newly selected step's preview GET waits until any pending or in-flight step-config save has settled, for example with a page-level pending-save promise the table awaits.
   - **Tests to add (task 3.5/3.6):**
     - edit step 1, select step 2 → the step-2 preview GET is issued after step 1's PATCH resolves;
     - select step 3 → select step 1 → edit → re-select step 3 → a second GET for step 3 is issued;
     - StrictMode boot → exactly one GET (already planned).

### Non-blocking notes

- **D9 dry-run row is still conditional.** It reads "whatever `row_count` does … if they do not write …". `insertDryRunInternal` does write `row_count = Some(rowCount)` (`PipelineRunRepository.scala:453-469`), so the spec's "same conditions as the existing row counts" implies counts on the dry-run run row. Task 2.2 plumbs only `onRunSuccess` and does not touch `onDryRunSuccess`/`insertDryRun`/`insertGranteeDryRun`. Pick one: NULL, or plumb it. Nothing reads `pipeline_runs.step_row_counts` in this change, so either is harmless, but write the choice down. Dry runs never write `last_run_*`, so `pipelines.last_run_step_row_counts` is untouched either way.
- **Stale risk line.** The Risks section still says "App.tsx overlap with HEL-1575". D3, C6, task 4.3 and the proposal now correctly say `CommandBar.tsx`. Fix the wording.
- **"Run to update" placement.** The `spine-row-menu` option the owner chose says "'Run to update' stays next to Run". D3 puts it in the strip under the header. That matches today's structure, where it sits in the denial block above the footer row and not inside it. Place it right-aligned under Run, so the ruling's adjacency holds visibly, and mention it in the PR's UI decisions.
- **Last-row "Insert step after" is a new insertion point.** Today there is no gap after the last trunk step (`PipelineRiverView.tsx:467`, `idx < primarySteps.length - 1`). With lanes or other roots present, `handleInsertStep(op, n)` is not an append (`isAppend` compares against the flat `stepsRef` length). It resolves to `parentStepId = <last trunk step>`. Cover it with a test on a branched pipeline, or route the last row's "Insert step after" to `handleAddStep`.
- **Grep scope.** `grep -l … e2e/*.ts` misses `e2e/support/remountBurstSeed.ts`, which also matches. It is a helper, but the burst spec depends on it, so list it in the triage.
- **Accent class scope.** D12 says "under the desktop page root". If phone and desktop share `.pipeline-detail-page`, scope the `accent-color` override to `.pipeline-detail-page--spine` so C4 (phone unchanged) holds. The D11 audit scope is fine as written.
