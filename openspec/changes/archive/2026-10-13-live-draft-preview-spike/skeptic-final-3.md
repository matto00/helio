## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD `24c2583b95abb417fda083f06f2f9b3bdffc8524`. Live base from `resolve-review-base.sh` (main/origin) is `5074b69377ea8ce1010739dddcf858448a3a0af5`; the diff is 29 files, all under `docs/` or this change dir, so there is no UI to judge. Round-2 delta (`39707e4c1..24c2583b9`): `docs/live-draft-preview.md` §6.3, §8.3, §11 and §12(c)/(d), plus `skeptic-final-2.md`.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/live-draft-preview-spike/HEL-1580`.
- **AC2 re-run** (own playwright-core 1.55.1 Chromium `chromium_headless_shell` 140.0.7339.186, Node v22.23.2, `PLAYWRIGHT_CORE=/home/matt/Development/helio/node_modules/playwright-core nice -n 19 node prototype/measure.cjs`, exit 0, one browser):
  - correctness: `verify.bad=0` at both 1x and 4x, 179 distinct row counts;
  - 1x: recompute filter drag 0.1 / 0.2 / 0.3 ms (median/p95/max); recompute + render + sync layout 1.3 / 1.9 / 4.4 ms;
  - 4x throttle: recompute 0.5 / 1.1 / 1.8 ms; recompute + render 4.0 / 5.8 / 9.5 ms; 50k-row scaling median 42 ms, p95 114.9 ms.
  - **AC2 reproduces** and matches §9 within noise. The JSON is at the scratchpad path `skeptic-final3-measure.json` (outside the git tree, so not persisted); the numbers are quoted here.
- **Prototype isolation:** `git grep -l live-draft-preview-spike -- frontend backend` returns 0 files. A plain `grep -r` hits 1,223 files, all in the untracked build caches `frontend/.jest-cache` and `backend/target`, which embed the worktree path.
- **§12 vs HEL-1581:** a script check confirms that all 5 quoted ACs appear verbatim in the scratchpad `HEL-1581.md` (whitespace-normalised): 5/5 True. §12 keeps the two open owner questions, (1) force-overwrite on 409 and (2) the undo stance, each with the recommendation first. The description is not edited.
- **§14 vs events.jsonl:** the A–F tokens in §14 match line 18 `sub_answers` exactly, including the free-form A text. The line-1 `start-now` ruling is recorded at doc line 9. C2 in `tasks.md` agrees.
- **§6.3 `confineScopedToken`:** now named, along with auth and CSRF, and the path-exemption option is preferred. This closes my round-2 non-blocking note.
- **§8.3 coverage of the round-2 CR (panel/alert writers): addressed in substance.** Lock 2 names `PanelRepository.insert/delete/replace`, the `output_id` batch patch and `AlertRuleRepository.insert/update/delete`. FOR UPDATE on the Output row against FK KEY SHARE is the right PostgreSQL mechanism, and both FKs exist: `PatchSetPipelineDefinition.scala:14-15` cites V94 cascades on `panels.output_id` and `alert_rules.target_output_id`.
- **§8.3 lock ordering: checked against the tree, and it fails.** See CR1; it was reproduced twice in a throwaway PostgreSQL 18.4 cluster.
- **§8.3 writer set: checked against the FK cascades, and it is incomplete.** See CR2.

### Verdict: REFUTE

The delivered spike is strong:
- Q1–Q6 are answered with recommendations and rejected alternatives.
- AC2 reproduces with about 10x headroom.
- The rulings and the verbatim HEL-1581 walk are correct.

But §8.3 is the lock design HEL-1581(c) is told to build verbatim, and as written it has two problems:
- It prescribes an acquisition order that inverts the repo's binding, documented system-wide lock order. That reopens the exact 40P01 deadlock that HEL-1498/HEL-1534 closed.
- It still asserts atomicity against "every writer of the pipeline-owned tables" while missing a cascading writer.

Both are specific, tree-grounded and cheap to fix in prose.

### Change Requests

