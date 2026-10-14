## Context

See proposal.md (Why). Verified against main 273c0b0c9:

- `PipelineRunSucceededWrites.onUnblockedRunSuccess.writesChain` builds several EAGER futures: `materializedWrites`
  (Output list read, then a sequenced per-node fold whose transactions begin with
  `PipelineRunRepository.runGuardAction`), `binaryRefsUpsert`, `alertEvaluation`, `updateRun` (the run's own
  `succeeded` terminal write, `won: Boolean`), `updateMeta`/`assertionsInsert` (gated on `won`), `baselineUpsert`
  (self-recovering). A `for` sequences them and ends with `failIfLostTerminalWrite` (HEL-1518 D7).
- `runGuardAction` passes for an open run or `status = 'succeeded'` (standing C1 of HEL-1518), fails
  `RunNoLongerOpen(Missing)` when the run row is gone and `RunNoLongerOpen(Terminal)` otherwise. After the run's own
  write won, the reaper cannot touch it (it only finalizes open runs), so the only possible trip is `Missing`, from
  the pipeline-delete cascade.
- The `for` fails fast: a guard trip fails the chain, `publishTerminalAfter` skips the publish on `RunNoLongerOpen`,
  and `PipelineRunExecutor`'s `recoverWith` maps it through `lateFinisher` to 404 (pipeline gone) / 409.
- Post-fold writes on a deleted pipeline: `updateSchemaInternal`, `updateLastRun[Internal]` and the alert evaluation
  update zero rows or self-recover; `persistAssertions` self-recovers; `baselineUpsert` self-recovers;
  `BinaryRefRepository.overwriteForNode` with a non-empty ref set INSERTs into `binary_refs` (FK to `pipelines`) and
  fails with a foreign-key violation -- an un-guarded way for a run that already succeeded to fail after a delete.
- `node_snapshots` has no FK and is not removed by `PipelineRepository.delete` (HEL-1518 D7; cleanup tracked on
  HEL-1541); `output_snapshot_history` and `node_payload_history` cascade.

## Goals / Non-Goals

**Goals:** after the run's own `succeeded` write won, a pipeline delete landing anywhere afterwards yields success
plus one `succeeded` publish; lost-write behaviour (D7) and first-terminal-write-wins unchanged; deterministic,
red-first proof under forced orderings.

**Non-Goals:** cleaning orphaned `node_snapshots` on delete (HEL-1541); changing any behaviour while the pipeline
still exists; changing the dry-run, blocked-run or write-back paths; any migration, API or frontend change.

## Decisions

**D1. One narrow recovery around the whole success chain, keyed on two facts.** When `writesChain`'s sequenced
result fails with any non-fatal error, the chain awaits `updateRun`. It recovers to success (`None`) only when
(a) `updateRun` itself succeeded with `won = true`, AND (b) a privileged existence check
(`pipelineRepo.findByIdInternal(pipelineId)`) finds the pipeline gone. When instead `won = false`, the pipeline is gone, and the failure is anything OTHER than
`RunNoLongerOpen` (e.g. the eager binary-reference insert hit the FK after a delete that also beat the run's own
write), the chain re-fails as `RunNoLongerOpen(Missing)`, so the lost write answers 404 with no publish, exactly as
D7 already does for the guard-trip and post-fold cases (D1b). In every other combination (pipeline still exists; or
`updateRun` itself failed; or the failure is already `RunNoLongerOpen` with `won = false`) the ORIGINAL failure
propagates unchanged.
- D1b closes a pre-existing hole the skeptic found (round 2): today that ordering publishes `succeeded` and fails
  `submit` instead of answering 404, contradicting the spec's "wherever the deletion lands". It is the mirror image of
  D1, decided by the same two facts, so it belongs in this change rather than a follow-up.
