## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- Ticket AC ("A burst of writes cannot exceed the per-principal run budget") is proven, not
  merely asserted: `AutoRunGuardBurstProofSpec.scala` 3.1 (debounce-defeated single-instance burst)
  and 3.2 (cross-instance burst) both read `pipeline_runs` row counts and
  `pipeline_run_rate_window.request_count` directly and assert the six-write burst is bounded to the
  configured budget of 3.
- Ticket-level scope items 1-5 all addressed and traceable to committed artifacts:
  1. Debounce-defeated proof — 3.1/3.2, verified.
  2. Red case — 3.3 (`withGuard = false` fixture produces 6/6 `pipeline_runs` rows, i.e. the guard's
     absence genuinely changes the outcome); falsifiability narrative in files-modified.md is
     consistent with the code's own in-file comment recording the same confirmation.
  3. No-retry-storm — `AutoRunGuardNoRetryStormSpec.scala` drives 5 synthetic ticks after a
     deterministic (limit=0) denial and asserts the debounce row is gone after the denying tick and
     never reappears absent a fresh write; a fresh write is shown to re-schedule correctly.
  4. Guard-rejection visibility — explicitly decided log-only in design.md Decision 3, not silently
     assumed; matches the "guard applies uniformly" spec text (no new visibility requirement) and
     the owner's release-blocking-ticket scope framing.
  5. No-bypass confirmation — files-modified.md's "No production code changed" section traces every
     auto-run-adjacent path (`AutoRunTriggerService`, `PipelineSchedulerService.fireAutoRun`,
     `PipelineAutoRunDebounceRepository.claimDue/releaseClaim`, `Main.scala` wiring) to the shared
     guard; independently spot-checked `Main.scala`'s `PipelineSchedulerService` construction and
     confirmed it takes `apiRoutes.pipelineRunService`, matching the claim.
- Task list (tasks.md 1.1, 1.2, 2.1, 3.1-3.5) all marked done, matching what was actually
  implemented — no task claimed done without corresponding evidence in the diff.
- No scope creep: `git diff` against the resolved base shows exactly 11 files, all test/openspec
  artifacts — zero production code.
- No regressions: the 5 named existing regression specs plus the 2 new specs pass (40/40, verified
  independently — see Phase 2), and the full backend suite passes (4823/4823, verified
  independently).
- No API contract changes — none expected, none made.
- Planning artifacts (proposal/design/tasks, and the two spec deltas) accurately reflect the final
  implemented behavior; the two `MODIFIED Requirements` spec deltas' new scenarios map 1:1 onto the
  new test assertions (the "auto-run submission" scenario in `pipeline-run-guard/spec.md` ↔ 3.1-3.3;
  the "no retry storm" scenario in `dataset-write-auto-run/spec.md` ↔ 3.4).
