## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `482b1d79484cbd150a268af0365c1feb210b3e5a`. Diff base resolved live: `d125b654141ac79d96a8fd0f9cb5e74b834c7c0c`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/baseline-semantics-after-thinning/HEL-1285`.

### Phase 1: Spec Review — FAIL

Issues:
- **Regression to existing, CI-gated behavior coverage (blocking).** `e2e/hel1350-chart-compare-picker.spec.ts:155`
  still asserts the HEL-1350 D3 embargo: `await expect(page.getByRole("option", { name: "Previous" })).toHaveCount(0);`.
  This change re-adds "Previous" to the chart picker (ruling Q3, D5), so that spec now fails. It runs in CI, because
  the `e2e` job runs Playwright by glob and `playwright.config.ts` `testIgnore` does not exclude it. I ran it against
  this worktree's servers (DEV_PORT 6717, BACKEND_PORT 9624, `--workers=1`). Both the light and dark legs fail at
  `:155` with `unexpected value "1"`. Evidence (persisted):
  - `/home/matt/Development/helio/.concertino/runs/HEL-1285/evidence/test-results/hel1350-chart-compare-pick-2a925-ws-the-vs-7d-overlay-light-/error-context.md`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1285/evidence/test-results/hel1350-chart-compare-pick-0acd3-aws-the-vs-7d-overlay-dark-/error-context.md`

  The executor updated the Jest mirror of this assertion (`OutputEditorSheet.compare.test.tsx`) but missed the e2e
  copy. The tasks list has no item for it.
- Every other check passes:
  - **AC1:** the ruling is recorded per workflow-state (Q1–Q4).
  - **AC2:** the code matches the ruling, and one DB-backed spec thins a real fixture and asserts both the compare
    baseline and the alert baseline.
  - **AC3:** docs are updated on every existing surface: CLAUDE.md, the alerts README, both helio-mcp descriptions, the
    scaladoc and the specs. No alert UI exists.
  - The spec deltas keep every original scenario.
  - Constraints C1–C4 are honored: one shared constant, no env var, age purge first and unconditional, window compare
    code untouched, the fixed `now` at 12:04, the triggering run's point is newest, and `v: 1` plus `metric.value` plus
    `columns.amount.sum`.

### Phase 2: Code Review — PASS

Gates, all run fresh by me in `WORKTREE_PATH`:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- Root jest (`--maxWorkers=2`): 39/39 suites, 376 tests. This includes `helio-mcp/src/server.test.ts`.
- Frontend jest (`--maxWorkers=3`): 460/460 suites, 4870 tests.
- `npm --prefix frontend run build`: exit 0.
- `cd backend && sbt testFull`: 6092 succeeded, 0 failed, 4 canceled. The 4 cancellations are the pre-existing
  `HELIO_MEASURE`/timing report-only cases. The new `HistoryBaselineAfterThinningSpec` (a)–(c), age-cap and 40-day
  cases ran and passed, as did the two new `OutputHistoryRepositorySpec` HEL-1285 cases.

C3/C4 red proof, re-done independently in a throwaway detached worktree at 482b1d794 (now removed):
- **Only the `WHERE recency > $protectedNewest` line deleted.** The build compiled. 5 tests failed:
  - (a): exact survivor set.
  - (b): `Some(11:59) was not equal to Some(12:03)` at `HistoryBaselineAfterThinningSpec.scala:131`.
  - (c): `995.0 was not equal to 999.0` at `:153`.
  - The 40-day test.
  - The small-K repo test: `Purged(4) was not equal to Purged(2)` at `OutputHistoryRepositorySpec.scala:305`.

  This matches the executor's log.
- **Only `ProtectedNewestPoints = MaxRollingN` (K=100).** (a) and the 40-day test fail, and (b) and (c) pass. That is
  expected: the exact survivor set is what distinguishes 101 from 100.

The executor's logs are gitignored (`*.log`), so I persisted them:
- `/home/matt/Development/helio/.concertino/runs/HEL-1285/evidence/openspec/changes/baseline-semantics-after-thinning/red-proof/red-predicate-reverted.log`
- `/home/matt/Development/helio/.concertino/runs/HEL-1285/evidence/openspec/changes/baseline-semantics-after-thinning/red-proof/red-k100.log`

Code review:
- **SQL** (`OutputHistoryRepository.scala`):
  - The nested recency rank uses the same ordering key as `listRecent` (`captured_at DESC, id DESC`).
  - `$protectedNewest` is a bound parameter, not interpolated text.
  - Recency is computed after the age-purge DELETEs in the same transaction, which matches D2.
  - Bucket ranking runs only over unprotected rows, which matches D1/CR1.
- **Constant:** it lives in `domain/history`, and `HistoryBaseline.MaxRollingN` aliases it, so the alert validator and
  the thinner cannot drift.
- **Existing specs:** they pass `protectedNewest = 0` and keep their expectations unchanged (task 4.1/4.5/5.1). No
  expectation was weakened.
- I found no `any`, no dead code, no FQNs, and no stray TODOs.

### Phase 3: UI Review — FAIL

Servers were started via `scripts/concertino/start-servers.sh` and `assert-phase.sh servers` printed `PASS`.
UI verification used an isolated Playwright CLI run of the existing e2e (no shared MCP browser). The spec's own
`finally` deleted its created dashboard, pipeline and source by exact id.

Issues:
- The CI-gated e2e `e2e/hel1350-chart-compare-picker.spec.ts` fails at `:155` in both themes, for the reason given in
  Phase 1.
- The happy path itself works. The picker opens, it exposes "Previous" exactly once (the failure's own observed count
  is 1), and the rest of the flow up to `:155` (accessible description) passes. "Previous" persisting `previous_run` is
  covered by `OutputEditorSheet.compare.test.tsx`, which passes.
- The selector is the shared `Select` component and is unchanged, so its keyboard and a11y behavior is unchanged.

### Overall: FAIL

### Change Requests
1. Edit `e2e/hel1350-chart-compare-picker.spec.ts:155`. Replace
   `await expect(page.getByRole("option", { name: "Previous" })).toHaveCount(0);` with an assertion matching the new
   spec scenario "Choosing Previous on a chart Output persists ... listed once in the selector", for example
   `await expect(page.getByRole("option", { name: "Previous" })).toHaveCount(1);`. Update the nearby comment or test
   intent if it references the HEL-1350 D3 embargo. Leave the `:203` `not.toMatch(/previous/i)` card check alone: the
   compare there is `7d`, so it remains correct.

   Then re-run that spec in isolation against this worktree's pinned ports, and keep the passing log:
   `DEV_PORT=6717 BACKEND_PORT=9624 npx playwright test e2e/hel1350-chart-compare-picker.spec.ts --workers=1`.
   Before calling the change complete, also grep `e2e/` for any other `Previous`/`previous_run` absence assertions.
   I found none besides `:155`.

### Non-blocking Suggestions
- `frontend/src/features/pipelines/ui/outputEditor/compareOptions.ts:17`: `CHART_COMPARE_OPTIONS` is now a bare alias
  of `METRIC_COMPARE_OPTIONS`. Consider collapsing to one `COMPARE_OPTIONS` export, or keep the alias deliberately with
  the existing comment. Either is fine.
- `HistoryBaselineAfterThinningSpec` (c): in the predicate-reverted build, the `previous` assertion fails first, so the
  `rolling_avg` assertion is never shown red on its own. Asserting the `rolling_avg` baseline before `previous`, or in
  a separate test, would make each half independently failable.
- `files-modified.md` cites the red-proof `.log` files, but they are gitignored, so the branch does not carry them. The
  persisted refs above are their durable copies.
