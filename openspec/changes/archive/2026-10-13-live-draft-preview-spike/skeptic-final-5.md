## Skeptic Report — final gate (round 5, skeptic-final-5.md)

Reviewed HEAD `4291e5e0c742dccdef8067f8806c425b1168ffba`. The live base from `resolve-review-base.sh` (main/origin) is `5074b69377ea8ce1010739dddcf858448a3a0af5`. The diff touches only `docs/live-draft-preview.md` and this change dir. There is no product code and no UI, so step 4 (UI judgment) does not apply.

The round-4 delta (`532381693..HEAD`) touches §8.3 of the doc, `measurements.md` §6 and the new `prototype/writer-search.sh`.

I judged against the owner's standard: the last `escalation.answered` (`extend-final-gate`, events.jsonl line 55, t=1791953900936). Under it, §8.3 states the guarantees G1-G3 plus an UNVERIFIED candidate; HEL-1581(c) owns the verified protocol and its specs.

### What I verified (with evidence)

**Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/live-draft-preview-spike/HEL-1580`.

**What the fingerprint reads.** I read `PatchSetPipelineDefinition.scala:25-52` and the readers it calls. It reads seven tables:
- `pipeline_steps`, through `listWithRootIdsInternal`;
- `outputs`, through `listByPipelineInternal` and `findConfigsByIdsInternal`;
- `pipeline_schedules`, through `findScheduleDefinitionInternal`;
- `panels.output_id`, through `findIdsByOutputIdsInternal`;
- `alert_rules`, through `findAlertRuleDefinitionsInternal`;
- `pipelines` and `pipeline_roots`, through the summary's name, tag and roots. The roots are ordered by `position` (`PipelineRepository.scala:123`).

**`writer-search.sh` re-run.**
- Command: `bash openspec/changes/live-draft-preview-spike/prototype/writer-search.sh`.
- Hit counts: S1 3, S2 36 files, S3 98 lines, S4 25, S4b 0, S4c 2, S5 11. These match `measurements.md` §6 exactly.
- The script exits 1. That is only the last `grep` in the S5 loop finding nothing in the final file. It is not a failure, and the output is complete.
- The script is read-only: it contains no redirect, `rm`, `mv`, `cp`, `tee`, `sed -i`, `psql`, `curl` or git write.
- Nothing references it: `git grep -e live-draft-preview-spike -e writer-search -- frontend backend scripts package.json .husky` finds nothing.

**Independent searches, not derived from the script.**
1. **Slick aliases.** I found every Slick `Table[...]` class bound to a fingerprinted table name: `PanelTable`, `PipelineTable`, `PipelineStepTable`, `PipelineRootTable`, `PipelineScheduleTable`, `OutputTable`, `AlertRuleTable`. Then I listed every `TableQuery[...]` alias of them across `backend/src/main/scala`:
   - `table`, `panelTable`, `pipelinesTable`, `rootsTable` and `stepsTable`, in 12 files.
   - No `Repository.table`-style cross-file access exists.
   - I grepped those aliases for every write form: `+=`, `++=`, `.update`, `.delete`, `insertOrUpdate`, `forceInsert`. Every hit is a row in G1 or the reconciliation.
   - The self-typed traits that hold the panel writers are `PanelMutationOps`, `DashboardSnapshotOps` and `DashboardContentsOps`; S2 catches them through the `PanelRepository` token. The other self-typed trait, `DashboardFieldWriteOps`, writes `dashboards` only (`:47,53-54`). `PanelLayoutPlacement:55` writes `dashboards.layout`. `PipelineCycleGuard` writes nothing.
2. **Raw SQL across lines.** A Python scan extracted every Scala string literal and interpolation, including multi-line `"""…"""` (`sql`, `sqlu`, `s`). It looked for `INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|MERGE|ON CONFLICT` targets.
   - The only writes to the 7 tables are `OutputRepository.scala:321` (`DELETE FROM panels`) and `PipelineRunRepository.scala:391/403`. The latter is the reaper, which writes only `last_run_*`.
   - `InviteCodeRepository.scala:39` writes `users.tier`.
   - The one `#$` splice (`StoredObjectDeletionRepository.scala:164`) builds a read-only SELECT from constant table names.
