## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### Ground truth resolution

- `BASE_SHA` resolved live via `scripts/concertino/resolve-review-base.sh` (`REVIEW_BASE_BRANCH=main`,
  `REVIEW_BASE_REMOTE=origin` from `workflow-state.md`), exit 0: `29a472205b27c51fbc75031e7bfe0790259e85b6`.
- `git diff --stat 29a47220...HEAD`: 27 files, +2400/-49, matches `files-modified.md` exactly
  (no undisclosed files, no missing ones).
- `HEAD` reviewed: `8ffec581998da5308f0475faeb506050af86f940` (checked before and after all gate
  re-runs; unchanged).

### What I verified (with evidence)

1. **AC "ten increments in two seconds -> one run" — genuinely proven, not just green.**
   Read `DatasetWriteAutoRunCoalescingSpec.scala` in full: 3.2 seeds 10 `triggerAutoRun` calls over
   a 1.8s `FakeClock` window, asserts `runCount == 0` before the debounce elapses, then `== 1`
   after. 3.3 (the mutation-proving red case) submits the *same* 10 calls directly through
   `PipelineRunService.submit`, bypassing the debounce table entirely, and asserts `runCount == 10`
   — this is a real, deliberately-broken control that demonstrates 3.2's "1" isn't a trivial/always
   -1 counting artifact. 3.4 runs two independent `AutoRunTriggerService`/`PipelineSchedulerService`
   pairs sharing one embedded-Postgres DB, interleaves 10 writes across both, then calls
   `Future.sequence(Seq(schedulerA.tick(), schedulerB.tick()))` — both ticks race the same
   `claimDue` `UPDATE ... RETURNING`, and `runCount` is still 1. I re-ran all three specs fresh
   (see gate re-run below) — pass.
2. **Cross-instance exclusivity is a real atomicity proof, not luck.** `PipelineAutoRunDebounceRepository
   .claimDue` (`.scala:52-61`) is a single `UPDATE pipeline_auto_run_debounce SET claimed_at = ?
   WHERE fire_at <= ? AND (claimed_at IS NULL OR claimed_at < ?) RETURNING ...` — Postgres row-locks
   serialize concurrent claims on the same `pipeline_id`, and `PipelineAutoRunDebounceRepositorySpec`
   ("does not re-claim a row whose existing claim is fresh") isolates this directly against two
   sequential `claimDue` calls, independent of Scala-level thread interleaving.
3. **Design-gate round-1 fix (`PipelineCostInputGathering`, caller-supplied `resolveRoot`) —
   verified correct in the shipped code, not just claimed.** Read `PipelineCostInputGathering.scala`,
   `AutoRunTriggerService.scala`, and the `PipelineService.scala` diff line-by-line:
   `AutoRunTriggerService.evaluateAndSchedule` passes `resolveRoot = dataSourceRepo.findByIdInternal`
   (privileged, no ACL) while `PipelineService.analyze` passes `dsId =>
   dataSourceRepo.findByIdOwned(dsId, user)` (unchanged, ACL-scoped to the requesting user) — the
   `analyze` refactor is behavior-preserving (same `CostInput` assembly, `hasSourceUrl` moved
   verbatim). `AutoRunTriggerServiceSpec`'s 3.10 test constructs a real two-root pipeline with roots
   owned by two *different* seeded users and asserts `autoRunnable` still schedules a debounce row
   — this is the actual multi-root, mixed-ownership scenario the round-1 REFUTE was about, not a
   hypothetical. The class has no `AuthenticatedUser` in its signature at all, so a regression back
   to writer-scoped resolution isn't just untested, it's structurally blocked.
