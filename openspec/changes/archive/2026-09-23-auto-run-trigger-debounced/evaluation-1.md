## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- All ticket ACs addressed explicitly:
  - Ten increments in two seconds -> one run (headline AC) proven with a failable probe
    (`DatasetWriteAutoRunCoalescingSpec` 3.2), counted from `pipeline_runs`, never log lines, with
    a genuine mutation-proving red case (3.3, see Phase 2 for verification detail).
  - Only `autoRunnable` pipelines run; denial reason is logged, never swallowed
    (`AutoRunTriggerService.evaluateAndSchedule`, `AutoRunTriggerServiceSpec` 3.1).
  - Every auto-run enters through `PipelineRunService.submit` with `TriggerSource.AutoRun`
    (`PipelineSchedulerService.fireAutoRun`), subject to HEL-505's guards; a guard rejection is
    logged, never silently dropped (3.7).
  - Run ownership is the pipeline owner via a synthetic `AuthenticatedUser`, mirroring HEL-1108's
    precedent exactly; owner-attribution is proven with a mutation-sensitive negative test (3.6) —
    a wrong (writer-scoped) attribution would flip the assertion to a false positive.
  - The debounce is DB-backed and global (V110 `pipeline_auto_run_debounce`), fired by the existing
    `PipelineSchedulerService` tick — no new timer. Cross-instance exclusivity is proven via
    `claimDue`'s atomic `UPDATE ... RETURNING` (see Phase 2 for the concurrency-test analysis).
- No AC silently reinterpreted; no scope creep. The `PipelineService.analyze` refactor
  (`PipelineCostInputGathering`) is in-scope: it is the design-gate round-1 REFUTE fix (Decision
  2a), not a drive-by change, and both design.md and tasks.md 1.5 call it out explicitly.
- All `tasks.md` items are marked done and match what was implemented — verified item-by-item
  against the diff (migration, repos, services, wiring, all ten test items).
- No regressions to existing behavior: the full `sbt test` suite (4764 tests, 321 suites) passes
  clean, including the pre-existing `analyze`-path specs (`PipelineAnalyzeAnalyzeWithAiSpec`,
  `PipelineAnalyzeConvertFormatSpec`, etc.) that exercise the refactored gathering code.
- No API/schema contract change — confirmed: `npm run check:schemas` passes clean, and the diff
  touches no route definition, only internal DI wiring in `ApiRoutes.scala`/`Main.scala`.
- Planning artifacts (design.md, tasks.md, spec.md) reflect the final implemented behavior; spot
  checks below (Phase 2) confirm the code matches design.md's SQL/logic verbatim in every
  Decision.
- `workflow-state.md`'s one non-retired constraint (C1: DB-backed, globally-exclusive debounce
  fired by the existing scheduler tick, no dedicated timer) is honored: V110/`claimDue`/`tick()`
  piggybacking all match, verified directly against code (Phase 2).

One item flagged at the design gate (round 2, non-blocking note) was not carried into the
implementation — see Non-blocking Suggestions below; it does not affect this verdict since the
skeptic itself characterized it as non-blocking.

### Phase 2: Code Review — PASS

Issues: none blocking. Two non-blocking observations noted below.

**Gates (freshly run, this review, in `WORKTREE_PATH`):**
- `npm run check:scala-quality` — clean (182 pre-existing informational file-size warnings; the
  two new/touched test files at 282 lines are within the "informational only" file-size-warning
  band, not a hard failure).
- `npm run check:openspec` — clean.
- `npm run check:schemas` — clean (100 protocol surfaces checked, no drift).
- `cd backend && sbt test` (full suite, `HEL924_TEST_GROUP_CONCURRENCY=3`) — **4764 tests, 321
  suites, 0 failures**, ~5 minutes. Includes every new spec (`PipelineAutoRunDebounceRepositorySpec`,
  `AutoRunTriggerServiceSpec`, `DatasetWriteAutoRunCoalescingSpec`, `DatasetWriteAutoRunEndToEndSpec`)
  and every pre-existing spec this diff touches (`PipelineService.analyze`'s specs,
  `RlsPolicyGuardSpec`, `PipelineSchedulerServiceSpec`).
- No `frontend/**` files changed — frontend gates (`lint`/`format:check`/`test`/`build`) not
  applicable per the trigger rule.

**Targeted findings from the tickets's own flagged risk surface, verified directly against code:**

