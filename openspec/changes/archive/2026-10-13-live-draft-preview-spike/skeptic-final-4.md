## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Reviewed HEAD `53238169379585acf298ee2d147292c14319cda1`. The live base from `resolve-review-base.sh` (main/origin) is `5074b69377ea8ce1010739dddcf858448a3a0af5`. The diff touches only `docs/live-draft-preview.md` and this change dir: there is no product code and no UI to judge. The round-3 delta (`24c2583b9..HEAD`) touches §8.3, §12 item 3 "Concurrency" and §12(c), plus `skeptic-final-3.md`.

I judged this round against the owner's reframed standard: the line-47 `extend-final-gate` answer to the escalation at events.jsonl line 45, which recommends "guarantees + a candidate lock protocol whose verified form … is owned by HEL-1581(c)". I did not judge it against a demand for a verified protocol.

### What I verified (with evidence)

**Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/live-draft-preview-spike/HEL-1580`.

**AC2 re-run, once, on my own Chromium.**
- Setup: playwright-core 1.55.1 (`/home/matt/Development/helio/node_modules/playwright-core/index.js`) launching its own `chromium_headless_shell` 140.0.7339.186, Node v22.23.2.
- Command: `PLAYWRIGHT_CORE=… nice -n 19 node prototype/measure.cjs`, exit 0, one browser.
- Results:
  - `verify.bad=0` at both 1x and 4x.
  - 1x: filter-drag recompute 0.1 / 0.3 / 0.4 ms (median / p95 / max); recompute + render + sync layout 1.2 / 1.7 / 2.2 ms (expr-edit 1.0 / 1.4 / 1.8).
  - 4x: recompute + render 5.8 / 10.9 / 23.6 ms (expr-edit 5.6 / 9.7 / 22.7).
- AC2 (< 50 ms) reproduces with wide margin. The JSON is in the scratchpad (`skeptic-final4-measure.json`); the numbers are quoted here.

**Prototype isolation:**
- `git grep -l live-draft-preview-spike -- frontend backend` finds 0 files.
- No file outside `docs/live-draft-preview.md` and the change dir is changed vs the base.

**§12 vs HEL-1581:** a whitespace-normalised script check finds all 5 ACs of the scratchpad `HEL-1581.md` verbatim in §12 (5/5 True). Both open owner questions are still there, each with its recommendation first: (1) force-overwrite on a 409, and (2) the undo stance.

**§14 vs events.jsonl:**
- Items A–F match line 18 `sub_answers` token for token, including the A free-form text.
- The line-1 `start-now` ruling is recorded in the doc header (lines 7-9).
- C1 and C2 are present in `tasks.md` as Standing Constraints.

**Round-3 CR1 (lock order), handled under the reframing.**
- §8.3's candidate is headed "UNVERIFIED candidate protocol". It puts `lockForDeletion(pipelines = Seq(pipelineId))` first, then the pipeline row, then the Outputs, then the alert rules.
- That is consistent with `PanelRowLocks.scala:11-21`: panels, then dashboards, then Output/pipeline/step/root/source rows; `lockForDeletion` is the first write and is called exactly once. I read the file myself and the citation is accurate.
- The `lockForDeletion(pipelines=…)` signature exists (`PanelRowLocks.scala:39-46`).
- The eight `lockForDeletion` callers the doc lists match `grep` exactly.
- §12 item 3 and §12(c) now defer the verified protocol and its race, deadlock and RLS specs to HEL-1581(c).

**Round-3 CR2 (source-delete cascade), handled.**
- `DataSourceRepository.delete` (`:271-282`, `lockForDeletion` at `:279`) and `WorkspaceTeardownRepository.scala:166` are both in G1.
- The FK cascade citations check out: `V98__pipeline_roots.sql:81`, V94 `:344` and `:391`.

**Round-3 non-blocking notes:** `FOR NO KEY UPDATE` is now named. The unenumerated alert-evaluator writes are named as a residual.

**No sentence still asserts an unproven protocol as proven.**
- §8.3 opens with "The locking protocol that achieves it is **not proven here**".
- §12 says "the protocol is unverified".
- The only remaining factual claims are PostgreSQL's documented row-lock and serializable semantics, and the deadlock reproduction attributed to review.

**Pipeline-owned writer citations, spot-checked against the tree.** Every cited line resolves to the named `def`:
- `PipelineStepRepository`: :124, :252, :278, :391, :410, :487, :572, :638, :665, :762, :776, :817, :866, :994, :1200;
- `OutputRepository`: :216, :238, :273, :282, :318;
- `PipelineRootRepository`: :78, :137, :150;
- `PipelineRepository`: :311, :340, :431, :511;
- `PipelineScheduleRepository`: :73, :79, :96.

A grep of Slick `+=`/`++=`/`.update`/`.delete`/`insertOrUpdate` and raw SQL found no other writer of `pipeline_steps`, `outputs`, `pipeline_roots`, `pipeline_schedules` or `pipelines` fingerprinted columns. The `PipelineRunRepository.scala:403` reaper writes only `last_run_*`. These five tables are complete.

**The bound-panel row of G1 is NOT complete, and two of its citations are wrong.** See CR1.
- The fingerprint reads `panelRepo.findIdsByOutputIdsInternal(outputIds)` (`PatchSetPipelineDefinition.scala:33`). So any write that adds, removes or rebinds a panel's `output_id` is a writer of fingerprinted state.
- `grep -n -E "PanelMutation|insertPlaced|insertBatchPlaced|batchUpdate|DashboardSnapshot|importSnapshot|replaceContents" docs/live-draft-preview.md` returns **0 hits**.

### Verdict: REFUTE

On the owner's own question 1 ("is its writer enumeration complete against the tree?"), the answer is no:
- G1 presents its table as "The writers in the tree, by table".
- Its `panels.output_id` row cites a create method with no production callers. It misses the real create path, the real batch "Swap output" writer, panel duplicate, batch create, dashboard duplicate and dashboard import.

The rest of the spike stands on its merits:
- Q1–Q6 are answered with recommendations and rejected alternatives.
- AC2 reproduces.
- §12 and §14 are correct.
- The round-3 defects are handled under the reframing.
- The guarantees and the UNVERIFIED candidate are stated correctly and consistently with the tree.

The fix is prose only. The candidate mechanism already covers these writers as a class: every one inserts or updates `panels.output_id`, so it takes the FK KEY SHARE on the Output that candidate step 3 blocks. No protocol change is needed.

### Change Requests

1. **Complete and correct the `bound panels (panels.output_id)` row of the G1 table (`docs/live-draft-preview.md` §8.3, the table row starting "bound panels").**

   Fix the two miscitations:
   - `PanelRepository.insert` (`PanelRepository.scala:211`) has **no production caller**: the only hits for `panelRepo.insert` are scaladoc comments in `PanelCreateBuilder.scala:26`, `PanelBindingChecks.scala:37` and `PanelServiceHelpers.scala:168`. Mark it dead, the way the doc already does for `PipelineStepRepository.update`/`insertRootStep`.
   - `PanelRepository.scala:309-338` is the `configColumnsOf` tuple helper and its scaladoc, not a writer.

   Add the missing production writers, each of which binds or rebinds a panel to an Output:
   - `PanelMutationOps.insertPlaced` (`PanelMutationRepository.scala:25-31`). This is the actual single-panel create, via `PanelLifecycleWrites.scala:37`, and the one that locks the dashboard through `PanelLayoutPlacement`.
   - `PanelMutationOps.duplicate` (`:38`, via `PanelLifecycleWrites.scala:54`). It copies an output-bound panel.
   - `PanelMutationOps.batchUpdate` config patch (`:120-133`, which writes `configColumnsOf` including `output_id`, via `PanelBatchWrites.scala:51`). This is the real batch "Swap output" path, and it locks panel rows `FOR UPDATE` in id order first (`:141`).
   - `PanelMutationOps.insertBatchPlaced` (`:168-177`), the batch create.
   - `DashboardSnapshotRepository.duplicate` (`:63-64`) and `importSnapshot` (`:191-192`). Both insert `OutputPanel` rows carrying `output_id` (import builds them at `:59` via `PanelConfigCodec.OutputCreate`).
   - `DashboardContentsOps.replaceContents` (`:66-67`). It is listed today only as a "dashboard deleter", but it also **inserts** new bound panels.
   - Keep `PanelRepository.replace` (`:255`, via `PanelPatchApplier.scala:53`).

   Mirror the new writer classes in the HEL-1581(c) race-spec list in §8.3 ("What HEL-1581 (c) owns") and §12(c): at minimum dashboard duplicate, dashboard import/replace-contents and panel duplicate, alongside "new panel bind" and "Swap output".

   Acceptance: a grep of the doc for `insertPlaced`, `batchUpdate`, `importSnapshot`, `DashboardSnapshotRepository.duplicate` and `replaceContents` hits §8.3, and no G1 citation points at a non-writer or an uncalled method without saying so.

### Non-blocking notes

- §8.3 "Lock strength" cites `PipelineRunRepository.scala:343-349` as taking the pipeline row `FOR KEY SHARE` "on every run submit". Those lines are the HEL-1518 guard composed into a node's **snapshot** transaction. The claim still holds through the `pipeline_runs` FK insert, but the citation describes the wrong site.
- §8.3's race-spec list says "alert-rule insert/update/retarget". `AlertRuleRepository.update` (`:85-90`) does not write `target_output_id`, so there is no retarget writer today.
- The HEL-1534 residual drops the tree's own consequence: "a second create on it can still deadlock" (`PanelRowLocks.scala:25-26`). Worth carrying, because G2 is "no deadlock".
- §9's "50,000 rows … 4x p95 up to 114 ms" was exceeded in my run (4x p95 172.1 ms, median 82.4 ms). This is outside AC2, which is for 1,000 rows, but "up to" reads as a bound.
- Gate-defect check: no report I drilled into rests on mtime ordering. Nothing to record.
