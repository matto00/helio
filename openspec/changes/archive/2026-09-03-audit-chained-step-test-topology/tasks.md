# Tasks — HEL-949

## 1. Audit (AC1)

- [x] 1.1 Re-derive, independently of design.md's table, the intent of every one
      of the 33 call sites across all FOUR consuming files (PipelineRunRoutesSpec
      12, PipelineAnalyzeRoutesSpec 12, PipelineStepRepositorySpec 7,
      WorkspaceContextServiceSpec 2), from each test's own name, comments and
      assertions. Report any disagreement with design.md's hypothesis rather than
      conforming to it.
- [x] 1.2 Do NOT rely on a `stepRepo.insert` grep for the census — that exact
      pattern is what missed two files in design-gate round 1. Use the rename in
      task 6 as the completeness gate: after renaming, a clean compile is the
      proof that no call site was missed.
- [x] 1.3 Read the actual `seedDsWithData` fixture and record the exact seeded rows
      and field values, so every row-count expectation in this ticket is arithmetic
      against real data, not an assumption.
- [x] 1.4 Confirm by grep that `PipelineStepRepository.insert` has zero production
      call sites before relying on that fact for the rename.

## 2. Evidence that the gate was blind (AC-evidence bar, D2)

- [x] 2.1 Each of the four multi-step tests has its OWN mutation target (design.md
      D2 table): 468/469 -> `PipelineRunService.scala:403` slicedSteps/pathToRoot;
      544/545 -> `InProcessPipelineEngine.scala:325` enabled-skip (NOT the prefix
      walk — for that fixture the target is the leaf, so the prefix mutation is a
      no-op); 234/235 -> the analyze-path `.filter(_.enabled)`; 346/347 -> the
      `outputColumns` derivation along the analyze path (locate it explicitly).
      Confirm each target in the code, and confirm it is capable of failing its
      assigned test, BEFORE mutating.
- [x] 2.2 Apply each test's own deliberate break to its production path. Run all
      four tests **against the UNCHANGED (parallel-root) topology** and record the
      result for each. This is the proof the gate was blind; capture the actual output.
- [x] 2.3 Revert the break.

## 3. Correct the topology (AC2, D1)

- [x] 3.1 Switch lines 468/469 to `insertInternal(..., parentStepId = Some(...))`,
      preserving insertion order as trunk order (select -> limit).
- [x] 3.2 Switch lines 544/545 likewise, so the disabled `limit` is the ANCESTOR
      of `select` — matching the test's "executed prefix" claim.
- [x] 3.3 Switch PipelineAnalyzeRoutesSpec 234/235 so the disabled `rename` is the
      ANCESTOR of `select` (matching its flow-through comment).
- [x] 3.4 Switch WorkspaceContextServiceSpec 346/347 so `select` is the ancestor
      of `rename`.
- [x] 3.5 Leave the 25 single-step call sites as root inserts. Do not convert
      them. Record the justification in the audit report, not as inline noise.

## 4. Prove the gate now sees (D2)

- [x] 4.1 Run all four corrected tests: record GREEN (subject to 5.4's predicted
      red, which must be resolved first).
- [x] 4.2 Re-apply each test's production break from 2.2 and RECORD THE RESULT per
      test — red with actual failure output, or green.
- [x] 4.3 For any GREEN result, first satisfy design.md D2a's precondition: state
      which assertion in that test would have changed value had the mutation taken
      effect. If none would have, the mutation was INERT — that is a measurement
      error, not a finding: fix the target, report the mis-specification, re-run.
      Only a green under a JUSTIFIED mutation is the "still topology-insensitive
      after correction" AC4 finding. Never mutation-shop past a justified green.
- [x] 4.4 Classify every result into ONE of D2a's THREE buckets: (1) was-vacuous,
      now-guarded; (2) still topology-insensitive after correction; (3) already
      guarded, red under BOTH topologies. Bucket 3 must never be reported as
      bucket 1 — it means the mechanism was always covered, not that this change
      closed a gap.