3. **Foreign keys across lines.** A Python parser read every migration statement with comments stripped. It covered `CREATE TABLE` and `ALTER TABLE … REFERENCES` and resolved each `ON DELETE` action.
   - The CASCADE parents of the 7 tables are `pipelines`, `pipeline_steps`, `pipeline_roots`, `outputs`, `dashboards` (V2) and `data_sources` (V98:81).
   - `data_types` and `metrics` were dropped in V94:1298/1300.
   - `pipelines.source_data_source_id` was dropped in V98:320.
   - `parent_step_id` has no ON DELETE action (V94:172).
   - Second level: `dashboards → users` has no action. `data_sources → users` is ON DELETE CASCADE (V119:83). But no production code deletes a `users` row: no `DELETE FROM users` and no Slick `.delete` on either `UserTable`. `UserRepository.scala:154` deletes sessions.
   - The cascade-reachable deleters are `DataSourceRepository.delete:279`, `WorkspaceTeardownRepository:155-160`, `DashboardRepository.delete:199`, `DashboardContentsOps.replaceContents:61-67`, and the pipeline, step, root and Output deleters. All of them are in G1. No other Slick `.delete` in `infrastructure/` touches `data_sources` or `dashboards`; I checked all 39 sites.
4. **Functions and triggers.** A Python scan of every `CREATE FUNCTION … $$…$$` body and every `CREATE TRIGGER` found the only writing bodies:
   - `dashboards` updates in V122 and V123;
   - `stored_object_deletions` inserts in V128 and V132.
   None writes a fingerprinted table, which matches S5.
5. **Other source sets.** The only non-test SQL/Scala outside `backend/src/main` is the sbt `project/*.scala` files, the dev/perf scripts under `backend/scripts/` and archived openspec probes. None is a production write path.

**Result: every production write site of a fingerprinted column is in G1 or is excluded with a correct reason.**
- I spot-checked the new citations. Each resolves to the named def or write: `PanelMutationRepository.scala:25/27, 38/75, 88/129-131, 168/170`; `PanelRepository.scala:211, 218, 230, 236, 255/262`; `DashboardSnapshotRepository.scala:22/63, 129/191`; `DashboardContentsOps.scala:51, 61, 66`; `DashboardRepository.scala:199`; `AlertRuleRepository.scala:78, 85/90, 99`.
- The callers are real: `PanelLifecycleWrites.scala:37` calls `insertPlaced`, `:46` calls `delete` and `:54` calls `duplicate`; `PanelPatchApplier.scala:53` calls `replace`.
- Round-4 CR1's acceptance grep passes. `insertPlaced`, `batchUpdate`, `importSnapshot`, `DashboardSnapshotRepository.duplicate` and `replaceContents` all appear in §8.3. The two miscitations are now labelled: `insert` is dead and `configColumnsOf` is a helper.
- The (c) race-spec list in §8.3 and §12(c) now covers every panel writer.

**The UNVERIFIED candidate still covers every writer, class by class.**
- **Panel insert or rebind to one of this pipeline's Outputs.** The insert or `output_id` update takes FK KEY SHARE on the Output. Candidate step 3 (`FOR UPDATE`) conflicts with it. This covers `insertPlaced`, `duplicate`, `insertBatchPlaced`, `batchUpdate`, `replace`, dashboard `duplicate` and `importSnapshot`, and the inserts in `replaceContents`.
- **Panel delete, or a rebind away from a bound panel.** These need the row lock on the bound panel, which step 1 (`lockForDeletion(pipelines=…)`) takes. This covers `PanelRepository.delete`, the dashboard deleters, the `replaceContents` delete, and teardown.
- **Alert rules.** An insert takes key share on the Output (step 3). An update or delete needs the rule's row lock (step 4).
- **Steps, Outputs, roots, the pipeline row and the schedule.** The candidate requires every one of these writers to take the pipeline-row lock (`FOR NO KEY UPDATE`). It also places every `lockForDeletion` caller's pipeline-row lock after that call.
- `compactPositions` (`PipelineRootRepository.scala:155-167`) is the only root writer not in G1. It preserves relative order, so the roots array the fingerprint reads is unchanged. It also runs inside `removeRoot`'s transaction, after `removeAction`, which is listed.

