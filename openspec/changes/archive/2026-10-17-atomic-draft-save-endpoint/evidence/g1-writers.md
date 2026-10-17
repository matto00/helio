# HEL-1629 Phase A: G1 writers, lock participants and probe results (task 1.1-1.3)

Written BEFORE any lock was added to an existing writer. Tree: main `29cb0a60f`. Pools: `app` = non-BYPASSRLS pool under
`withUserContext`; `priv` = BYPASSRLS `helio_privileged` pool under `withSystemContext`.

Lock numbering used below (the verified order is at the end):
(0) `data_sources` row, (1) `lockForDeletion` = panels then their dashboards (V129/V130), (2) the cycle advisory lock
(`PipelineCycleValidator.AdvisoryLockKey`), (3) the `pipelines` row `FOR NO KEY UPDATE`, (5) the pipeline's `outputs` rows
`FOR UPDATE`, (4) the `alert_rules` rows targeting them `FOR UPDATE`.

How enumerated: `grep -rnE "lockForDeletion|FOR UPDATE|FOR NO KEY|FOR KEY SHARE|advisory|forUpdate"` over `backend/src/main`,
then every `pipelines`/`pipeline_steps`/`outputs`/`pipeline_roots`/`pipeline_schedules`/`panels`/`alert_rules`/`data_sources`
write read in full. FK shape from the migrations: `pipeline_steps.pipeline_id -> pipelines` (V23, CASCADE),
`pipeline_steps.parent_step_id -> pipeline_steps` (V94:172, NO ACTION), `pipeline_roots.pipeline_id -> pipelines` and
`.data_source_id -> data_sources` (V98:80-81, CASCADE), `pipeline_steps.root_id`/`outputs.root_id -> pipeline_roots` (V98:119/145),
`outputs.pipeline_id -> pipelines`, `outputs.node_step_id -> pipeline_steps` (V94:208-209), `panels.output_id -> outputs` (V94:344),
`alert_rules.target_output_id -> outputs` (V94:391), `alert_events.alert_rule_id -> alert_rules` (V61:26) and
`.target_output_id -> outputs` (V94:394), `output_snapshot_history.output_id -> outputs` (V115:24),
`pipeline_schedules.pipeline_id -> pipelines` (V62:25), `pipeline_runs.pipeline_id -> pipelines` (V24:3),
`dataset_rows.data_source_id -> data_sources` (V106:32). Child-row inserts take `FOR KEY SHARE` on the parent, which
`FOR NO KEY UPDATE` does NOT conflict with, so (3) alone does not exclude a child insert.

## Table A. Writers of fingerprinted state (task 1.1 (i))

"Excluded by" is the PREDICTION this table makes; the race spec in the last column is what proves or refutes it (red
recorded writer-first in `red-green-log.md`). `raced-delete` = what the writer does when a racer deleted the pipeline.
Race-spec column: `R-<name>` is the `DraftSaveRaceSpec` block of that writer (the block title names the repository method); the set
writers are in `DraftSaveSetRaceSpec`; the lock-order arguments are `DraftSaveDeadlockSpec`.

