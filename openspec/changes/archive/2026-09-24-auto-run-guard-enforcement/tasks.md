## 1. Backend investigation

- [x] 1.1 Re-confirm (fresh read of current `main`-derived branch code, not memory) every path that
      can create a `pipeline_runs` row or execute the pipeline engine from a dataset write —
      `AutoRunTriggerService`, `PipelineSchedulerService.processAutoRunDebounce`/`fireAutoRun`, and
      any retry/backfill-adjacent code — and verify each one reaches `PipelineRunService.submit` /
      `executeRun`'s guard with no alternate route; record findings in the PR body.
- [x] 1.2 If a real gap is found (a path that creates/executes without the guard), implement the
      minimal targeted fix and verify it closes the gap with a red-then-green test (see Tests
      group). If no gap is found, do not invent one — say so plainly.

## 2. Backend (spec deltas only — no production code expected)

- [x] 2.1 Confirm `openspec validate auto-run-guard-enforcement --type change` passes with the two
      `MODIFIED Requirements` deltas already drafted in Planning (`pipeline-run-guard`,
      `dataset-write-auto-run`).

## 3. Tests

- [x] 3.1 Add a test proving the AC holds with the debounce "defeated" via writes spaced wider than
      `DATASET_WRITE_DEBOUNCE_SECONDS` (multiple real fires from one pipeline in succession), each
      independently subject to the guard — assert on `pipeline_runs` row count and
      `pipeline_run_rate_window` state, not logs. Verify: test passes against current code.
- [x] 3.2 Add a test proving the AC holds with two `PipelineSchedulerService` instances against the
      same test DB (`pipeline_run_rate_window`/`pipeline_auto_run_debounce` shared), each ticking
      independently, mirroring the real multi-instance deployment. Verify: total `pipeline_runs`
      rows created never exceeds the configured per-owner budget regardless of which instance fired.
- [x] 3.3 Add the "guard bypassed" red case: a `PipelineRunService` fixture constructed WITHOUT a
      `pipelineRunGuardRepo`, driving the SAME burst scenario as 3.1, and assert it demonstrably
      would exceed the budget without the guard (proving 3.1/3.2 are not tautological). Verify: this
      test fails if `pipelineRunGuardRepo` is wired in (confirms it is a genuine red case, not dead
      code) — run it once with the repo wired in to confirm the failure, then commit it in its
      correct (guard-off) red-case form.
- [x] 3.4 Add a test proving a guard-rejected auto-run's debounce claim is released without a retry
      storm: drive `PipelineSchedulerService.tick()` across several synthetic ticks after a denial,
      assert the debounce row is gone after the denying tick and no further fire attempt occurs for
      the same denied write across subsequent ticks (count claims via `PipelineAutoRunDebounceRepository`
      state and `pipeline_runs` row count, not logs).
- [x] 3.5 Run the full existing `AutoRunTriggerServiceSpec`, `PipelineSchedulerServiceSpec`,
      `PipelineRunGuardIntegrationSpec`, `DatasetWriteAutoRunEndToEndSpec`,
      `DatasetWriteAutoRunCoalescingSpec` suites to confirm no regression. Verify: `sbt test` green
      for all five plus the new specs from 3.1-3.4.

## Standing Constraints

- [C1] Models: sonnet on every role (orchestrator/executor/evaluator/skeptic/auditor) — already the
      resolved `workflow-state.md` MODELS value; no promotion needed.
- [C2] One lane: nothing else runs against this repo concurrently with this delivery. Migration
      ledger: V110 is the highest applied migration; V111 is free if this ticket needs a schema
      change (not expected per design.md's Migration Plan) — tell the coordinator before claiming it.
- [C3] `files-modified.md` must list EVERY file touched, including fixture-only test edits.
- [C4] Every `git commit` runs with Bash `timeout: 600000`; never re-run a commit while one is in
      flight; never `git add -A`.
- [C5] Budget exhaustion on any gate (evaluator cycles, skeptic rounds) is a mandatory escalation to
      the human, never a self-approval to proceed anyway.
- [C6] Ending a turn is never "waiting" — poll in-turn for sub-agent results; `ci-complete` must be
      PRESENT and SUCCESS before delivery proceeds.
- [C7] Do not change epic HEL-1091's state. Only label a decision "owner ruling" when the human
      owner actually made it, not a driver/lane inference.
- [C8] Any follow-up ticket filed from this delivery uses `origin_kind: followup`,
      `origin_ticket: HEL-1097`, `relatedTo` HEL-1097, the `Follow-up` label, and the v0.8 project
      `28f119e2-5738-46b1-a53b-42f73e06b053` (already applied to HEL-1173).
