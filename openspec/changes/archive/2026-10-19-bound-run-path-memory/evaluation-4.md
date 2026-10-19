## Evaluation Report — Cycle 5 (evaluation-4.md)

Reviewed commit: c1d22c7a1012747d8c453a2dc0e0922989a1d057. Since the cycle-3 FAIL at 2859de639, this commit changes three source files:
- `NodeSnapshotRepository.scala`
- `RunLimitsGuardSpec.scala`
- `NodeSnapshotBatchedWriteSpec.scala`

The rest is archive or evidence markdown. The review base resolved live to 25aca3660. No frontend file differs from that base.

Out of scope, accepted by the owner:
- Batches are capped by row count rather than bytes (HEL-1679).
- The final-gate REFUTEs were cleared by `proceed-to-delivery`.

### Phase 1: Spec Review — PASS
- Change Request 1 from evaluation-3 is resolved:
  - A counting render seam was added.
  - A deterministic spec now fails on eager rendering.
  - Mutation `snapshot-write-eager` is recorded in `evidence/mutations.md`.
- C2 (a mutation per bound that turns its spec red) is now met in substance for the batched write.
- C1 holds: none of the ruled numbers changed.
- C6 holds: draft-preview code is untouched in this delta.

### Phase 2: Code Review — PASS
Gates, run fresh by me at c1d22c7a1 under the sbtfull lock with the load gate applied:
- `sbt testFull` gave **Tests: succeeded 9376, failed 0, canceled 5**, EXIT=0. That is cycle 3's 9375 plus the new spec.
- I did not rely on `green-testfull-cycle5.summary.txt`.

**The seam changes no production behaviour.**
- `overwriteRowsAction` now delegates to `private[persistence] overwriteRowsActionRendering(..., _.compactPrint)`.
- The only change in the body is `row.compactPrint` becoming `render(row)` (NodeSnapshotRepository.scala:173).
- The fold, the deferral through `DBIO.successful(()).flatMap`, the SQL, the row indices and the transaction are unchanged.
- The only production caller is the public method, which passes the default. The only other caller is the spec (grep, 3 hits).

**The spec goes red on eager rendering. I re-applied the mutation and saw it fail.**
- I applied `acc.andThen(DBIO.successful(()).flatMap(_ => insertBatch(batch)))` -> `acc.andThen(insertBatch(batch))` and ran `testOnly NodeSnapshotBatchedWriteSpec`.
- Result: `should never render more than one batch ahead of the inserts (450 rows) *** FAILED ***` with "rows rendered but not yet inserted, at most: 450; 450 was not less than or equal to 200". Totals were 2 succeeded, 1 failed, EXIT=1.
- I restored the line with `git checkout -- <file>` and confirmed `git status` was clean and HEAD was still c1d22c7a1 before running testFull.

**The way the spec measures this is sound:**
- An AFTER INSERT trigger advances a sequence on every inserted row. Sequences are not transactional, so a second pooled connection can read the in-flight insert count while the write's transaction is still open. The pool size is 10.
- Under lazy rendering the expected maximum is exactly 200: a batch's 200 rows are rendered before its first insert, and each later batch starts 200 ahead. Under eager rendering it is 450.
- The harness uses an embedded Postgres per suite (RunServiceHarness.scala:49-50). The trigger and sequence cannot leak into other suites, and no concurrent test can advance the sequence and hide an eager render.
- The failure clue prints one integer, not a payload.

The relabel in `RunLimitsGuardSpec` (line 64) now calls the `MaxPostWalkCells <= 3900000L` check a tripwire. That resolves the second non-blocking suggestion from evaluation-3.

**Everything evaluation-3 found correct still holds.** The only production change in this delta is the render seam above. The post-walk check (`RunLimits` and `PipelineRunExecutor`), the batched-write atomicity under `.transactionally`, and the three `postwalk-*` mutation targets are byte-identical to 2859de639 (`git diff 2859de639 c1d22c7a1 -- backend/src/main` touches only NodeSnapshotRepository.scala). The full suite is green at this head.

Issues: none.

### Phase 3: UI Review — N/A
No frontend, routes, schemas or spec files differ from the live base in this delta, or in the branch as a whole outside the archived change dir.

### Overall: PASS

### Non-blocking Suggestions
- From evaluation-3, still open: nothing tests the "replacing the previous snapshot atomically" claim. A batch-2 failure case, for example invalid jsonb in row 250, that leaves the earlier snapshot intact would back it.
- The new spec blocks inside the render callback (`awaitDb` on a second connection while running on Slick's executor). That is fine with a pool of 10, but would deadlock if the harness pool were ever reduced to 1. A short comment would protect it.
