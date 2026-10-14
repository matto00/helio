## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 273c0b0c9c884a17210f58db811a3bb02718415d. The change dir is untracked and there are no code changes
yet. I judged the artifacts as they stand now. Every claim below comes from reading the code myself, not from the
design's Context section or from round 1.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/late-delete-after-succeeded-write/HEL-1564`.

**The success chain** (`PipelineRunSucceededWrites.scala`):
- `materializedWrites` (:85), `binaryRefsUpsert` (:184), `alertEvaluation` (:204), `updateRun` (:240), `updateMeta`
  (:242), `assertionsInsert` (:250) and `baselineUpsert` (:264) are all eager vals. The `for` at :276-285 sequences
  them and ends with `failIfLostTerminalWrite` (:304-309).
- `publishTerminalAfter` (PipelineRunTerminalWrites.scala:34-42) skips the publish only when `skipPublishOn` matches,
  and that is only `RunNoLongerOpen` (:295).
- The executor's `recoverWith` (PipelineRunExecutor.scala:364) maps only `RunNoLongerOpen` through `lateFinisher`
  (:372-388): `Missing` + pipeline gone answers 404, otherwise 409. Any other failure fails `submit`'s Future.
- **Confirmed.**

**Run guard and terminal write** (`PipelineRunRepository.scala`):
- `runGuardAction` (:354-360) passes when the run is open or `succeeded`, and fails `Missing` / `Terminal` otherwise.
- `updateRunTerminal` (:291-309) and `updateRunTerminalInternal` (:316-330) are conditional on the row still being
  open, and return `rows > 0`.
- So `won = true` means the write committed before any cascade. D1's predicate (won AND pipeline gone) does separate
  the ruling's case from D7. **Sound.**

**Post-fold writes on a deleted pipeline:**
- `updateSchemaInternal` (OutputRepository.scala:273-274) is a zero-row UPDATE.
- `binary_refs.pipeline_id` and `node_step_id` both have an FK with ON DELETE CASCADE (V94__outputs_model.sql:425-426).
- `overwriteForNode` (BinaryRefRepository.scala:45-75) INSERTs one row per ref, so with non-empty refs on a deleted
  pipeline it hits an FK violation.
- **Confirmed.**

**Round 1 change requests are resolved:**
- **CR1:** D5.3 now forces the delete after the terminal write AND the whole node fold, using a promise from a
  snapshot-repo wrapper, and asserts `node_snapshots` = 6 before the delete. The wrapper performs a real FK
  violation. D5.4 / task 2.2 add the "recover only `RunNoLongerOpen`" mutation, which must turn test 3 red.
  - I traced test 3: after the last node, `updateSchemaInternal` touches zero rows, so `materializedWrites` succeeds.
    The surfaced error is then the FK violation from `binaryRefsUpsert`, as intended.
- **CR2:** tests 1-3 now assert exactly one `succeeded`, and the standing constraint C1 is recorded in tasks.md.
- **Round 1 notes:**
  - The "check-time vs failure-time" note is now in Risks.
  - Test 4 pins both halves of the failure: the failed Future and the published `succeeded`.
  - The test-file budget is now task 1.3a. `check-scala-quality.mjs` treats the 250-line budget as a soft warning
    only, and the file is already over it.

**Mutations in D5.4 hold up when traced through the code:**
- Dropping the `won` check turns D7's "deleted before the Output list was read" test red. In that test the list is
  empty and `updateRun` is gated, so `won` is false, `failIfLostTerminalWrite` fails with `Missing`, and the pipeline
  is gone. Without the `won` check the recovery would answer `Right`, not 404.
- Dropping the pipeline-gone check turns test 4 red.

**D5.6:** the HEL-1518 item-2 delete test (LateFinisherRunSpec.scala:206-213) does not gate `terminalGate`, so it is
order-sensitive under the new rule. The design gates it, which is correct. Other specs that delete a pipeline
(`Hel1503EditorRunGapsSpec`, `Hel1516GranteeDriftPreviewSpec`, and others found by grep) are covered by the D5.6 audit
task.

**Spec delta vs `openspec/specs/pipeline-run-reaper/spec.md`:** I diffed the requirement block. The changes are:
- the guard paragraph's "no succeeded" now has the after-won exception;
- the 404 sentence is narrowed to "before its own succeeded terminal write committed";
- a new after-won paragraph is added;
- the "deleted while its run executes" scenario WHEN clause is narrowed;
- two scenarios are added.

Nothing else changed.

### Verdict: REFUTE

### Change Requests

1. **The spec delta re-asserts a D7 claim that the design's own analysis shows is false. The design neither fixes the
   gap nor scopes it out.**
   - The delta's narrowed sentence and its "Pipeline deleted while its run executes" scenario say: a deletion before
     the run's own `succeeded` write commits answers 404 and publishes no `succeeded`, "wherever the deletion lands".
   - The design's Context identifies `binaryRefsUpsert` as an un-guarded write that FK-fails on a deleted pipeline.
     That failure is not specific to the after-won case. Consider this lost-write interleaving: the node fold
     completes (or the pipeline has no materialized Outputs, so the fold is trivially empty), then the delete commits,
     then the eager binary-ref INSERT runs and the eager `updateRun` returns `won = false`.
   - In that interleaving the `for` fails at `binaryRefsUpsert` (:278) with a PSQLException, not `RunNoLongerOpen`:
     - `skipPublishOn` does not match, so `succeeded` IS published (PipelineRunSucceededWrites.scala:293-296);
     - the executor's `recoverWith` (PipelineRunExecutor.scala:364) does not match, so `submit` fails instead of
       answering 404.
   - D1 as designed propagates the original failure when `won = false`. So after this change the spec would still say
     "404, no succeeded, wherever the deletion lands" for an ordering the design knows produces "failure + succeeded".
   - This is the mirror of the exact reason D1 rejects the narrow alternative ("leaves the binary-reference FK failure
     ... timing-dependent").
   - Pick one option and write it into the artifacts:
     - **(a) Extend D1 symmetrically** (preferred: it reuses the same awaited `updateRun` and the same existence
       check). When the chain fails with a non-`RunNoLongerOpen` error, `won = false`, and the pipeline is gone,
       re-fail with `RunNoLongerOpen(RunState.Missing)`. That gives 404 with no publish, i.e. D7. Add a forced-ordering
       test for it: the delete is gated before `updateRun` and after the fold, and the binary-ref wrapper performs the
       real FK insert. Expect 404 and zero `succeeded` events. Record its red output on unmodified code, and add a
       D5.4 mutation that must turn it red.
     - **(b) Scope it out explicitly.** Name the gap in design.md Non-Goals and Risks and file a follow-up. Qualify the
       delta's 404 sentence and scenario so they no longer claim "wherever the deletion lands" for un-guarded post-fold
       write failures. Do not leave the spec asserting behaviour the code does not have.

### Non-blocking notes

- **D5.2 / test 2 node order:** `materializedNodeKeys` is a `Set` intersection (:102), so which node the fold writes
  first is not something the test controls. Assert "exactly one node's 3 rows remain" (count 3, one distinct node key).
  Do not assert a specific node.
- **D2 settle set:** the recovery should also await `updateRun` itself, which it does via D1, and must not await a
  future that is waiting on the recovery. None of the listed siblings do, but say so in the scaladoc.
- **Fixture wiring:** test 3 and test 4 need a `service()` variant that wires the `BinaryRefRepository` wrapper. The
  current `service()` passes no `binaryRefRepo`. Keep every other test on the binary-ref-free service, so the D7 and
  item-2 expectations are not changed by a newly wired eager write. C1 requires this.