- [x] 4.5 Where one mutation affects assertions within a single test differently,
      record PER ASSERTION, not per test. Specifically confirm or refute
      design.md D2a's recorded per-assertion prediction for
      PipelineAnalyzeRoutesSpec 234/235: `resp.steps should have size 1` red under
      BOTH topologies (bucket 3), `inputSchema ... contain allOf` bucket 1. NOTE:
      the bucket-1 half is expected to be REFUTED as unobservable — ScalaTest
      short-circuits the block at the failed `size` assertion, so the inputSchema
      line never runs. Refuting it is the correct, successful outcome and is NOT
      grounds to switch mutations. Same for 468/469, which is also expected to be
      bucket 3 (its target is the ancestor, so pathToRoot is [select] under both
      shapes) — legitimate, not a mis-assignment.
- [x] 4.7 If any result is RED under the OLD topology but GREEN under the new one,
      the correction REMOVED coverage. Stop and escalate; do not file it under any
      other bucket.
- [x] 4.6 Revert the break; record GREEN again.

## 5. Diagnose any red (D3)

- [x] 5.1 If correcting the topology turns any assertion red, diagnose that test
      individually and classify it as (a) old expectation described the parallel
      shape and the new value is arithmetically correct against the 1.3 fixture,
      or (b) a genuine product defect in the prefix/trunk walk.
- [x] 5.2 On any case (b): STOP and escalate for a spinoff ticket. Do not absorb
      the defect into this change and do not update the expectation to match.
- [x] 5.3 Explicitly record if nothing went red — design.md D3 predicts both
      PipelineRunRoutesSpec `rowCount` expectations remain 2; confirm or refute.
- [x] 5.4 WorkspaceContextServiceSpec 346/347's `steps.map(_.position) shouldBe
      Vector(0, 1)` is PREDICTED to go red (per-parent position numbering makes a
      trunk 0,0 not 0,1). Read `WorkspaceContextService`'s ordering code and state,
      with the code cited, whether this is D3 case (a) (order is carried by tree
      traversal, so re-express the ordering claim against `outputColumns`) or case
      (b) (order really is read from the raw `position` column, so chained
      pipelines mis-order -> STOP and escalate a spinoff). "Updated to Vector(0,0),
      suite green" is an explicitly unacceptable resolution.

## 6. Disarm the trap (AC3, D4)

- [x] 6.1 Rename `PipelineStepRepository.insert` to `insertRootStep`; update its
      scaladoc to state that it creates a ROOT branch and that
      `insertInternal(..., parentStepId = ...)` is how to chain.
- [x] 6.2 Update all 33 call sites across the four files (test tree only) to the
      new name. A clean compile is the completeness proof (task 1.2).
- [x] 6.3 Rewrite — do not delete — the HEL-922 warning comment near line 487 so it
      describes the new API rather than a method name that no longer exists.
- [x] 6.4 Confirm no defaulted `parentStepId` was added to the renamed method
      (D4's explicitly rejected alternative).

## 7. Report (AC4, D5)

- [x] 7.1 Write `audit-report.md` in this change directory with the per-call-site
      audit table (33 rows), the 2.2/4.2 mutation evidence bucketed per design.md
      D2a, and an explicit AC4 answer — including the negative case stated
      outright if that is the finding.
- [x] 7.2 Note in the report that the ticket's AC1 says "13 known" call sites in
      PipelineRunRoutesSpec while listing only 12 line numbers; the true count is
      12, and the 33-row table is complete, not short. One sentence prevents a
      reviewer reading the table as missing a row.

## 8. Gates

- [x] 8.1 `sbt test` for the backend — full suite green. On any Flyway validation
      failure, STOP and report Applied/Resolved values; do not fall back to a
      scratch DB.
- [x] 8.2 Scala code-quality gate; no inline fully-qualified names.
- [x] 8.3 Confirm the diff touches only the SIX files in the proposal's Impact
      section plus the change directory. Within the 25 single-step sites the only
      permitted edit is the mechanical rename — no topology, expectation, or
      fixture changes there. No `*.png` at the repo root touched, no
      edits under `.concertino/**`.
- [x] 8.4 Write `files-modified.md` and COMMIT before yielding.
