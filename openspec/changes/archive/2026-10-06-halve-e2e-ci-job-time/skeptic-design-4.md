## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD 94e996d3006654f5f974eab36800e40712537012 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/halve-e2e-ci-time/HEL-1288`.
- **Round-3 CR1 is resolved.**
  - D3 now replays exactly `/ -> /sources -> /pipelines -> /pipelines/<id> -> /connectors -> /chat -> /settings -> /` after the seed's dashboard creation, and explicitly never `/sources/<id>`.
  - The mismatch rule is symmetric ("missing OR surplus ... make the replay match the unsplit sequence exactly, or escalate"), and it forbids adjusting a cell until the totals match.
  - Focus-presence is stated to need no replay.
  - Task 3.1 mirrors all of this.
  - All four round-3 non-blocking notes were adopted: the pre/post split goes into profile.md, cell-duration estimation is now in D4, the N>=5 plateau is noted with lever (2) preferred, and per-cell setup is estimated at 6-8 s.
- **CI baselines, re-fetched myself** with `gh run view <run> --log --job <id>` (e2e jobs 111855375384, 111810647861, 111810363019):
  - Job wall-clock: 16:00:06->16:16:26, 14:22:44->14:40:36 and 14:22:08->14:37:03.
  - Pre-test overhead (job start to `Running N tests`): 163 / 179 / 152 s. Post-test: 7 / 9 / 7 s.
  - Suite time: 13.5 / 14.8 / 12.3 m, with 149 / 149 / 145 tests. These match the Context section.
- **Per-view population lines in r1 (37337348981):**
  - Exactly 36 `[HEL-866 guard] view ...` lines and 10 `[HEL-520 focus-presence guard] view ...` lines. Every dark count equals its light count, including `command-palette` 15/15, `/settings` 25 sampled 24, and `/pipelines/<id>` 18.
  - The 18/10 cell arithmetic in D3 is correct: 2x(chrome + 7 routes + overlays) and 2x5 routes.
- **Guard source vs D3:**
  - state-surface routes are at `e2e/state-surface-contrast-guard.spec.ts` L584-592. The overlays order is palette (`/`), then modal (`/sources`), then actions-menu (`/`).
  - `assertPartitioned`'s `chromeCoverageHere` comes from `collectCandidates` on the route's own document, not from the chrome probe, so it moves into the route cell intact.
  - The failure throw and exemptions are per element. `unresolvedFraction` at L862 per cell is stricter; r1 has `unresolved=0`, and a 0-element view gives 0/max(1,0)=0.
  - focus-presence routes (L184-190) include `/sources/<id>`. Its view line is `view "${route}(${theme})"`, and `assertRouteFullyCovered` runs per view. `totalMeasured>0` (L383) becomes per-cell `>0` with a minimum of 19, which is sound.
  - focus-presence never opens the palette (no `Control+k`/`Meta+k` in the file).
  - `MAX_ELEMENTS_PER_VIEW=24` is DOM-order sampling and deterministic, so "sampled M" is comparable.
- **Cross-view state, re-derived from frontend source.**
  - `helio.recentVisits` is consumed only by `CommandPalette.tsx` via `useRecentPaletteActions` (grep across `frontend/src`).
  - Recording happens in three places:
    - `RecentVisitsRouteObserver.tsx` records only `/sources/:id` and `/pipelines/:id`.
    - `recentVisitsListeners.ts` records the dashboard on every `selectedDashboardId` null->id transition, which includes each full reload of `/`.
    - Prune runs only on a successful list fetch.
  - The unsplit dark and light palettes therefore both see the recents set {dashboard, pipeline}, and the D3 replay reproduces that set and order.
  - The other localStorage keys don't change any measured population across cells. Theme and accent are set per cell. `helio.sidebarCollapsed` is never toggled. The onboarding and first-dashboard flags are per user, and every cell is a fresh user. `helio-step-preview-open` is not written by the step-card expand toggle (`StepCard.tsx` L232-236). The unsplit run's dark==light equality corroborates this.
- **Playwright 1.55.1 scheduling** (`/home/matt/Development/helio/node_modules/playwright/lib/runner/testGroups.js`; the worktree has no node_modules, and root `package.json` pins the same `^1.55.1`):
  - Suites default to `_parallelMode="none"` (`common/test.js:45`). A `describe.configure({mode:"parallel"})` with no beforeAll/afterAll therefore has no `outerMostSequentialSuite`, and each test becomes its own group.
  - `filterForShard` assigns contiguous groups balanced by test count.
  - D3's "no beforeAll/afterAll" (avoiding `parallelWithHooks` chunking) and D4's count-based tuning are correct. No e2e file uses `describe.configure` today.
