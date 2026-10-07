## Evaluation Report — Cycle 2 (evaluation-2.md)

**Commit reviewed:** HEAD `b871f80fe85d4fe65d2b0547b5c800476763840a`.

**Diff base:** resolved live as `d125b654141ac79d96a8fd0f9cb5e74b834c7c0c`.

**Incremental diff:** I reviewed `482b1d794..b871f80fe` against the full branch diff. It touches four files:
- `e2e/hel1350-chart-compare-picker.spec.ts`
- `HistoryBaselineAfterThinningSpec.scala`
- `files-modified.md`
- `evaluation-1.md`

**Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/baseline-semantics-after-thinning/HEL-1285`.

**Backend main sources:** unchanged since cycle 1. `git diff 482b1d794..HEAD -- backend/src/main` is empty. I re-ran `sbt testFull` anyway, because `backend/**` (test) changed.

### Phase 1: Spec Review — PASS
Issues: none.
- **Cycle 1 CR1 is resolved.** `e2e/hel1350-chart-compare-picker.spec.ts:155-156` now asserts that the "Previous" option appears exactly once (`toHaveCount(1)`), with a HEL-1285 comment. This matches the "Choosing Previous on a chart Output persists ... listed once" scenario in the chart-history-overlay delta. Line `:203` is untouched; it is still correct because that test uses `7d`.
- The cycle 1 findings still hold for every other item:
  - Acceptance criteria 1–3 are met.
  - Constraints C1–C4 are honored.
  - The spec deltas keep every original scenario.

### Phase 2: Code Review — PASS
I ran every gate fresh this cycle:
- `npm run lint` (eslint, zero warnings): exit 0.
- `npm run format:check` (prettier): exit 0.
- `sbt testFull`: 6093 succeeded, 0 failed, 4 canceled. The 4 cancellations are the pre-existing `HELIO_MEASURE`/timing report-only cases. The count is up 1 from cycle 1 because of the (c) split.
  - (a), (b), (c1) and (c2) all ran and passed.

Frontend sources are byte-identical to cycle 1: `git diff 482b1d794..HEAD -- frontend helio-mcp` is empty. The cycle 1 results therefore still apply to this tree:
- Root jest: 376 tests.
- Frontend jest: 4870 tests.
- `npm --prefix frontend run build`: passed.

**Red proof for the split (c).** I re-ran it independently in a throwaway detached worktree at b871f80fe, which I have since removed. The only change was deleting the `WHERE recency > $protectedNewest` line, and the build compiled. 5 tests failed:
- (a): exact survivor set.
- (b): `Some(11:59) was not equal to Some(12:03)`.
- (c1): `995.0 was not equal to 999.0` at `:152`.
- (c2): `NoSuchElementException: None.get`. With the reverted SQL, about 22 eligible points remain, below `n = 100`, so no baseline is computed and no event is persisted.
- The 40-day test.

Each alert half is now independently failable. This matches the executor's log, persisted at:
`/home/matt/Development/helio/.concertino/runs/HEL-1285/evidence/openspec/changes/baseline-semantics-after-thinning/red-proof/red-predicate-reverted-split-c.log`

**Test refactor.** The `alertBaseline` helper inserts one rule, evaluates it, and reads that rule's persisted event. A second evaluation in (c2) also re-evaluates the (c1) rule. That does not affect (c2)'s assertion, which reads by its own rule id.

### Phase 3: UI Review — PASS
- **Servers:** `start-servers.sh` reused healthy servers on 6717/9624, and `assert-phase.sh servers` printed `PASS`.
- **e2e run:** I ran `e2e/hel1350-chart-compare-picker.spec.ts` in isolation with the Playwright CLI and `--workers=1`. This was not the shared MCP browser. Result: **2 passed** (light and dark).
  - The picker exposes "Previous" exactly once.
  - Choosing "7 days" saves `compare: "7d"`.
  - The dashboard draws "vs 7d" with no full reload.
  - The spec's own `finally` deleted its created dashboards, pipelines and sources by exact id.
- **Persistence:** "Previous" persisting `previous_run` is covered by `OutputEditorSheet.compare.test.tsx`, which passes.
- **Worktree state:** `e2e-evidence/` is gitignored, and `git status` is clean.
- **Executor's pass log**, persisted at: `/home/matt/Development/helio/.concertino/runs/HEL-1285/evidence/openspec/changes/baseline-semantics-after-thinning/red-proof/e2e-hel1350-pass.log`

### Overall: PASS

### Non-blocking Suggestions
- `frontend/src/features/pipelines/ui/outputEditor/compareOptions.ts:17`: `CHART_COMPARE_OPTIONS` is now a bare alias of `METRIC_COMPARE_OPTIONS`. Collapsing them is optional.
- The red-proof `.log` files are gitignored, so they are not on the branch. Durable copies are at the persisted refs above.