| # | Writer (file:line) | pool | lock sequence today | Excluded vs the save by | raced-delete | race spec |
|---|---|---|---|---|---|---|
| W01 | `PanelMutationOps.insertPlaced` PanelMutationRepository:25 (panel create) | app (caller) | dashboard `FOR UPDATE` (PanelLayoutPlacement:47), INSERT (key-share on Output) | (5): key-share on Output O conflicts with save `FOR UPDATE` O | n/a (FK error = clean) | R-panel-insertPlaced |
| W02 | `duplicate` :38 | priv | dashboard `FOR UPDATE`, INSERT | (5) | n/a | R-panel-duplicate |
| W03 | `batchUpdate` :88 (output swap via config) | priv | panels `FOR UPDATE` by id (:145), UPDATE `output_id` (key-share on new Output) | (1) old panel row, (5) new Output | n/a | R-panel-batchUpdate |
| W04 | `insertBatchPlaced` :168 | priv | dashboard `FOR UPDATE`, INSERTs | (5) | n/a | R-panel-insertBatchPlaced |
| W05 | `PanelRepository.replace` :267 (single-panel swap) | priv | UPDATE panel row (key-share on new Output) | (1), (5) | n/a | R-panel-replace |
| W06 | `PanelRepository.delete` :230 | priv | DELETE panel, UPDATE dashboard | (1): save locks every bound panel row | n/a | R-panel-delete |
| W07 | `DashboardSnapshotRepository.duplicate` :22 | priv | INSERT dashboard, INSERT panels | (5) | n/a | R-dashboard-duplicate |
| W08 | `importSnapshot` :129 | priv | INSERT dashboard, INSERT panels | (5) | n/a | R-dashboard-import |
| W09 | `DashboardContentsOps.replaceContents` :51 | priv | `lockForDeletion(dashboards)` (:61), dashboard `FOR UPDATE`, DELETE/INSERT panels | (1) shared dashboard/panels, (5) | n/a | R-dashboard-replaceContents |
| W10 | `DashboardRepository.delete` :197 | priv | `lockForDeletion(dashboards)`, DELETE dashboard | (1) | n/a | R-dashboard-delete |
| W11 | `AlertRuleRepository.insert` :78 | app (rule owner) | INSERT (key-share Output) | (5) | n/a | R-alert-insert |
| W12 | `update` :85 | app | UPDATE rule row | (4) | n/a | R-alert-update |
| W13 | `delete` :99 | app | DELETE rule row | (4) | n/a | R-alert-delete |
| W14 | `OutputRepository.updateOwned` :282 | app (Output owner) | UPDATE output row | (5) | `None` | R-output-update |
| W15 | `deleteWithPanelsInternal` :318 | priv | `lockForDeletion(outputs)` (:320), DELETE panels, DELETE output (cascades rules) | (5) on the Output row; **deadlocks with the amended (4)-then-(5) save unless it takes (3) first** | not-found | `DraftSaveRaceSpec` "Output delete (OutputRepository.deleteWithPanelsInternal)": excluded by its own (3) AND the save's (4), the control removes both; (3) after (1) itself is the G2 amendment A5 (`DraftSaveDeadlockSpec` "Output delete") |
| W16 | `PipelineRepository.updateName` :312 | app (owner) | UPDATE pipeline row (NO KEY UPDATE) | (3) | `None` | R-pipeline-rename |
| W17 | `PipelineRepository.delete` :512 | app (owner) | `lockForDeletion(pipelines)` (:520), DELETE pipeline (`FOR UPDATE`) | (3) | `false` | R-pipeline-delete |
| W20 | `updateInternal` :487 (step PATCH) | priv | plain read, [advisory], UPDATE step | **none: needs (3)** | not-found | R-step-update |
| W21 | `insertInternal`/`Action` :391/:410 (no production caller outside create/undo) | priv | [advisory], INSERT (key-share pipeline) | none: needs (3) | FK error | R-step-insert |
| W22 | `insertAtInternal` :572 (no production caller) | priv | INSERT + UPDATE siblings | none: needs (3) | FK error | R-step-insertAt |
| W23 | `spliceInsertAtInternal`/`spliceInsertReportingInternal` :638/:665 (duplicate step, add step) | priv | [advisory], INSERT, UPDATE children | none: needs (3) | FK error | R-step-splice |
| W24 | `attachTailInternal` :762/:776 (add step as tail) | priv | [advisory], INSERT | none: needs (3) | FK error | R-step-attach |
| W25 | `reorderInternal` :817 (no production caller) | priv | UPDATE siblings | none: needs (3) | no-op | R-step-reorder |
| W26 | `reorderTrunkInternal` :866 (PUT steps/order) | priv | UPDATE trunk rows | none: needs (3) | `Left` | R-step-reorderTrunk |
| W27 | `deleteInternal` :994 (DELETE step) | priv | `lockForDeletion(steps)` (:1015), UPDATE head child, DELETE tails, DELETE step (cascades Outputs, rules) | none: needs (3) after (1) | `None` | R-step-delete |
| W28 | `OutputRepository.insertInternal`/`Action` :216/:238 (Output create) | priv | INSERT (key-share pipeline, step) | none: needs (3) | FK error | R-output-create |
| W29 | `PipelineRootRepository.add` :78 (root add) | app (caller) | name read, advisory (checkAddReadAction), INSERT root (key-share pipeline AND source) | none: needs (3); source key-share explicit before (2) (H') | FK error | `DraftSaveRaceSpec` "root add" (owner). **As an editor no race exists**: RLS `pipeline_roots_insert` is owner-only, so an editor's `POST /roots` answers 500 and writes nothing (pre-existing defect); pinned in `DraftSaveRlsSpec` |
| W30 | `removeRootCascadeAction` :1200 + `PipelineRootRepository.removeAction` :150 + `compactPositions` (PipelineRootWrites:212) | app (caller, `runTransactionally`) | `lockForDeletion(roots)` (:1205), DELETE node_snapshots, DELETE steps, DELETE root, UPDATE positions | none: needs (3) after (1) | no-op | `DraftSaveRaceSpec` "root remove" (owner). **As an editor no race exists**: `pipeline_steps_owner` / `pipeline_roots_delete` hide the rows, so an editor's `DELETE /roots/:id` answers 200 and removes nothing (pre-existing silent no-op); pinned in `DraftSaveRlsSpec` |
| W31 | `PipelineScheduleRepository.upsert` :105 | app (owner) | INSERT/UPDATE schedule (key-share pipeline) | none: needs (3) | FK error | R-schedule-upsert |
| W32 | `delete` :111 | app (owner) | DELETE schedule | none: needs (3) | `false` | R-schedule-delete |
| W33 | `rewriteUpsertTargetAction` :124 (run write-back; rewrites a step's config) | app (owner, `applyWriteBacks` :495) | step `FOR UPDATE` (:135), re-read, dataset insert (source key-share), cycle advisory (:146), UPDATE step | **needs (3); order today step-then-advisory deadlocks with an advisory-holding save (probe a)** | `Left` | R-rewriteUpsertTarget |
| W34 | `DataSourceRepository.delete` :274 (cascades roots, steps, Outputs) | app (source owner) | `lockForDeletion(dataSources)` (:280), DELETE source | none; set-reading: needs (0) then (3) over the rooted set (H') | `false` | R3-source-delete |
| W35 | `WorkspaceTeardownRepository.planAndExecute` :132 (tagged sources, pipelines, dashboards) | app (owner) | `lockForDeletion(dashboards, pipelines, dataSources)` (:166), DELETE pipelines, DELETE sources, DELETE dashboards | pipelines: (3) via DELETE; sources: set-reading like W34 | no-op | R3-teardown |
| W36 | patch-set apply/undo, step/Output/root services, proposal and MCP paths | n/a | call W01-W35 | covered through the repository methods | | (none: no direct writes) |

Not writers of fingerprinted state (checked): `PipelineRepository.updateLastRun*` :541/:579, `updateLastSourceSchema*`
:605/:618, `PipelineScheduleRepository.updateAfterTickInternal` :128, `OutputRepository.updateSchemaInternal` :273
(writes `schema`, not in `OutputKeys`), run inserts (`pipeline_runs`), node snapshots, history. `PanelRepository.insert` :211,
`insertRootStep` :252 and `update` :278 have no production caller (grep). They ARE G2 participants (Table B).

## Table B. Every transaction taking any of locks (0)-(4) (task 1.1 (ii)), with an order argument or a deadlock-spec place

Verified order O*: (0) source rows, (1) panels, dashboards, (2) advisory, (3) pipeline rows by id, (4) alert rules by id, (5) Outputs
by (position, id). (4) and (5) are swapped relative to the candidate (which had Outputs (4), rules (5)), and (5) is by position, on probe evidence (below).

| Participant (file:line) | pool | lock sequence | Argument (cites the statements) or deadlock-spec place |
|---|---|---|---|
| Save (new) | priv | (1) -> [(2)] -> (3) -> (4) -> (5) | Defines O* |
| Panel create W01 | app | dashboard `FOR UPDATE` (PanelLayoutPlacement:47) then INSERT key-share on Output | D before O: consistent with (1) before (5). Probe 1.2 case H. Deadlock spec: yes (ticket's five) |
| Pipeline delete W17 | app | `lockForDeletion` then DELETE pipeline `FOR UPDATE` | (1) then (3)-conflicting row lock: consistent. Deadlock spec: only inside the repeated mix (`DraftSaveDeadlockSpec` "a concurrent mix"); no dedicated opposite-order control. Order argument otherwise |
| Output delete W15 | priv | (1), DELETE panels, DELETE output, cascade rules | O then rules is O* reversed; made consistent by taking (3) before any Output/rule row; deadlock spec: yes, red without (3) |
| Source delete W34 | app | (0) source `FOR UPDATE`, (1), (3) over the frozen rooted set, DELETE | Probes 1.4 (i). Deadlock spec: yes, incl. root add on the same source |
| Root add W29 | app | key-share source, advisory, (3), INSERT root | (0) share, (2), (3): consistent. Spec: `DraftSaveSetRaceSpec` (three-session race vs source delete, red without the source-row lock); no opposite-order deadlock control in `DraftSaveDeadlockSpec`. Order argument |
| Root remove W30 | app | (1), (3), deletes | consistent. Deadlock spec (cycle 3): `DraftSaveDeadlockSpec` "a root remove against the save", control `RootRemovePanelsFirst` ((3) before (1)) deadlocks, mutation M7 turns it red |
| Teardown W35 | app | today (1) -> DELETE pipelines -> DELETE sources `FOR UPDATE` | **inverts (0)/(1) vs source delete: probe 1.4 (ii) deadlocked.** Fix: lock tagged sources (0) first. Deadlock spec: yes, red without |
| Step delete W26 | priv | (1), (3), then derives everything under (3) | Deadlock spec (cycle 3): `DraftSaveDeadlockSpec` "a step delete against the save", control `StepDeletePanelsFirst` ((3) before (1)) deadlocks, mutation M7 turns it red |
| Other step writers (update, insert, insert-at, splice, attach, reorder, trunk reorder) W20-W25 | priv | [(2)], (3), step rows only | **Order argument only**, no deadlock spec (cycle-1 text claimed one; it did not exist): after (3) they write `pipeline_steps` rows and touch no panel, rule, Output or source row, so they hold nothing that sorts after (3) that the save could also want, and none takes (1) so there is no (1)/(3) edge. The advisory writers take (2) before (3) like the save; their advisory edge is covered by the rewrite control |
| `rewriteUpsertTargetAction` W33 | app | step row, then advisory | **cycle with an advisory-holding save that writes the same step: probe 1.3 (a).** Fix: advisory, (3), step row. Deadlock spec: yes |
| Node-snapshot txn (`PipelineRunSucceededWrites` :80-150; `runGuardAction` PipelineRunRepository:359) | priv | pipeline `FOR KEY SHARE`, run `FOR SHARE`, node_snapshots DELETE/INSERT, history INSERT (key-share Outputs in `listByPipelineInternal` position order, OutputRepository:102-107), then `updateSchemaInternal` per Output in its own txn | **cycles with a save locking Outputs by id: probe 1.3 (d).** Fix: save locks Outputs by (position, id). Deadlock spec: yes, reversed position/id fixture, red under id order |
| Alert evaluator (`AlertEventRepository.upsertFiringInternal`/`resolveInternal`, priv) | priv | INSERT `alert_events`: key-share rule (V61 FK), then key-share Output (V94 FK); UPDATE event rows | **cycles with a save locking Outputs then rules: probe 1.3 (e).** Fix: save locks rules (4) before Outputs (5). Deadlock spec: yes |
| `applyWriteBacks` :495 (ExistingSource branch: `writeExistingDatasetAction` -> `lockSource`) | app | source `FOR UPDATE`, dataset rows insert | no pipeline/Output/rule lock; sources only. A pipeline never writes a source it reads (cycle guard), so no (3)-after-(0) edge against a source delete. Deadlock spec: delete vs write-back on a dataset |
| `lockSource` callers: appendRowsAction :586, appendBuiltRowAction :665, replaceRowsAction :720, patchRow :775, deleteRow :823, updateDatasetSchema :986, persistMigration :1089 | app | one source `FOR UPDATE`, then `dataset_rows` | single-resource holders of (0); consistent with (0)-first. Argument only |
| `dataset_rows` inserts (V106:32) | app | key-share source | conflicts with source delete `FOR UPDATE`: delete waits. Argument only |
| Run admission (`insertRunIfUnderConcurrencyCap`, `keyShareOwnerAction` PipelineRunRepository:250) | priv | pipeline `FOR KEY SHARE`, owner-keyed advisory (`hashtext('pipeline-run-concurrency:'...)`) | key-share never conflicts with (3); the owner-keyed advisory key differs from the cycle key. Argument only |
| Reaper (OrphanedRunReaper), `writeLastRun` | priv/app | UPDATE runs; UPDATE pipelines (NO KEY UPDATE) single statement | holds nothing else while waiting for (3). Argument only |
| HEL-1518 guard | priv | in the node-snapshot txn above | covered by that row |
| Cycle-guard writers (`PipelineCycleGuard` callers: create :341/:432, root add, splice/attach/update) | app/priv | advisory first, then writes | (2) before (3): consistent |
| `PanelRepository.insert` :211, `insertRootStep` :252, `update` :278 | | no production caller | dead; excluded |

Raced-delete handling per writer is in Table A: a single-pipeline writer that locks (3) and finds the count short takes its
current not-found path (or its FK-error path for inserts); a set writer (W34, W35) drops the vanished pipeline and carries on.

## Table C. `data_sources` row lockers (task 1.1 (iii)): see Table B rows "Source delete", "lockSource callers", "dataset_rows inserts",
"Root add", "Teardown", `applyWriteBacks`. Panels-before-source in teardown :166 is the inversion fixed above.

## Probe results (tasks 1.2, 1.3). Postgres 18.4, scratch cluster, real migrations V1-V136

Scripts and raw output beside this file: `probe_1_2.sh/.log.txt`, `probe_1_3.sh/.log.txt`, `probe_1_4.sh/.log.txt`, `probe_1_5.sh/.log.txt`, `fixture.sql`, `lib.sh`.

* **1.2** panel-create (dashboard `FOR UPDATE`, then INSERT bound to an Output) vs the section-8.3 earlier order (pipeline row, Outputs,
  panels, dashboards): `deadlock detected` 3 of 3. Against H order (panels, dashboards first): 0 of 3, create commits, save proceeds.
* **1.3 (a)** `rewriteUpsertTargetAction` order (step row `FOR UPDATE`, then advisory) vs a save holding the advisory then writing the
  same step: `deadlock detected`. With the rewrite taking the advisory first: no deadlock. Amendment A3.
* **1.3 (d)** node-snapshot history inserts in position order (`ob`, `oa`) vs a save locking Outputs by id (`oa`, `ob`): `deadlock detected`.
  Save locking by `(position, id)`: none. Amendment A1.
* **1.3 (e)** alert-event INSERT (key-share rule, then Output) vs save locking Outputs then rules: `deadlock detected`. Rules then Outputs:
  none. Amendment A2.
* **1.4 (i)** root add (explicit source key-share, advisory, pipeline) vs source delete (source `FOR UPDATE`, panels, rooted set, DELETE),
  both orders: no deadlock, the second waits behind the first.
* **1.4 (ii)** teardown panels-first vs source delete source-first: `deadlock detected`. Teardown sources-first: none. Amendment A4.
* **1.5** Output delete of an Output with an alert rule and no bound panel vs a save locking rules then Outputs: without (3) in the
  delete, `deadlock detected`; with the delete taking the pipeline row first: none. Amendment A5.
* Finding (spinoff candidate, not fixed): `DELETE FROM data_sources` of a source whose root-level step still has children fails with
  `pipeline_steps_parent_step_id_fkey` (the root cascade deletes the root-level step but the NO ACTION child FK trips), and a source
  that is a pipeline's last root is refused by `hel913_prevent_zero_root_pipelines`. Source-delete race fixtures therefore use a
  multi-root pipeline whose deleted root carries only a root-bound Output.

## Amendments to the candidate H, each with its probe

| # | Amendment | Cause (probe) |
|---|---|---|
| A1 | (5) Outputs locked by `(position, id)`, not id | 1.3 (d) |
| A2 | (4) alert rules locked before (5) Outputs | 1.3 (e) |
| A3 | `rewriteUpsertTargetAction`: advisory, (3), then the step row | 1.3 (a) |
| A4 | teardown locks tagged sources (0) first | 1.4 (ii) |
| A5 | Output delete takes (3) after (1) (needed by A2: it holds the Output then wants its rules) | 1.5 |

## Table D. Writers that read their targets BEFORE lock (3) (final-gate F1 audit, cycle 3)

The F1 pattern: a write derived from a row read before the pipeline-row lock, applied after waiting behind a save that changed it.

| Writer | Reads before (3) | Verdict |
|---|---|---|
| Step delete `deleteInternal` | the deleted row's parent/root/position, the removal set (needed to choose which panels to lock in (1)) | **CONFIRMED lost update** (skeptic F1, reproduced). Red: `evidence/cycle3/F1-step-delete-red-before-fix.log.txt`. Fix: the row, its existence and the removal set are re-read under (3); the promotion uses the locked row; a locked removal set that exceeds the pre-lock set whose panels were locked rolls the attempt back (nothing written) and retries in a fresh transaction, at most 3 attempts. Specs: `DraftSaveRaceSpec` step delete of a moved step (serial-order oracle) and of a grown subtree (retry path). Mutations: M5 (promote to the pre-lock place) and M6 (no retry) both red |
| Step update `updateInternal` | the step's `pipeline_id` only (immutable) to choose the lock | clean: `updateAction` reads and writes after (3) |
| Step insert / insert-at / splice / attach / reorder / trunk reorder | none: the pipeline id is an argument, the lock is the first statement of the transaction | clean |
| Output delete `deleteWithPanelsInternal` | the Output's `pipeline_id` only (immutable) | clean; the panels it deletes are chosen by the delete statement under (1), not by a stale read |
| Output create | none | clean |
| Root remove `removeRootCascadeAction` | none before (3); the step set under the root is derived AFTER (3). `lockForDeletion(roots)` picks panels before (3) | clean for the write set. Residual (not new): an Output with a bound panel created under the root in the window between (1) and (3) is not panel-locked: the HEL-1485 residual the tree already accepts. NOT confirmed as a lost update, so no fix |
| Root remove, service level (`PipelineRootWrites.removeRoot`) | its refuse-before-delete checks (lane `secondaryInput` references to doomed steps) and the removed-Output count are read in earlier Futures, outside the transaction | pre-existing check-then-act at the service level, not a definition write derived from stale rows. Reported as a spinoff candidate: a save that adds a lane reference to a root's step between the check and the delete leaves a dangling reference |
| Root add | the pipeline name for the cycle check, before (3) | the name feeds only the cycle error message |
| Schedule upsert/delete | none | clean |
| Source delete / teardown | the source rows and tags before the pipeline rooted-set lock | by design (0) first; the rooted set is read inside the V137 function under the source locks |