- **My own shard model** (`model.py` in my scratchpad): list-reporter durations, files sorted, contiguous count shards, 2 greedy workers. Guards split 18/10 as unsplit/n plus per-cell setup. Slowest-shard suite in seconds, runs 37324120988 / 37324205115 / 37337348981:

  | Configuration | N=3 | N=4 | N=5 | N=6 |
  |---|---|---|---|---|
  | Unsplit guards | 368 / 438 / 409 | 351 / 394 / 368 | 299 / 328 / 308 | 299 / 328 / 308 |
  | Split, 4 s setup | 268 / 310 / 287 | 222 / 254 / 234 | 198 / 229 / 210 | 198 / 229 / 210 |
  | Split, 8 s setup | 304 / 346 / 323 | 259 / 279 / 267 | 227 / 249 / 232 | 227 / 249 / 232 |

  - This confirms the design's claims that D3 and D5 are both load-bearing and that the slowest shard plateaus at N>=5.
  - **≤7 min is reachable without cutting coverage, but tight.** At N=4 with 8 s setup and today's overhead, the job is about 7.0 / 7.8 / 7.3 min. D5 must remove roughly 40-70 s, or lever (2) / N=5 is needed. The ordered levers plus C5 escalation are the correct procedure for that.
- **HEL-951 contract and `ci-complete`:**
  - The `e2e` job runs `npx playwright test` under the 9-entry `testIgnore`. `--shard` only partitions the config-collected set.
  - `ci-complete` has `needs: [frontend, backend, security, e2e]` with `if: always()` and fails on `failure`/`cancelled`. A matrix job aggregates to `failure` when any leg fails, and `fail-fast: false` keeps the other legs reporting.
  - The only upload step is `name: playwright-report`; D8 renames it per shard. The contract is kept.
- **D2:**
  - The removal bar requires one of three things: equal-or-stronger e2e coverage, no explicit or implicit assertion, or a written argument that the test makes no integration claim. Theme-dependent assertions are never collapsed.
  - Approval runs executor -> evaluator -> final skeptic, and a rejected row is restored.
  - The hel516-screenshots implicit assertions are correctly identified: the `expect.poll` at L21-28, the option click at L45 and the `waitForSelector(".help-overlay[open]")` at L69. Quarantined specs tied to open tickets are untouched.
  - The bar and the approval path are adequate.
- **Consistency checks:**
  - No TODO/TBD placeholders.
  - Proposal, design and tasks agree.
  - Every AC is covered: profile before/after (D1, tasks 1.3/5.3), counts and the removal ledger (D2, task 2.x), 3 green runs (D7, task 5.2), the post-merge median and flake rate (driver, stated plainly in D7), the shard-aware measure with `ci-complete` gating (D4), and HEL-951 (D4, C4).
  - The driver constraints (e2e-only ci.yml edits, the hel1260 spec kept, escalation over coverage cuts) are C3/C4/C5.

### Verdict: CONFIRM

### Non-blocking notes

1. **Replay readiness, and a per-run palette guarantee.** D3 describes the overlays replay as a navigation sequence only. In the unsplit run, each route was held for seconds of probing, so `RecentVisitsRouteObserver`'s pipeline entry and its persisted title (resolved asynchronously once `pipelines.items` loads) were certainly recorded before navigating on. A bare `goto` chain may leave `/pipelines/<id>` before the effect records the entry, or before the title resolves. That would intermittently show 14 instead of 15 palette rows. The one-time per-view log comparison could pass on the checked run and then drift silently afterwards. Two recommendations:
   - Gate each replay step on the same readiness signal the unsplit run had, for example `toHaveURL` plus a seeded-content marker. On `/pipelines/<id>`, poll `localStorage["helio.recentVisits"]` until the pipeline entry has a title.
   - Assert in the overlays cell that the palette's Recent rows include the seeded dashboard and pipeline before probing. That turns the equality proof into a per-run guarantee.
2. **Baseline drift.** The per-view equality baseline is main run 37337348981, at 32571b01. If the branch is rebased onto a main that has merged UI changes, a legitimate population change will read as a mismatch. In that case, compare against a green main run at the PR's actual merge-base, and record which run was used in `profile.md`.
3. **Arithmetic wording.** The Context paragraph's "~226 s (≈ 6.5 min)" uses about 4 s of per-cell setup, while D4 itself expects 6-8 s. At 8 s my model gives 259-279 s at N=4, which is about 7.0-7.8 min before D5. Restating this in `profile.md`'s plan section avoids anchoring on the optimistic number.
4. **Pinning workers.** Consider `workers: process.env.CI ? 2 : undefined`, so a future runner-size change can't silently change per-shard parallelism. Today's default (half of 4 vCPU) already gives 2.
5. **D4 lever ordering.** D4 says lever (2) beats raising N past the plateau, but still lists N first. That is fine if N is limited to 4->5, and worth stating explicitly so CI runs aren't spent on N=6.
