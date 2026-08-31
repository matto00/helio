# Skeptic Report — final gate, dimension: migration-correctness (HEL-904, round 3, human-authorized)

HEAD verified: `7c6597b1`. `V94__outputs_model.sql` md5 `37f24620…` before and after every run
(unchanged — my mutation ran against a copy in scratch, never the tracked file). Worktree clean
apart from a peer skeptic's report. Scratch DBs `hel904_sk5`/`hel904_sk6` dropped
(`hel904_scratch` is not mine and was left alone).

## Method

Independent, from ground truth. `pg_dump -s` of the live dev DB (`flyway_schema_history` max
version = 93) → two fresh databases; truncated exactly as the spec's `beforeAll` does; loaded
`hel904-real-dump.sql` verbatim (73 pipelines / 78 steps / 190 panels / 289 data_types — matches
rounds 1 and 2); ran `V94__outputs_model.sql` under `psql -1 -v ON_ERROR_STOP=1`; queried
`pipeline_steps` directly. Also read `PipelineStepRepository`, `PipelineRunService`,
`PipelineService` as they exist now, and ran `sbt compile` + the two relevant specs.

## What I verified — evidence

### 1. `trunkOf`/`tailsOf` — FIXED as ruled

`PipelineStepRepository.scala:377` `childrenOf(steps, parent).find(_.position == 0)` (exact match,
not `headOption`); `:415` `childrenOf(parent).filter(_.position != 0)` (not `drop(1)`). Confirmed
by reading the file.

### 2. Migration normalization — present and correct

`V94__outputs_model.sql:69-70` `UPDATE pipeline_steps SET position = 0;` unconditional, root
included, immediately after the `parent_step_id` backfill (`:49-53`). Aggregate tail at `:594`
`GREATEST(COALESCE(MAX(position)+1,0),1)`; `computed_fields` chain at `:828` guards `seq = 0` with
the same `GREATEST(...,1)`. Pre-migration real data confirms the guard is needed: no duplicate
positions, no gaps, but 2 of 15 multi-step pipelines (`6ba5075b…` n=20 min=1,
`e3c19110…` n=4 min=1) have a root at `position = 1`, exactly as the executor claimed.

### 3. Real migration on a real DB — trunk/tail placement is correct

SQL simulation of the NEW `trunkOf` rule (recursive walk, exact `position = 0`) over the migrated
tree: **all 15 multi-step pipelines return the FULL trunk, byte-identical to the pre-migration
`ORDER BY position` id array** (`identical = t` for all 15; 0 mismatches across all 39 pipelines
that have steps). Both `position = 1`-rooted pipelines return 20/20 and 4/4.

All 5 `hel904-tail-*` aggregate tails land at `position 1, 2, 1, 1, 1`; **0** tail-or-compute steps
are reachable via `trunkOf`; all 5 are reachable as tail roots via the `tailsOf` rule. All 5
`hel904-compute-*` steps land at `position 1`. Under the OLD `headOption` rule on this same fixed
data, **9** tail/compute steps would still be on the trunk — so the repository half of the fix is
load-bearing, not cosmetic.

### 4. Mutation proof — reproduced myself

Removed only `UPDATE pipeline_steps SET position = 0;` from a scratch copy, re-ran the full
migration on a second fresh DB from the same fixture. The trunk-truncation defect reproduces
decisively: `6ba5075b…` 20 steps → trunk of **0**; `e3c19110…` 4 → **0**; `63130b24…` 4 → **1**;
`555f4bae…` 4 → **1**; every 2-step pipeline → **1**. Restored → all 15 full again. The
normalization is genuinely failable and load-bearing.

### 5. Gates

`sbt compile` clean; `testOnly V94OutputsMigrationSpec PipelineStepRepositorySpliceSpec` →
**34/34 green**, read from actual output.

### 6. Round-1 CONFIRMED items — no regression

On my own migrated DB: `alert_rules.target_output_id` `attnotnull = t`;
`alert_rules_cascade_deleted_companion_type` / `alert_rules_deleted_unresolvable_target` /
`alert_events_deleted_unresolvable_target` counts all present and logged;
`computed_fields_migrated_pipeline_output = 5` with the `computed_fields` test still asserting
op/parent/position/config; 8 RLS policies on `outputs`/`node_snapshots`, and the spec's
policy-drop red-proofs still pass. None regressed.

---

## Verdict: REFUTE

The trunk/tail fix itself is correct and I confirm every claim the executor made about it
(sections 1–4 above are all verified from a real database, including the mutation proof). But the
ruling's *enabling premise* — "step ORDER is carried by `parent_step_id`, not by the raw
`position` number" — is **false for the code that is actually shipped in this branch**. Two live
production paths still key step order on `position`, which this migration has just collapsed to a
constant `0` for every migrated step. This is a NEW defect, introduced by this round's change, not
present before it, and it silently corrupts every migrated multi-step pipeline's execution.

## Change Requests

### 1. (Critical, NEW) The engine and the step-list API still order steps by `position`, which the migration has just set to `0` for every step — execution order of every migrated multi-step pipeline becomes undefined