**§12 vs HEL-1581:**
- A whitespace-normalised check finds all 5 ACs of the scratchpad `HEL-1581.md` verbatim in §12 (5/5 True).
- Both open owner questions are present, each with its recommendation first: (1) reload vs force-overwrite on a 409, and (2) the undo stance after a cascading delete.

**§14 vs events.jsonl:**
- Line 1 is `start-now`; it is recorded in the doc header (lines 6-9).
- Items A-F match line 18's `sub_answers` token for token, including the A free-form text.
- C1 and C2 are present in `tasks.md` under Standing Constraints.

**AC2 re-run, once, on my own Chromium, `nice -n 19`.**
- Command: `PLAYWRIGHT_CORE=/home/matt/Development/helio/node_modules/playwright-core nice -n 19 node prototype/measure.cjs`, exit 0.
- Setup: playwright-core 1.55.1 (`…/node_modules/playwright-core/index.js`), `chromium_headless_shell` 140.0.7339.186, Node v22.23.2, one browser.
- `verify.bad=0` at both 1x and 4x, with 179 distinct row counts.
- 1x: filter-drag recompute 0.1 / 0.3 / 0.6 ms (median / p95 / max); recompute + render + sync layout 1.5 / 2.1 / 3.6 ms (expr-edit 1.3 / 1.7 / 3.2).
- 4x: recompute + render 5.3 / 7.9 / 17.0 ms (expr-edit 4.9 / 7.2 / 13.9).
- AC2 (< 50 ms on 1,000 rows) reproduces with a wide margin. The raw JSON is in the session scratchpad (`skeptic-final5-measure.json`), and the numbers are quoted here.

**Format and isolation:**
- `prettier --check` on `docs/live-draft-preview.md` and the change-dir `*.md` prints "All matched files use Prettier code style!".
- `git diff --name-only BASE...HEAD` lists no path outside `docs/live-draft-preview.md` and the change dir.
- The worktree is clean after my runs (`git status --short` is empty).

**Gate-defect check (CON-160):** no report I read rests on mtime ordering. Nothing to record.

### Verdict: CONFIRM

The G1 writer set is complete against four independent searches, including multi-line SQL, Slick aliases, migration FKs and function bodies. The UNVERIFIED candidate covers every writer class. G1-G3 are stated as guarantees, and the protocol is left to HEL-1581(c), as the owner ruled. The rest of the spike also holds: Q1-Q6 are answered with recommendations and rejected alternatives, AC2 reproduces, and §12 and §14 are exact.

### Non-blocking notes

- **`measurements.md` §6, S4b row: the search is vacuous and the wording is false.** It says "none: no FK from `users` into the fingerprinted tables". In fact `panels` (V10:8/12), `pipelines` (V32:21), `alert_rules` (V60:18) and `outputs` (V94:210) all reference `users(id)`, with no ON DELETE action. The S4b grep needs the table name on the same line as `REFERENCES users`, so it can never match these. The search also misses the second-level path `users → data_sources` (CASCADE, V119:83) `→ pipeline_roots`. The conclusion still holds, because no production code deletes a `users` row. Worth correcting the row to say exactly that.
- **`compactPositions` exclusion reason.** The reconciliation says "the fingerprint reads root id and data source only". The roots array is ordered by `position`, so the accurate reason is "order-preserving compaction inside `removeRoot`'s transaction".
- **The alert-evaluator residual in §8.3 can be closed.** No code outside `AlertRuleRepository` (`:79/90/100`) writes `alert_rules`. `AlertEvaluationService` only reads it (`listEnabledByOutputInternal`) and writes `alert_events`.
- **§9's "4x p95 of 67-115 ms across runs" at 50,000 rows** was exceeded again: 152.2 ms in this run, after 172.1 ms in round 4. This is outside AC2, but the range should be widened or stated as unbounded.
- **`prototype/README.md` does not list** `writer-search.sh`, `floor.cjs` or `transport-lab.cjs`.