1. **§8.3 Lock 2 order inverts the tree's mandatory lock order and deadlocks with panel create.**
   - **What the doc says:** `docs/live-draft-preview.md` §8.3 (the "Lock 2" paragraph and the "Acquisition order is fixed (pipeline row, Outputs, panels, alert rules…)" bullet, about lines 424-440) and §12(c) (lines 643-646, "in a fixed order") prescribe:
     1. pipeline row `FOR UPDATE`;
     2. Output rows `FOR UPDATE`;
     3. *then* `PanelRowLocks.lockForDeletion`.
   - **What the tree requires:**
     - `PanelRowLocks.scala:11-17,19-21` states the system-wide order: "panel rows by id, then dashboard rows by id, then Output (and pipeline / step / root / source) rows".
     - It also says `lockForDeletion` "MUST" be called "as its first write, before anything else that locks or writes", with "exactly ONE call per transaction".
     - V130 (`V130__lock_dashboards_for_output_deletion.sql` header) makes `hel1498_lock_panels` also lock the panels' dashboards, precisely because a panel create locks dashboard D `FOR UPDATE` (`PanelLayoutPlacement.scala:29-33,47`) and only then takes KEY SHARE on Output O.
   - **The deadlock:** the doc's save holds O and then wants D, so it deadlocks with any panel create on a dashboard that already shows one of the pipeline's Outputs.
   - **Reproduced (stable, 2/2 runs each), in a throwaway `initdb` cluster with tables shaped `pipelines/outputs/dashboards/panels` (FKs as in the tree):**
     - Tx A is a panel create: `SELECT … dashboards WHERE id='D' FOR UPDATE; pg_sleep(1); INSERT INTO panels VALUES ('p2','D','O')`.
     - Tx B is the doc-order save: pipeline `FOR UPDATE`, outputs `FOR UPDATE`, panels `FOR UPDATE`, then dashboards `FOR UPDATE`.
     - Result: B gets `ERROR: deadlock detected … while locking tuple (0,1) in relation "dashboards"`.
     - With B in tree order (panels, dashboards, pipeline row, outputs), there is no deadlock. A commits first, and B then sees `panels now = 2`, so the new bind surfaces as a fingerprint mismatch (a 409), as intended.
   - **Fix:**
     - State the order as the tree's: one `lockForDeletion(pipelines = Seq(pipelineId))` call as the save's first write. It covers bound panels and their dashboards, under the SECURITY DEFINER bypass needed for other users' panels.
     - Then the pipeline row (Lock 1), then the Output rows by id, then the alert rules by id.
     - Replace "cannot deadlock with itself" with a statement of consistency against panel create and the existing deleters, and cite `PanelRowLocks.scala` and V130.
     - Name the residual the tree already accepts: a panel created after the pre-lock (HEL-1485/HEL-1534).
     - Mirror the order in §12(c).
   - **The rule for writers:** the same ordering applies to Lock 1. Every existing `lockForDeletion` caller must take the pipeline-row lock **after** that call, not "at the start of the transaction" as §8.3 says. The callers are:
     - `OutputRepository.scala:320` and `PipelineRepository.scala:519`;
     - `PipelineStepRepository.scala:1015` and `:1205`;
     - `DataSourceRepository.scala:279` and `WorkspaceTeardownRepository.scala:166`.

     Otherwise an Output delete that holds the pipeline row while waiting on panels can deadlock with a pipeline delete that holds the panels while waiting on the pipeline row. Today the doc only says "the pipeline delete's existing order … must be reconciled", which understates it: the reconciliation applies to every one of these callers.

2. **§8.3 Lock 1 writer table omits the data-source delete cascade, so "atomic with respect to every writer of the pipeline-owned tables" is still not true.**
   - `pipeline_roots.data_source_id … REFERENCES data_sources(id) ON DELETE CASCADE` (`V98__pipeline_roots.sql:81`; V99 header: deleting a DataSource deletes "only THAT ROOT", and through it that root's steps, Outputs and their panels).
   - `DataSourceRepository.delete` (`DataSourceRepository.scala:271-282`) does this, and it is a writer of `roots`, `steps` and `outputs`, all of which the fingerprint reads. It does not appear in the table.
   - **The race:** a source deleted in another tab between the save's fingerprint read and its writes removes a root and its subtree. The save's writes then hit deleted rows, and the journaled prior definition no longer matches what was replaced.
   - **Fix:** add `DataSourceRepository.delete` to the Lock 1 table. It must take the pipeline-row lock of every pipeline with a root on the source, in pipeline-id order, after its `lockForDeletion` call per CR1. Also add `WorkspaceTeardownRepository` (`:166`, which deletes the pipelines whole, so it only needs a mention). Then re-check the "honest guarantee" sentence.

### Non-blocking notes

- **Lock 1 strength:** `PipelineRunRepository.scala:347` locks the pipeline row `FOR KEY SHARE` on run submit, and so does every child-FK insert (runs, steps, roots). A `FOR UPDATE` Lock 1 conflicts with all of those and serializes every step edit against run inserts. `FOR NO KEY UPDATE` excludes the other Lock 1 holders equally and does not block KEY SHARE. Worth naming for the implementer.
- **Alert-rule `FOR UPDATE` by the save:** if the alert evaluator updates rule state rows (for example last-fired) in transactions that also lock other rows, its order should be checked against the save's. I did not enumerate the evaluator's writes.
- **Gate-defect check:** no report I drilled into rests on mtime ordering. Nothing to record.