- Why both facts: (a) alone would also swallow genuine write failures on a live pipeline; (b) alone would turn a lost
  write (D7, deleted before the run's own write) into success. Together they are exactly the owner ruling's
  predicate: "the run's own succeeded write won, then the pipeline was deleted".
- Alternative considered: recover only `RunNoLongerOpen(Missing)` from the node fold. Rejected -- leaves the
  binary-reference FK failure (and any future un-guarded post-fold write) as a timing-dependent non-success, which the
  ruling ("whatever the timing") forbids.
- Alternative considered: re-check `won` inside the node guard (let the guard pass when the row is missing but the run
  had won). Rejected -- the guard cannot distinguish "cascaded after winning" from "cascaded before" (the row is gone
  either way), and would need the in-memory `won`, coupling the DB action to a racing future.
- The existence check is a read-only privileged lookup keyed by the id `submit` already authorized -- the same
  pattern `lateFinisher` uses; it discloses nothing.

**D2. Settle before answering.** Because the `for` fails fast while sibling eager futures (`binaryRefsUpsert`,
`alertEvaluation`, `updateMeta`, `assertionsInsert`, `baselineUpsert`) may still be in flight, the recovery waits for
every one of them to settle (none of them depends on the recovery itself, so the wait cannot deadlock; outcome ignored -- each either no-ops or fails only because the pipeline is gone) before
returning success. This keeps HEL-1366's contract: `succeeded` is published only after the chain's writes completed,
and `publishTerminalAfter` publishes exactly once (the recovered result is a success, so it publishes the existing
`succeeded` event with the run's row count and id).

**D3. What is written when the delete removed the Outputs (the ticket's engineering call).**
- Nodes whose snapshot transaction committed BEFORE the delete: their `node_snapshots` rows remain (no FK, as for any
  pipeline deletion; HEL-1541), their history and payload rows go with the cascade.
- The first node whose guard observes the deletion, and every node after it: nothing is written (the guard rolls the
  node back; the fold stops at the first failure). Nothing is re-created for a deleted pipeline.
- Delete before the Output list read: the list is empty, no node is written (unchanged from today).
- Run row: it was `succeeded`; the delete cascaded it away. `last_run_*`, Output schemas, alerts, assertions,
  baseline: zero-row or self-recovered no-ops. Binary references: the INSERT fails on the FK; covered by D1.
- Caller: `Right` (the normal success response); subscribers: one `succeeded` event. A WARN is logged naming the run
  and pipeline and stating the outcome was kept as success while the remaining writes were skipped.
- Why not 404: the owner ruling. Why not keep writing remaining nodes: their pipeline and Outputs are gone; writing
  orphan rows for a deleted pipeline is pure garbage (and history/payload would FK-fail anyway).

**D4. Placement and size.** The recovery lives with the chain in `PipelineRunSucceededWrites` (or a small private
helper object in the same package if the file's soft 250-line budget pushes it out; it is already 347 lines, so the
helper is preferred if the addition is more than a few lines). No change in `PipelineRunExecutor`: a recovered chain
is an ordinary success, and an unrecovered one reaches its existing `recoverWith` unchanged.

**D5. Proof: red-first, forced orderings, no sleeps for ordering.** In `LateFinisherRunSpec`, using the existing
seams (`terminalWritten`, `terminalGate`, `beforeNodeFold`, `beforeOutputList`) plus, where needed, new wrapper seams
of the same style (a snapshot-repo wrapper that acts after the first node's write; a `BinaryRefRepository` wrapper):
1. FLIP the HEL-1544 test "still answer 404 ... after the Output list was read": delete forced after the run's own
   write and after the list read -> `Right`, `awaitSucceeded` true, no node snapshot/history/payload rows.
2. NEW: delete forced after the run's own write AND after the first node's write committed, before the second node's
   -> `Right`, `succeeded`, first node's `node_snapshots` rows remain (3), the second node's do not, history and
   payload counts 0 (cascaded).
3. NEW: binary-reference post-fold write failing on the deleted pipeline. The surfaced error must be the FK
   violation, not a node guard trip, so the delete is forced only after BOTH the run's own terminal write AND every
   node write have completed (a promise completed by the snapshot-repo wrapper after the last node write; the test
   asserts `node_snapshots` count 6 before the delete). A `BinaryRefRepository` wrapper then deletes the pipeline and
   performs a real `binary_refs` insert for it (a genuine FK violation, not a thrown stub) -> `Right`, exactly one
   `succeeded`. Under the rejected alternative (recover only `RunNoLongerOpen`) this test is red -- recorded as a
   mutation in D5.4.
4. NARROWNESS CONTROL: the same binary-reference failure forced while the pipeline still exists (a real FK violation
   against a non-existent pipeline id) -> NOT success; pin BOTH halves of today's answer, recorded first on unmodified
   code: `submit`'s result (expected: the Future fails) and the publish (expected: `succeeded` is still published,
   because `skipPublishOn` only matches `RunNoLongerOpen`). Mutation guard: removing the pipeline-gone check from D1 must turn this test red; removing the `won` check
   must turn D7's "deleted before the Output list was read" test red; narrowing the recovery to `RunNoLongerOpen` only
   must turn test 3 red; dropping D1b must turn test 7 red. Run all four mutations and record the red output.
5. KEEP UNCHANGED and green: every HEL-1518 D7 / item-1 / item-2 test, the HEL-1544 delete-before-list `Right` test,
   the healthy C1 control, the lock-behaviour tests.
6. SEQUENCE the HEL-1518 item-2 test "write nothing ... answer 404 when its pipeline was deleted in that window": it
   does not gate the run's own terminal write, so under the new rule its outcome would depend on which commits first
   (the exact HEL-1544 flake class). Gate `terminalGate` on the delete finishing, as HEL-1544 did for its sibling.
   Audit every other delete-based test in the file (and any other spec that deletes a pipeline mid-run, e.g. grep for
   `pipelineRepo.delete` / `deletePipeline` in `backend/src/test`) for the same order sensitivity.
Event counts: tests 1-3 assert EXACTLY one `succeeded` event for the run (count after `awaitSucceeded` plus the
existing settle window), matching the spec's "exactly one".
Test-file budget (DONE in cycle 2: `LateFinisherSpecBase` + `LateFinisherRunSpec` + `LateFinisherDeleteAfterWonSpec`); original note: `LateFinisherRunSpec.scala` is already 387 lines; if the additions breach the test-file budget,
the delete-after-won tests move to a sibling spec sharing a fixture trait.
7. NEW (D1b): delete forced after the node fold completed but BEFORE the run's own terminal write (hold
   `terminalGate` until the delete finishes), then the real binary-reference FK failure -> `Left(NotFound("Pipeline
   not found: <id>"))`, NO `succeeded` event, run row gone. Red on unmodified code (today: Future fails, `succeeded`
   published). Mutation: drop D1b -> test 7 red.
Node order: the fold iterates a `Set` intersection, so test 2 must not assume which of the two nodes is written first
-- it asserts exactly one node's `node_snapshots` rows (3) remain and the other's do not.
Wiring: the binary-reference wrapper is wired only into the service used by tests 3, 4 and 7; every existing D7,
item-1, item-2 and C1 test keeps its current service wiring.
Red-first: tests 1-3 and 7 are written and run against the UNMODIFIED production code first; their failure output is
recorded in evidence before the fix. Determinism: run `LateFinisherRunSpec` at least 10 consecutive times after the
fix, all green.

## Risks / Trade-offs

- [D1 swallows a real error] -> requires both `won = true` and pipeline gone; test 4 + mutations prove each half is
  load-bearing. A failure on a deleted pipeline has no live state left to protect.
- [D1 checks pipeline existence when the recovery runs, not when the failure happened] -> an unrelated failure on a
  live pipeline that is then deleted before the check would answer success. Accepted: by then the run's own write had
  won and the pipeline is gone, which is exactly the ruling's state; documented in the recovery's scaladoc.
- [A reaper could have finalized the run between `won` and the delete] -> impossible: the reaper only finalizes runs
  with `completed_at IS NULL`; after `won` the row is terminal.
- [Pipeline re-created with the same id] -> ids are server-generated UUIDs; not a realistic case.
- [Orphan `node_snapshots` for nodes written before the delete] -> pre-existing for any delete; HEL-1541.
- [Order-sensitive existing tests become flaky] -> D5.6 sequences them; repeat-run evidence.
- [Timing-only defects invisible locally (MISTAKES.md)] -> orderings are forced through seams, not sleeps, so CI
  cannot pick a different interleaving for the asserted paths.

## Migration Plan

None. Code-only; rollback is a revert.