- `workflow-state.md` CONSTRAINTS (C1-C8) all honored: no schema change (C2, V111 untouched),
  `files-modified.md` lists every touched file including the two new test files (C3), no epic state
  change evident in the diff (C7 — not applicable to a code diff but nothing contradicts it).

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates re-run independently (not trusted from the executor's report):**
- Targeted suite (`AutoRunTriggerServiceSpec`, `PipelineSchedulerServiceSpec`,
  `PipelineRunGuardIntegrationSpec`, `DatasetWriteAutoRunEndToEndSpec`,
  `DatasetWriteAutoRunCoalescingSpec`, `AutoRunGuardBurstProofSpec`, `AutoRunGuardNoRetryStormSpec`)
  via `sbt testOnly`: **40/40 passing**, own run, matches the executor's claim.
- Full `sbt test`: **4823/4823 passing**, own run (5m14s), matches the executor's claim exactly.
- `npm run check:scala-quality`: clean (0 blocking findings; one pre-existing-style informational
  soft-budget warning on the new 276-line `AutoRunGuardBurstProofSpec.scala` — CONTRIBUTING.md states
  file-size warnings are informational only, not gate-blocking. Noted as a non-blocking suggestion
  below).
- `npx openspec validate auto-run-guard-enforcement --type change`: `Change 'auto-run-guard-enforcement' is valid`.
- Frontend gates (lint/format/test/build) were not run — no `frontend/**` files changed.

**Read both new spec files in full (not just the executor's transcript):**
- Every assertion in both files reads DB state directly: `runCount()` (`SELECT count(*) FROM
  pipeline_runs WHERE pipeline_id = ...`), `rateWindowRequestCount()` (`SUM(request_count) FROM
  pipeline_run_rate_window`), `debounceRowExists()` (`SELECT 1 FROM pipeline_auto_run_debounce`).
  No assertion inspects a log line or a captured log appender anywhere in either file.
- The "burst exceeds budget without the guard" claim in 3.3 is real, not asserted: the fixture
  constructs `PipelineRunService` with `pipelineRunGuardRepo = null` (the same nullable-optional
  convention other collaborators in the class already use — confirmed by reading
  `newRunService`'s `withGuard` branch), drives the identical six-write burst as 3.1, and asserts
  `runCount(pid) shouldBe 6` (vs. 3 in the guarded case) — this is a genuine differential, not a
  tautology.
- Both files use `EmbeddedPostgres` per-suite (own `beforeAll`/`afterAll`), not the shared dev DB —
  MISTAKES.md's "every worktree shares one Postgres database" hazard does not apply here. RLS is
  bypassed in this embedded instance too, but the guard under test is an application-level
  rate-limit/concurrency check independent of RLS, so that gap is not relevant to this proof.
- Cross-instance concurrency risk (design.md's own named risk) is mitigated as described: both
  scenarios assert only final row counts/state, never interleaving-sensitive intermediate timing.

**CONTRIBUTING.md compliance:**
- Imports & Qualifiers: all imports are top-of-file; no inline FQNs found in either new file
  (confirmed by both a full read and the clean `check:scala-quality` run, which mechanically
  enforces this rule).
- "Tests are held to a stricter line" — comments in both files explain fixture shape/ordering
  rationale (e.g. the `fannedClock` shim's reason for existing, the `rateLimitPerWindow = 0`
  determinism rationale, the falsifiability confirmation note) rather than narrating steps or
  restating assertions in prose. Compliant.
- File-size soft budget: `AutoRunGuardBurstProofSpec.scala` is 276 lines vs. the 250-line soft
  budget — informational only per CONTRIBUTING.md, not a gate failure. See suggestion below.

**DRY / Modular / Readable / Type safety / Security / Error handling / No dead code / No
over-engineering:** all satisfied — the new specs reuse the exact repository/service wiring and
`EmbeddedPostgres`+Flyway fixture pattern already established in `PipelineSchedulerServiceSpec`/
`DatasetWriteAutoRunCoalescingSpec`, no new production surface, no untyped escape hatches, no
`TODO`/`FIXME`/commented-out code found in either file.

**Behavior-preserving / no production code touched:** confirmed independently —
`git diff <base>...HEAD --name-only | grep backend/src/main` returns zero hits. The diff is
exactly the 2 new test files + 9 openspec planning/spec-delta files, matching files-modified.md's
own inventory exactly (11 files, cross-checked file-by-file against `git diff --stat`).

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` files changed (verified via `git diff --name-only` against the resolved base;
this change only touches `openspec/changes/auto-run-guard-enforcement/specs/**`, which is a
proposed delta, not the canonical archived spec tree). This is a backend test-only, proof-only
delivery with no UI-affecting surface — confirmed, not skipped silently.

### Overall: PASS

### Non-blocking Suggestions

- `AutoRunGuardBurstProofSpec.scala` is 276 lines, 26 over the 250-line soft budget
  (`npm run check:scala-quality` informational warning). Not gate-blocking, but a natural split
  point exists: 3.1/3.2 (the debounce-defeated + cross-instance proofs) share nearly all fixture
  helpers with 3.3 (the red case) — a future pass could extract shared helpers
  (`seedUser`/`seedDataset`/`seedPipeline`/`newTriggerService`/`newRunService`/`newScheduler`/
  `driveIndependentBursts`) into a small trait or companion object shared with
  `AutoRunGuardNoRetryStormSpec.scala`, which duplicates the same seed/fixture helpers verbatim.
  This is pre-existing-pattern duplication (the same duplication exists between many other spec
  pairs in this package) rather than a defect introduced by this change, so it is not a change
  request.
