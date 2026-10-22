## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)
- **Spawn-cwd guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/e2e-shard-weights-slow-lane/HEL-1667`. HEAD is fb684d03b0010e030f80db62f45a2003957344a6. The worktree's only change is the untracked change dir.
- **Round-2 CR1 (AC1 pass/fail measure) is resolved by the new D7 and task 4.2.**
  - Metric: whole-leg wall time (`completedAt - startedAt` per `e2e (n)` job), with test-step time reported alongside. The design justifies this choice by timeout headroom.
  - Sample: the first N >= 3 post-merge main push runs in which all four legs succeeded.
  - Pass rule: median spread <= 120 s, with the max reported.
  - On a miss, or with too few runs, it reports NOT met / not yet measured and hands back. It never rounds a miss up to met. The PR's own run is explicitly a predictor only.
- **Round-2 non-blocking notes are folded in.** D3's concurrency now uses `cancel-in-progress: false`. D6 is still placed after D4/D5, which is cosmetic only.
- **Round-1 CRs remain addressed.**
  - AC2 evidence: D5 and task 4.1 have the orchestrator dispatch `gh workflow run e2e-slow.yml --ref main` and record the run id and the MAXIMAL log lines.
  - Stale gate text: D6 and task 2.3 limit the edit to comments and strings. The text still exists at `e2e/support/hel1582Phone.ts:396-401` and `e2e/hel1582-sweep-390.spec.ts:5-6`, so the task is still needed.
- **D4 mechanics hold against the tree.**
  - `playwright.config.ts` has `retries: 0` and no `projects`, so each file runs once with no project-level skips. With `CI` set, it writes the JSON reporter to `test-results/results.json`.
  - In `registerHeavySweeps`, the only skip is the MAXIMAL `test.skip(size.width !== 375 && HELIO_E2E_SLOW !== "1")`. So with the env var set, `skipped == 0` is a sound guard and the whole-file selection has no other skips.
  - The MAXIMAL `test.setTimeout(1_500_000)` and C8 `480_000` fit under the 30-minute job timeout at 2 workers, given about 3 min per MAXIMAL sweep.
- **D1/D2 mechanics hold.**
  - `scripts/e2e-shard.mjs:172-185` `validateRunReports` rejects on `unexpected > 0` or `flaky > 0`, as described.
  - Weights are the per-run sum, then the median across runs (l.166).
  - `check:e2e-shard:selftest`, `check:ci-complete-needs` and `check:ci-sbt-guard` all exist in `package.json`.
  - JSON artifacts have 14-day retention (ci.yml l.340/348).
- **Owner ruling (weekly) is consistent everywhere.** It appears in the proposal, in D3 (cron `17 10 * * 1`), in C1 and in the spec. Not re-litigated.
- **No defects in the artifacts.** No TBDs or placeholders, and no contradictions between proposal, design, tasks and spec. Both ACs map to tasks: AC1 to 1.x and 4.2, AC2 to 2.x, 3.3 and 4.1. Scope stays within the ticket.

### Verdict: CONFIRM

### Non-blocking notes
- D1 says the run set "must include" the newest accepted run that contains hel1681. If no accepted run contains it, the "a spec present in no accepted run keeps the median default" clause already covers that case. The executor should read "must" as "if accepted".
- GitHub `concurrency` with `cancel-in-progress: false` still replaces an older *pending* run in the same group with a newer one. That is harmless here.
- The weights for `hel1582-sweep-{390,768}` come from PR-CI runs where MAXIMAL is skipped. Don't read those rows as slow-lane cost.
