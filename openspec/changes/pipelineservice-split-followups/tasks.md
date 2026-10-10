## 1. Baseline

- [x] 1.1 Check `free -g` (available >= ~15 GB); record base `javap -public` of `PipelineService`, `PipelineService$`, `PipelineServiceSupport` to the run evidence dir.

## 2. Coverage gaps (D1)

- [x] 2.1 G1 blank-name create tests (service-level and route-level); red under its mutation, green after revert (evidence in `mutation-evidence.md`).
- [x] 2.2 G2 laneTree unknown/foreign pipeline 404 test; red/green as 2.1.
- [x] 2.3 G3 analyze-proposal inline static without config 400 test; red/green as 2.1.
- [x] 2.4 G4 updateStep no-row-after-update 404 tests, one per config branch (None and Some); red/green as 2.1.

## 3. Citations and spec rows (D2, D3)

- [x] 3.1 Fix the ticket-listed stale citations to the D2 targets (symbol + file, no line numbers).
- [x] 3.2 Widened D2 sweep of comments citing moved `PipelineService` members, plus the positional/`[[...]]` sweep of the eleven files; every hit with verdict (kept/fixed/fenced/deferred) in `citation-sweep.md`; D2 verification grep reviewed.
- [x] 3.3 Repoint ExistenceNotLeakedRoutesSpec rows per D3; mutation red/green per repointed row in `mutation-evidence.md`; PatchSetApplyResolvers rows untouched (`git diff` shows only the D3 rows).

## 4. Dead code (D4)

- [x] 4.1 Delete `PipelineServiceSupport.stepAddress` and `PipelineService`'s class-level `log`; compile with no new warnings; `javap -public` diff vs 1.1 empty (recorded).

## 5. Verification (D6)

- [x] 5.1 `npm run check:scala-quality` passes; no inline FQNs in the diff.
- [x] 5.2 `sbt testFull` green with `[hel1468-guard]` present; per-suite counts for touched suites recorded in `test-count-evidence.md`.
- [x] 5.3 Write `files-modified.md` and commit.

## Standing Constraints

- [C1] No behaviour change in main code: only the two D4 deletions and comment edits (never string literals or code). A defect found becomes a follow-up, not a fix.
- [C2] Every new test is shown red under a mutation of the exact branch it guards, then green.
- [C3] Do not touch ExistenceNotLeakedRoutesSpec's `PatchSetApplyResolvers.scala` rows, `patchKindExemptions` or `expectedForbiddenProducers`; in `PatchSetApplyResolvers.scala` edit only the :178 comment.
- [C4] No split of the five over-budget files (D5).
- [C5] sbt runs use `-batch -J-Xmx3g`, show `[hel1468-guard]`, leave no server running; at most one `testFull` at a time.
- [C6] New spec files use `VerifiedEmbeddedPostgres.start`; no inline FQNs.

## Item 4 decision (D5)

Keep all five over-budget files; no split in this change (rationale in design.md D5). Optional follow-up for the driver: a separate behaviour-preserving byte-move ticket if a split is wanted.