1. **Cross-instance exclusivity test (tasks.md 3.4) — verified genuine, not accidentally
   serialized.** `DatasetWriteAutoRunCoalescingSpec`'s cross-instance test kicks off
   `schedulerA.tick()` and `schedulerB.tick()` via `Future.sequence`, backed by a 20-connection
   Slick pool and `ExecutionContext.global` — the identical concurrency-proof pattern this
   codebase already uses for HEL-505's own concurrency-cap test
   (`PipelineRunGuardRepositorySpec` line 168, `Future.sequence(Vector.fill(attempts)(...))`),
   which has already survived adversarial review. The atomicity itself is *not* proven by this
   Scala-level concurrency alone but by `claimDue`'s SQL: a single `UPDATE ... RETURNING`
   (`PipelineAutoRunDebounceRepository.scala:52-61`) that Postgres serializes per matched row — a
   genuinely exclusive primitive regardless of whether the two Scala calls happen to interleave.
   `PipelineAutoRunDebounceRepositorySpec`'s narrower "does not re-claim a row whose existing
   claim is fresh" unit test (lines 186-197) isolates and proves this exclusivity directly against
   two sequential `claimDue` calls, independent of any threading/interleaving question — this is
   the load-bearing proof of atomicity; the cross-instance spec additionally demonstrates the
   full write-time+fire-time flow holds under real concurrent Scala/JDBC use. Together these are a
   sound proof of the ticket's exclusivity bar, not "eventually one row" by luck.

2. **Mutation-proving RED case (tasks.md 3.3) — verified genuinely red.** The same ten calls,
   submitted directly via `runService.submit(pid, isDry = false, user)` (bypassing
   `AutoRunTriggerService`/the debounce table entirely), produce ten `pipeline_runs` rows.
   Confirmed this isn't confounded by HEL-505's guard: `newRunService()` in this spec constructs
   `PipelineRunService` without `pipelineRunGuardRepo` (defaults to `null`,
   `PipelineRunService.scala:88`), which the `submit` path checks and skips entirely when null
   (`PipelineRunService.scala:963`) — so all ten submissions succeed unconditionally, isolating
   the debounce-coalescing behavior under test from the unrelated rate/concurrency guard (which is
   separately, correctly tested in `DatasetWriteAutoRunEndToEndSpec` 3.6/3.7). This is a real red
   case: removing the debounce indirection demonstrably produces the AC-violating 10-row outcome
   the ticket's AC calls out by name.

3. **`PipelineCostInputGathering` (task 1.5, design-gate round-1 fix) — verified correct.**
   `AutoRunTriggerService` passes `resolveRoot = dataSourceRepo.findByIdInternal` (privileged,
   `AutoRunTriggerService.scala:69`); `PipelineService.analyze` passes
   `resolveRoot = dsId => dataSourceRepo.findByIdOwned(dsId, user)` (`PipelineService.scala`, the
   `costInputGathering.gather(...)` call site) — byte-for-byte the same ACL-scoped resolution
   `analyze` performed inline before the extraction. Diffed `analyze` end-to-end: the refactor is
   behavior-preserving (same `CostInput` assembly, same `hasSourceUrl` per-kind logic moved
   verbatim into the shared object, same `costVerdict`/response construction after the
   extraction). Confirmed with the full `analyze`-path spec suite passing unchanged.
   `AutoRunTriggerServiceSpec`'s 3.10 test is a real, structurally-guaranteed red-case guard: the
   class has no `AuthenticatedUser` in its own signature at all, so a regression back to a
   writer-scoped resolver is not just untested but requires re-introducing a parameter that
   doesn't exist today.
   - *Minor DRY/perf note (non-blocking, see below):* the refactored `analyze` call site
     re-derives root-list resolution + `countDatasetRows` a second time via `gather`, rather than
     reusing the `rootDsOpts`/dataset-row-count values already computed earlier in the same
     `analyze` call for the schema-drift computation (`PipelineService.scala` ~955-965). This is a
     deliberate, documented tradeoff (the diff's own comment: "the shared helper's contract is
     deliberately self-contained") for a modest extra DB round-trip on an already-multi-query
     endpoint — not a correctness issue, flagged only as a possible follow-up.

4. **V110 RLS pattern — verified byte-for-byte matches V62, not V109.** Diffed
   `V110__pipeline_auto_run_debounce.sql` against `V62__pipeline_schedules.sql`: identical
   `FORCE ROW LEVEL SECURITY` + indirect-owner `USING (EXISTS (SELECT 1 FROM pipelines p WHERE
   p.id = ... AND p.owner_id = current_setting('app.current_user_id')::uuid))` policy shape.
   Confirmed this is the correct choice per design.md's own reasoning (the table's writer and the
   pipeline owner can differ) — genuinely distinct from V109's direct `user_id`-keyed pattern.
   `RlsPolicyGuardSpec` allowlist updated; the dedicated RLS probe
   (`PipelineAutoRunDebounceRepositorySpec`, "RLS (HEL-1093 tasks.md 3.5)") proves FORCE RLS is
   actually in effect with both a negative (non-owner sees zero rows over the app pool) and a
   positive control (privileged pool sees the row regardless).

5. **`TriggerSource.AutoRun` / `pipeline_runs_trigger_source_check` widening — verified.**
   `TriggerSource.AutoRun = "auto-run"` added (`PipelineRunService.scala`); V110 drops and
   re-adds the CHECK constraint to admit it, exactly matching design.md Decision 1. Plumbed
   correctly end to end: `PipelineSchedulerService.fireAutoRun` passes
   `triggerSource = TriggerSource.AutoRun` into `submit`.

