## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 273c0b0c9c884a17210f58db811a3bb02718415d. The change dir is untracked and there is no code change
yet. I judged the artifacts as they stand now, against the code. I read the round 1 and round 2 reports, but only to
check that their findings were resolved. Every conclusion below comes from the code itself.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/late-delete-after-succeeded-write/HEL-1564`.

**The chain** (`PipelineRunSucceededWrites.scala`):
- `materializedWrites` (:85), `binaryRefsUpsert` (:184), `alertEvaluation` (:204), `updateRun` (:240), `updateMeta`
  (:242), `assertionsInsert` (:250) and `baselineUpsert` (:264) are all eager vals.
- The `for` at :276-285 sequences them, fails fast, and ends with `failIfLostTerminalWrite` (:304-309).
- `publishTerminalAfter` (PipelineRunTerminalWrites.scala:34-42) skips the publish only when `skipPublishOn` matches,
  and that is only `RunNoLongerOpen` (:295).
- A recovery placed inside the `writes` argument therefore turns into one `succeeded` publish, and a re-fail as
  `RunNoLongerOpen` turns into no publish. D1, D1b and D2 are consistent with this primitive.

**The executor** (`PipelineRunExecutor.scala`):
- `recoverWith` (:364) maps only `RunNoLongerOpen` through `lateFinisher` (:372-388): `Missing` with the pipeline
  gone gives `NotFound("Pipeline not found: <id>")` (:93-94); otherwise 409.
- On `Right`, `executeRun` (:308-319) only builds the response in memory and reads nothing from the deleted pipeline
  or run.
- So D4's claim holds: a recovered chain becomes an ordinary `Right`, with no executor change.

**The guard and the terminal write:**
- `runGuardAction` (PipelineRunRepository.scala:354-360) passes when the run is open or `succeeded`, and fails
  `Missing` / `Terminal` otherwise.
- `writeTerminal` returns the conditional UPDATE's `rows > 0`, so `won = true` means the write committed before any
  cascade.
- After `won`, only a delete can trip the guard (`Missing`).
- D1's predicate (won AND pipeline gone) matches the owner ruling. D1b's predicate (lost AND gone AND a
  non-`RunNoLongerOpen` failure) matches D7. Both are **sound**.

**Post-fold writes on a deleted pipeline:**
- These are plain zero-row UPDATEs: `updateLastRun` / `updateLastRunInternal` (PipelineRepository.scala:540-590) and
  `updateSchemaInternal` (OutputRepository.scala:273-274).
- `persistAssertions` (PipelineRunTerminalWrites.scala:136-139) and `baselineUpsert` (:272) self-recover.
- `binary_refs.pipeline_id` and `node_step_id` both have an FK with ON DELETE CASCADE (V94:425-426).
- `overwriteForNode` (BinaryRefRepository.scala:45-75) INSERTs one row per ref, so it raises an FK violation on a
  deleted pipeline.
- D3's account of what gets written is **accurate**.

**Round 2 CR1 is resolved (option a):**
- D1b re-fails as `RunNoLongerOpen(Missing)`.
- Test 7 forces the order fold, then delete, then the binary-ref FK, with `terminalGate` held until the delete
  finishes, so `won = false`. It expects 404, zero `succeeded` events and the run row gone.
- I traced test 7 on unmodified code: the FK error surfaces at :278, `succeeded` is published and `submit` fails. That
  is red, as claimed.
- The spec scenario "Pipeline deleted while its run executes" now names the binary-reference case, so its "wherever
  the deletion lands" is backed by the design.

**Tests D5.1 to D5.7, traced against `LateFinisherRunSpec.scala`:**
- **Test 1** flips the pin at :262-270. Today it gives a guard trip and 404, so it is red. After the fix, `won`
  holds, the pipeline is gone, and the answer is `Right`.
- **Test 2** (delete between node writes): the snapshot-repo wrapper deletes after the first node commits, then the
  second node's guard trips `Missing`. The test asserts that exactly one node's 3 rows remain, without depending on
  which node the `Set` intersection at :102 processes first.
- **Test 3:** the delete waits for `terminalWritten` and a fold-done promise, and the test asserts 6 snapshots. After
  the fold, only the FK can fail. `updateRun` has already settled, and the alert service and binary-ref repo are null
  in the shared `service()`. So C1 holds and the "recover only `RunNoLongerOpen`" mutation turns test 3 red.
- **Test 4** (FK error while the pipeline still exists) pins both halves of today's behaviour: the Future fails and
  `succeeded` is published. The "drop the pipeline-gone check" mutation turns it red.
- **"Drop the `won` check"** turns :217 red: the list is empty, `won = false`, `failIfLostTerminalWrite` fails
  `Missing`, and the pipeline is gone, so the mutated code would answer `Right`.
- **D5.6:** the item-2 delete test (:206-213) does not gate `terminalGate`, so under the new rule it is
  order-sensitive. The design sequences it the way :221-223 already does.
- **Deadlock:** none of the forced orderings holds a DB transaction open while it waits on a promise.
- **The other mid-run delete specs** found by grep (`Hel1503EditorRunGapsSpec` S1/S2, `Hel1516GranteeDriftPreviewSpec`)
  delete before admission or in preview paths. They never reach `onUnblockedRunSuccess`, so they are unaffected. The
  audit task covers them anyway.

**Spec delta vs the ticket ACs:**
- Both orderings answer success: D1, tests 1-3, and the existing HEL-1544 test at :253.
- The 404 pin is flipped: test 1.
- D7 and first-write-wins are kept: D1(a), D1b, D5.5.
- What is written after a delete is decided and documented: D3 and the spec scenario.
- Red-first under forced orderings with no ordering sleeps: D5 and tasks 1.2 / 2.2.
- No placeholders, TBDs or contradictions between the proposal, design, tasks and delta.
- No API, schema or migration change is needed, and none is planned.

### Verdict: CONFIRM

### Non-blocking notes

- **Tighten the existing test at :253-260.** The HEL-1544 delete-before-list test asserts only `awaitSucceeded`
  (at least one event). Standing constraint C1 and the new spec scenario say "exactly one". Consider making that
  assertion an exact count when the file is touched, even though D5.5 keeps the test "unchanged".
- **Settle siblings on the D1b path too.** D2 applies to the success path. On the D1b re-fail path, nothing is
  published, so settling does not matter for HEL-1366. Settling the siblings there as well would still keep the
  scaladoc's claim ("answer after the writes settled") uniform.
- **Fixture-only services.** With no run repository wired, `writeTerminal` returns `true`. So any fixture with a
  deleted pipeline and a failing chain would now recover to success. I found no such test, but the evaluator should
  watch for one in the full-suite run.
- **Pre-existing edge, outside this ticket.** If a run is reaped (guard trips `Terminal`) and its pipeline is then
  deleted before `lateFinisher` runs, the answer is 409, not 404. The design does not change this.
