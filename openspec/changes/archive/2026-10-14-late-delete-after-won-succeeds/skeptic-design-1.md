## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 273c0b0c9c884a17210f58db811a3bb02718415d (change dir untracked; no code changes yet).

### What I verified (with evidence)

Context claims in design.md, checked against the code:
- `writesChain` builds eager futures, and the `for` (PipelineRunSucceededWrites.scala:276-285) sequences
  `materializedWrites` -> `binaryRefsUpsert` -> `alertEvaluation` -> `updateRun` -> `updateMeta` -> `assertionsInsert`
  -> `baselineUpsert` -> `failIfLostTerminalWrite`. **Confirmed.**
- `runGuardAction` (PipelineRunRepository.scala:354-360) passes when the run is open or `status = 'succeeded'`, fails
  `Missing` when the row is gone and `Terminal` otherwise. **Confirmed.**
- `publishTerminalAfter` skips the publish on `RunNoLongerOpen` (PipelineRunSucceededWrites.scala:293-296,
  PipelineRunTerminalWrites.scala:34-42). The executor's `recoverWith` maps it through `lateFinisher` to 404 (pipeline
  gone) or 409 (PipelineRunExecutor.scala:361-385). **Confirmed.** Any other failure is not recovered, so `submit`'s
  Future fails.
- Post-fold writes on a deleted pipeline: `updateSchemaInternal` (OutputRepository.scala:273), `updateLastRun[Internal]`
  and `updateLastSourceSchema[Internal]` are plain UPDATEs that silently touch zero rows. `persistAssertions` and
  `baselineUpsert` recover from failure, and alert evaluation recovers per Output. **Confirmed.**
- `binary_refs.pipeline_id REFERENCES pipelines(id) ON DELETE CASCADE` (V94__outputs_model.sql:425).
  `overwriteForNode` (BinaryRefRepository.scala:45-75) INSERTs one row per ref. With non-empty refs on a deleted
  pipeline it hits an FK violation; with empty refs it only runs a zero-row DELETE. **Confirmed.**
- `updateRunTerminal` / `updateRunTerminalInternal` (PipelineRunRepository.scala:291-330) are conditional on the run
  being owned/open and return `false` when the row is gone. So `won = true` really means the write committed before
  the cascade. D1's predicate (won AND pipeline gone) therefore separates the owner ruling's case from D7. **Sound.**
- The reaper only finalizes rows with `completed_at IS NULL`. After `won` the guard can only trip `Missing`.
  **Confirmed.**
- Existing tests (LateFinisherRunSpec.scala):
  - The HEL-1544 404 pin is at :262-270.
  - The HEL-1518 item-2 delete test (:206-213) does not gate `terminalGate`. Under the new rule its outcome depends on
    the order of the eager `updateRun` and the delete, which D5.6 correctly identifies.
  - The D7 delete-before-list test (:217-228) gates `terminalGate` on the delete, so `won = false`, and the "drop the
    won check" mutation in D5.4 would turn it red. **Confirmed.**
  - `service()` wires no `binaryRefRepo` (null default, PipelineRunService.scala:39), so test 3 needs the new wrapper
    the design describes. **Consistent.**
- Spec delta vs `openspec/specs/pipeline-run-reaper/spec.md`: I diffed the requirement block. The delta narrows the
  404 wording to "before its own succeeded write committed", adds the won-then-deleted rule and two scenarios, and
  changes nothing else. The `MODIFIED` header matches the existing requirement name. **Consistent with the ruling,
  D7 and first-terminal-write-wins.**
- AC coverage:
  - Both orderings answer success: D1, D5.1, D5.2.
  - The 404 pin is flipped: D5.1.
  - D7 and first-write-wins are kept: D1(a), D5.5.
  - What is written after the delete is documented: D3 and the spec scenario.
  - Red-first under forced orderings: D5. See the change request below.
- No placeholders or TBDs. The `PipelineRunExecutor` is left unchanged, which is correct: a recovered chain is an
  ordinary success.

### Verdict: REFUTE

### Change Requests

1. **D5.3 (binary-reference test) is not a forced ordering, so it does not prove the path that justifies D1.**
   D1 rejects the narrower alternative ("recover only `RunNoLongerOpen(Missing)` from the node fold") because of the
   binary-reference FK failure. The test meant to prove that path does not isolate it:
   - As written, the `BinaryRefRepository` wrapper only waits for the run's own terminal write and then deletes.
   - The node fold is an eager sibling running at the same time. Whether node writes are still pending when the
     delete commits is a race.
   - The `for` awaits `materializedWrites` before `binaryRefsUpsert` (PipelineRunSucceededWrites.scala:277-278). So
     whenever a node guard trips, the chain's failure is `RunNoLongerOpen(Missing)`, not the FK violation.
   - In that interleaving the rejected alternative would also pass test 3. The test would go green on a run where
     the FK recovery was never needed.

   Revise D5.3 so that:
   - the delete is forced only after the run's own terminal write AND after the whole node fold has finished. For
     example, the snapshot-repo wrapper completes a promise after the last node's write, and the binary-ref wrapper
     waits on it. A fixture with no materialized nodes would also work.
   - the test asserts that the fold completed before the delete (for example, `node_snapshots` count is 6 after the
     run).

   Add to D5.4 / task 2.2 a third recorded mutation: replace the D1 recovery with one that only recovers
   `RunNoLongerOpen`. Test 3 must go red under it.

2. **Assert "exactly one" `succeeded` event, as the spec delta requires.** The new scenario says "publishes exactly
   one `succeeded` event". D5.1-D5.3 only say `awaitSucceeded` true, which checks "at least one". Specify that tests
   1-3 also assert the count is exactly 1, after the existing settle window, so the spec's claim has a pinning test.

### Non-blocking notes

- D1 evaluates "pipeline gone" when the existence check runs, not when the failure happened. The spec says "a failure
  of the success chain while the pipeline still exists SHALL surface". A genuine, unrelated failure on a live pipeline
  that is then deleted before the check would answer success. That is arguably within the owner ruling ("whatever the
  timing"). Mention it in the scaladoc or the design Risks so the spec wording and the implementation do not diverge
  silently.
- D5.4's "pin whatever today's answer is": today a failed post-fold write on a live pipeline fails `submit`'s Future
  and still publishes `succeeded`, because `skipPublishOn` only matches `RunNoLongerOpen`. Record both halves (the
  failure and the published event) in the pin, so the "surfaces exactly as it would without a deletion" claim is
  pinned completely.
- LateFinisherRunSpec.scala is already 387 lines and gains two wrappers and three tests. Check CONTRIBUTING.md's
  test-file budget and split the HEL-1564 cases into a sibling spec if needed.