6. **Migration ledger — verified V110 is the actual highest migration, no collision.**
   `ls backend/src/main/resources/db/migration/ | sort -V | tail` confirms `V110` is the newest
   file with no gap; Flyway's own migrate log (both targeted and full test runs) shows "Successfully
   applied 110 migrations ... now at version v110" with no out-of-order or skipped-version warning.

7. **Latency arithmetic — verified against real config, not just asserted.**
   `DATASET_WRITE_DEBOUNCE_SECONDS` defaults to `5` (`AutoRunTriggerService.DefaultDebounceSeconds`)
   and `SCHEDULER_TICK_INTERVAL_SECONDS`/`helio.scheduler.tick-interval-seconds` defaults to `30`
   (`application.conf:139`) — 5s + 30s = 35s, matching the executor's reported production
   worst-case exactly. The real measured number (`DatasetWriteAutoRunEndToEndSpec` 3.9) uses a 1s
   configured debounce with fast local polling and asserts `elapsed >= 1000ms` while printing the
   actual observed value for the record — consistent with the "~1075-1080ms" figure reported to
   the orchestrator.

**CONTRIBUTING.md compliance:** no inline FQNs found in the diff (imports are all top-of-file);
no dead code/TODOs; file-size soft budgets are informational-only per the gate's own output and
none of this diff's files are a *new* hard-budget violation (the two touched large pre-existing
files, `PipelineService.scala`/`DataSourceService.scala`, were already over budget before this
change and this diff's net addition to each is small). Comments follow the hazard/contract/why
convention throughout (e.g., `PipelineAutoRunDebounceRepository.releaseClaim`'s doc explaining
exactly why an unconditional DELETE would be wrong). Nullable-optional DI wiring
(`autoRunDebounceRepo`/`autoRunTriggerService` defaulting to `null`) mirrors this codebase's own
established convention (`pipelineRunGuardRepo`, `auditService`) rather than inventing a new
pattern.

### Phase 3: UI Review — PASS (limited applicability)

Issues: none.

No `frontend/**` files changed; `ApiRoutes.scala` changed but only for internal DI wiring (new
constructor param + private `Option`-derived service instantiation) — no route/endpoint added,
removed, or reshaped, consistent with the ticket's own "No REST contract change" claim (verified:
`check:schemas` clean, no protocol/route diff). Ran the dev-server smoke check anyway since
`ApiRoutes.scala` is in the trigger list:

- Started servers via `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` — both
  healthy.
- Loaded the app (Dashboards, Data Sources, Data Pipelines pages) in a real browser — zero console
  errors/warnings at every navigation.
- Confirmed `GET /api/auth/me`, `/api/dashboards`, `/api/data-sources`, `/api/pipelines` all
  return `200` — proves the `ApiRoutes` constructor's new DI graph (the `autoRunTriggerServiceOpt`
  `for`-comprehension, `dataSourceService`'s new final constructor arg) wires and boots correctly
  against a real server, not just under test doubles.

No dedicated UI walkthrough of the counter/form-panel submit flow was performed beyond this: the
feature has no user-visible surface of its own (this ticket is a backend-only automatic trigger),
and the exact production `DataSourceService.appendRows`/`appendFormRow` write path is already
exercised end-to-end against a real embedded Postgres by
`DatasetWriteAutoRunEndToEndSpec`'s "write-time wiring" test, which is stronger evidence for this
specific path than a manual UI click-through would add.

### Overall: PASS

### Non-blocking Suggestions

1. **Stale doc comments not updated per the design-gate's own round-2 non-blocking note.**
   `skeptic-design-2.md`'s non-blocking notes flagged that
   `DataSourceRepository.findByIdInternal`'s "Permitted callers" list
   (`backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala:135-141`)
   and `countDatasetRows`'s doc comment
   (`backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala:161-165`,
   "ACL is enforced earlier, by the caller resolving `ids` via `findByIdOwned` in the first
   place") should be updated alongside this ticket, since `PipelineCostInputGathering`/
   `AutoRunTriggerService` is a new privileged caller that doesn't fit either statement as written
   (the auto-run path resolves via `findByIdInternal`, not `findByIdOwned`). Neither method's
   actual behavior is wrong — both are already privileged/ACL-free at the query level — but the
   comments now describe an invariant that is no longer universally true, which is exactly the
   kind of comment CONTRIBUTING.md's "contracts" guidance warns a future reader can be misled by.
   Recommend a small follow-up: add `PipelineCostInputGathering`/`AutoRunTriggerService` to
   `findByIdInternal`'s permitted-callers list, and soften `countDatasetRows`'s comment to note
   the auto-run path's own privileged resolution instead of asserting `findByIdOwned` always ran
   first.
2. **`PipelineService.analyze`'s refactored `CostInput` gathering re-derives root resolution +
   dataset-row counts** rather than reusing the `rootDsOpts` already computed earlier in the same
   `analyze` call (see Phase 2, item 3) — a small extra DB round-trip per `analyze` invocation,
   deliberately traded for the shared helper's self-contained contract. Worth a follow-up if
   `analyze`'s call volume ever becomes latency-sensitive; not worth blocking this ticket over.