`PipelineStepRepository.scala:150` (`listByPipelineInternal`) and `:43` (`listByPipeline`) both end
in `.sortBy(_.position)`. `listByPipelineInternal` is what the **run path** uses
(`PipelineRunService.scala:241-242` → `executeRun(… allSteps.filter(_.enabled) …)`) and what the
**step preview** uses (`PipelineRunService.scala:263-264`, `val sortedSteps =
allSteps.sortBy(_.position)`). Neither reads `parentStepId` at all. `trunkOf` has exactly ONE
production caller in the whole backend — `PipelineRunService.scala:632`, and it is only used to
label a trunk-last step id, never to order execution:

```
$ grep -rn "trunkOf\|tailsOf" backend/src/main/scala
…/PipelineRunService.scala:632:          pipelineStepRepo.trunkOf(steps).lastOption.map(_.id.value)
```

So after V94, a real pipeline like `63130b24-78f3-41b1-b934-cac6c7130f0e` (verified on my migrated
DB) has:

```
 op     | position | orig_position
 filter |        0 |             0
 cast   |        0 |             1
 sort   |        0 |             2
 limit  |        0 |             3
```

`ORDER BY position` over four identical keys is an unordered result in SQL — the engine will
execute filter/cast/sort/limit in whatever order the plan happens to return, and that order is not
stable across plan changes, tuple relocation, or a `VACUUM`/`CLUSTER`. On `6ba5075b…` this is 20
steps with no ordering key at all. The consequence is silent wrong results (a `limit` before a
`sort`, a `filter` after a `cast`), not an error.

This also directly contradicts **the ticket's own contract**, `ticket.md:114`: "`list` returns
trunk order by walking `parent_step_id` **so the still-linear engine is unaffected**", and
`ticket.md:216`: "The engine still runs the trunk linearly (via `trunkOf`)". Neither is true of the
shipped code — `list`/`listByPipelineInternal` were never converted to a `parent_step_id` walk, and
the engine never calls `trunkOf`. Before the ruling this was harmless (position was still a real
linear index); the ruling is what makes it a data-correctness bug.

**Required:** make `listByPipeline` and `listByPipelineInternal` return trunk order derived from
`parent_step_id` (i.e. `trunkOf`, plus a defined placement for tails — which the engine must
tolerate since it executes the returned list flat today), or otherwise guarantee the run/preview
paths execute in `parent_step_id` order. A test must assert, on the real fixture post-migration,
that `listByPipelineInternal` for all 15 multi-step pipelines returns the exact pre-migration order
— today no test asserts this, which is why the suite is green (34/34, verified) with the defect
fully live. This is the round-1/round-2 failure mode repeating a third time: the proof asserted the
property of `trunkOf` that was under review, not the property of the code path users actually hit.

### 2. (High, NEW) `reorderInternal` writes a whole-pipeline linear index `0..N-1`, which destroys the position-0-is-the-trunk invariant on the first user reorder

`PipelineStepRepository.scala:265-274`: `orderedIds.zipWithIndex` → `update(index)` across the
whole pipeline, and it never touches `parent_step_id`. It is live:
`PUT /api/pipelines/:id/steps/order` (`PipelineStepRoutes.scala:36-40`) → `PipelineService.reorderSteps`
(`:775-800`) → `reorderInternal`. After one such call on a migrated pipeline, the trunk steps carry
positions `0,1,2,…` again while the `parent_step_id` chain is unchanged, so the newly-exact
`trunkOf` returns **just the root** and every other trunk step is reclassified as a tail by
`tailsOf` — deterministically, not probabilistically. `ticket.md:115` lists `reorderInternal` as
one of the methods this ticket makes sibling-scoped; the shipped implementation is still
pipeline-scoped. This must be sibling-scoped (or re-link `parent_step_id`) and covered by a test
that reorders a migrated multi-step pipeline and then asserts `trunkOf` still returns the full
trunk. (`PipelineStepRepositorySpliceSpec` covers sibling-scoped *insert*, not reorder.)

## Non-blocking notes

- `tailsOf`'s inner `expand` (`:406`) still walks `childrenOf(...).headOption` rather than an
  exact `position == 0` match, so it is asymmetric with `trunkOf`'s fixed rule. It is harmless on
  today's real data (every migrated tail is a single node or a chain whose later hops sit at
  position 0), but if a tail node ever has only non-zero-position children, `expand` and the outer
  `filter(_.position != 0)` loop will both emit that subtree, duplicating it.
- Pipeline `3e535ac8-b7d5-4608-a192-34c3a55ffe18` (zero pre-existing steps, two aggregation
  panels) ends up with **no** position-0 root at all — `trunkOf` returns empty and both aggregate
  tails hang off the source root at positions 1 and 2. I read this as the semantically right
  answer (both aggregations branch directly off the source), and it is now at least
  self-consistent, but round 2 asked for this case to be *explicitly decided and encoded*; the
  ruling does not mention it. Worth one sentence in design.md.
- The stale comment at `V94OutputsMigrationSpec.scala:509-512` still describes `tailsOf` as
  `childrenOf(...).drop(1)` — the exact wording round 2 asked to be corrected, now doubly wrong
  since the code changed.