4. **HEL-505 integration + owner-attribution — verified in both code and a mutation-sensitive
   test.** `PipelineRunService.submit`'s guard call is `pipelineRunGuardRepo.incrementRateIfUnderLimit
   (user.id, ...)` (`.scala:964`) — keyed on the `AuthenticatedUser` passed in. `PipelineSchedulerService
   .fireAutoRun` constructs `AuthenticatedUser(pipeline.ownerId, source = AuditSource.System, tokenId
   = None)` and passes it as `submit`'s `user` — so an auto-run's rate-limit key is always the
   pipeline owner, never the writer. `DatasetWriteAutoRunEndToEndSpec`'s owner-attribution test is
   real, not decorative: it pre-exhausts the *owner's* rate limit (limit=1, one direct submission),
   then has a *different, non-owning* writer append to their own dataset (a root the writer owns on
   a pipeline owned by someone else) — if attribution were writer-scoped, the writer's fresh budget
   would let the auto-run through and `runCount` would hit 2; it stays at 1. I re-ran this spec
   fresh — pass.
5. **RLS FORCE pattern on V110 — verified byte-for-byte against V62, and the RLS probe is real.**
   `V110__pipeline_auto_run_debounce.sql`'s `ENABLE`/`FORCE ROW LEVEL SECURITY` + indirect-owner
   `EXISTS (SELECT 1 FROM pipelines p WHERE p.id = ... AND p.owner_id = current_setting(...))`
   policy is structurally identical to V62's `pipeline_schedules` pattern (correct choice per
   design.md's stated reasoning: the debounce table's writer and the pipeline owner can differ).
   `PipelineAutoRunDebounceRepositorySpec`'s RLS test uses a genuine dual-pool harness (`helio_app_test`,
   non-superuser role) — a non-owning user's app-pool query returns zero rows for another owner's
   debounce row, and the same query over the privileged pool confirms the row does exist (ruling out
   "the row is just missing" as an alternative explanation). `RlsPolicyGuardSpec`'s allowlist was
   updated. I re-ran this spec fresh — pass.
6. **Migration ledger — verified V110 is genuinely the highest, no gap/collision.**
   `ls backend/src/main/resources/db/migration/ | sort -V | tail -5` → ...V108, V109, V110, nothing
   after. Fresh `sbt test` run's Flyway log: "Successfully applied 110 migrations ... now at version
   v110" — no skipped/out-of-order warning.
7. **Non-cascade guarantee — verified mechanically, not just asserted.** `grep -rn applyWriteBacks
   backend/src/main/scala` shows exactly one call site, `PipelineRunService.scala:1244`, entirely
   separate from `DataSourceService`'s five row-mutation methods (`appendRows`/`appendFormRow`/
   `replaceRows`/`patchRow`/`deleteRow`) — I read the full diff of `DataSourceService.scala` and
   confirmed `triggerAutoRun(id)` is wired into exactly those five methods' successful-write branch,
   and nowhere else. `applyWriteBacks` therefore cannot reach `AutoRunTriggerService` by construction,
   not by a special-case guard. `AutoRunTriggerServiceSpec`'s 3.8 test additionally calls
   `dataSourceRepo.applyWriteBacks` directly (the real write-back code path) and confirms no debounce
   row appears for a downstream reader — a real regression guard, even though (as the evaluator also
   noted) it can't be independently mutation-tested without literally adding a call that doesn't
   exist in the source.
8. **Standing Constraint C1 (DB-backed, globally-exclusive debounce, fired by the existing scheduler
   tick, no dedicated new timer) — verified honored.** `grep`'d the full backend diff for new
   `Actor`/`Timer`/`.schedule(` additions — none. `PipelineSchedulerService.tick()` gained
   `processAutoRunDebounce` as one more `Future` zipped alongside the existing `candidatesWork`/
   `cleanupWork`, on the SAME tick cadence (`SCHEDULER_TICK_INTERVAL_SECONDS`). `Main.scala`
   constructs one `PipelineAutoRunDebounceRepository` instance and threads the same instance into
   both `ApiRoutes` (write path) and `PipelineSchedulerService` (fire path) — correctly mirrors
   `pipelineRunGuardRepo`'s existing single-shared-instance convention. No new REST endpoint, no new
   poller.

### Gates (freshly re-run by me, this review, in `WORKTREE_PATH`)

- Targeted spec run (`AutoRunTriggerServiceSpec`, `DatasetWriteAutoRunCoalescingSpec`,
  `DatasetWriteAutoRunEndToEndSpec`, `PipelineAutoRunDebounceRepositorySpec`,
  `RlsPolicyGuardSpec`, `PipelineSchedulerServiceSpec`):
  `[info] Total number of tests run: 135` / `[info] Tests: succeeded 135, failed 0, canceled 0` —
  0 failures, exit 0.
- Full `cd backend && HEL924_TEST_GROUP_CONCURRENCY=3 sbt test`: `[info] Total number of tests run:
  4764` / `[info] Suites: completed 321, aborted 0` / `[info] Tests: succeeded 4764, failed 0,
  canceled 0` / `[success] Total time: 301 s` — matches the evaluator's reported number exactly,
  independently reproduced (fresh run, not trusted from the evaluator's report).
- `npm run check:openspec` — clean (`openspec/ is clean`).
- `npm run check:schemas` — clean (`schemas in sync with JsonProtocols (100 checked across 50
  protocol files)`).
- `npm run check:scala-quality` — clean (182 pre-existing informational soft-budget warnings; the
  new/touched files add none beyond informational).
- No `frontend/**` files in the diff (confirmed via `git diff --stat`) — frontend gates correctly
  not applicable; skipped per the trigger rule, and I did not need a browser/UI walkthrough since
  this ticket has no user-visible surface (confirmed: `ApiRoutes.scala`'s only change is internal DI
  wiring — new nullable constructor param, `autoRunTriggerServiceOpt` derivation — no route added/
  removed/reshaped; `ApiRoutesSpec`/`ApiRoutesCorsErrorHandlingSpec`/`ApiRoutesPipelineRunGuardSpec`
  all pass as part of the full suite above).

### Ticket AC trace

- "Ten increments in two seconds produce one run, not ten" → `DatasetWriteAutoRunCoalescingSpec`
  3.2 (green) + 3.3 (red control) + 3.4 (cross-instance), all re-run fresh, all pass. Traced above.

### Design/tasks fidelity

- Every Decision in `design.md` (1-5) checked against the shipped code line-by-line: the V110 SQL,
  `upsertDebounce`/`claimDue`/`releaseClaim` SQL, the `PipelineSchedulerService.tick()` wiring, and
  the `PipelineCostInputGathering` extraction all match verbatim, including the specific
  compare-and-delete rationale in `releaseClaim`'s doc comment (the exact bug an unconditional
  DELETE would introduce is correctly avoided).
- All `tasks.md` items (1.1-3.10) verified against the diff item-by-item; none are stale-marked-done.

### Verdict: CONFIRM

### Non-blocking notes

- The evaluator's flagged stale-doc-comment item (design-gate round 2's own non-blocking note) is
  still unaddressed: `DataSourceRepository.findByIdInternal`'s "Permitted callers" list and
  `countDatasetRows`'s doc comment ("ACL is enforced earlier... via `findByIdOwned`") don't yet name
  the new privileged `AutoRunTriggerService`/`PipelineCostInputGathering` caller. Confirmed both are
  still stale as written (read `DataSourceRepository.scala:135-165` directly). Not a functional
  defect — both methods are already privileged/ACL-free at the query level — but worth a small
  follow-up so the comments don't mislead a future reader. The skeptic-design-2 gate itself already
  characterized this as non-blocking; I agree with that characterization and am not re-litigating it
  as a blocker here.
- `PipelineService.analyze`'s refactored `gather` call re-derives root-list resolution + dataset-row
  counts rather than reusing `rootDsOpts` already computed earlier in the same `analyze` call — a
  modest extra DB round-trip, deliberately traded for the shared helper's self-contained contract.
  Not worth blocking; flagged only as a possible follow-up if `analyze` call volume ever becomes
  latency-sensitive.

No gate defect to report: the evidence I relied on (fresh gate re-runs, line-by-line code reads, the
BASE_SHA resolved live via the canonical script) is self-authenticating — command output, diffed
source, and reproduced test counts — not an mtime-ordering or positional inference from a
prior-round's evidence directory.
