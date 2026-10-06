## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 94e996d3006654f5f974eab36800e40712537012. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/halve-e2e-ci-time/HEL-1288`.
- **Round-2 CRs:**
  - CR2 (D2 class (b) covers implicit assertions; hel516-screenshots exemplar corrected) is fully addressed. D2(b) now includes `expect.poll`/`expect.soft` and implicit `waitForSelector`/`waitForURL` and role-located actions. hel516-shots is explicitly routed through (a)/(c). Every (a)/(b)/(c) row needs final-skeptic confirmation, and a rejected row is restored.
  - CR1 (state replay, per-view comparison, mismatch rule) is addressed in structure. One factual error in the replay instruction remains; see the Change Request.
  - The round-2 non-blocking notes (static titles, 18/10 cell counts, ≤120 s per-cell budget) are all adopted.
- **Baseline logs re-fetched** (`gh run view <run> --log --job <id>` for 111855375384, 111810647861 and 111810363019):
  - Pre-test overhead (job start to `Running … tests`) is 163 s, 179 s and 152 s.
  - Post-test (suite end to the last log line) is about 8–10 s. The design's "≈3.1 min total, the rest post-test teardown" overstates the post-test part (non-blocking).
- **Per-view lines in r1 (37337348981):**
  - 36 `[HEL-866 guard] view …` lines: 2 themes × (chrome + 7 routes × {sidebar-rail, main} + 3 overlays).
  - 10 `[HEL-520 focus-presence guard] view …` lines.
  - These match D3. Every dark count equals its light count, including `command-palette` = 15 in both themes. Within the unsplit run, accumulated cross-view state changes no view's population, apart from what the replay covers.
- **D3 cell definitions match the source:**
  - state-surface routes (L584–592) are `/`, `/sources`, `/pipelines`, `/pipelines/${id}`, `/connectors`, `/chat`, `/settings`. That is 7 routes, so 18 cells.
  - focus-presence routes are `/`, `/sources`, `/sources/${id}`, `/pipelines/${id}`, `/settings`. That is 5 routes, so 10 cells.
  - `probeView` forces pseudo-states over CDP and never clicks. Only the seed, the asserted step-card toggle (L656–659) and the overlay open/Escape actions mutate state. All of them stay inside their own cell.
- **D3 assertion mappings, re-checked:**
  - `chromeCoverageHere` (L686–691) is collected on the route's own document.
  - L862 `unresolvedFraction` per cell is stricter, and baseline `unresolved=0` everywhere.
  - L383 `totalMeasured > 0` per cell is consistent: the minimum measured per view is 19.
  - Failure/exemption paths are per element.
  - The mappings are sound.
- **Cross-view state.** The only cross-route persisted state consumed by a measured view is `helio.recentVisits` (`RECENT_HISTORY_STORAGE_KEY`, `recentHistoryStore.ts:32`). It is consumed only by the palette (`CommandPalette.tsx` L127–131 via `useRecentPaletteActions`). The other localStorage keys are listed below; none feeds a measured view in a way the per-cell seed does not reproduce:
  - theme and accent, set per cell;
  - `helio.sidebarCollapsed`, never toggled by the guards;
  - the per-user onboarding and first-dashboard flags, which are per user, so each cell's fresh user reproduces them;
  - step-card preview, never clicked.
- **Recents recording.** `RecentVisitsRouteObserver.tsx` records only on arrival at `/sources/:id` or `/pipelines/:id`. `recentVisitsListeners.ts` records a dashboard on a `selectedDashboardId` transition, which the seed's dashboard creation triggers. `/sources` does not auto-navigate to a detail page: `AppRoutes.tsx:112–113` has sibling routes, and `SourceListTable.tsx:107` navigates only on click. The unsplit guard also asserts `toHaveURL(/sources$/)` at L638.
- **D4 sharding (Playwright 1.55.1, `node_modules/playwright/lib/runner/testGroups.js` L95–112).** `filterForShard` assigns groups contiguously, balanced by test count. Files are sorted by name (`projectUtils.js:192`).
  - I re-modelled independently on all three baseline logs: count-based contiguous shards, 2 greedy workers per shard, guards split 18/10 with +4 s setup per cell. Slowest-shard suite, unsplit vs split:

    | N | unsplit | split |
    |---|---|---|
    | 4 | 368/394/351 s | 234/254/222 s |
    | 5 | — | 210/229/198 s |
    | 6 | — | 210/229/198 s (plateau) |

  - The N≥5 plateau has a cause. The 18 state-surface cells sort to the tail and stay together in the last shard (about 196 s). The early shard holding the focus-presence cells is about 210 s.
  - Projected slowest-shard job at N=4, without D5: about 6.5–7.4 min. With D5's 30–60 s it is about 5.9–6.9 min.
  - **≤ 7 min is reachable without cutting coverage, but tight.** D3 and D5 are both load-bearing, exactly as the design states. The ≤ 6.5 min PR target, the ordered levers (N, a proven-isolated parallel file, then escalation) and the ban on reordering files are the correct tuning procedure for this algorithm.
- **HEL-951 and `ci-complete`:**
  - The `e2e` job runs `npx playwright test`, with `testIgnore` in `playwright.config.ts` (8 entries). `--shard` filters the config-collected suite and hand-picks nothing.
  - `ci-complete` gates on the aggregated matrix result with `fail-fast: false`.
  - The only upload step is `name: playwright-report`, which D8 renames per shard.
  - The contract is kept.
- **D2 removal bar and approval path** are adequate:
  - Each removal needs equal-or-stronger integration-level coverage, no assertion of any kind, or a written argument that it makes no integration claim.
  - Theme-dependent assertions are never collapsed.
  - Rows go executor → evaluator → final skeptic, and a rejected row is restored.
  - Quarantined specs tied to open tickets are untouched.

### Verdict: REFUTE

A single defect remains. It is in the cross-view state replay instruction this round was meant to settle. Followed literally, the instruction reproduces a state the unsplit run never had. The mismatch rule that should catch this only names one direction.

### Change Requests

1. **D3 "Cross-view state" (and task 3.1): fix the replay target and make the mismatch rule symmetric.**
   - **The error.** The design says the `overlays` cell replays "at least visiting the seeded `/sources/<id>` and `/pipelines/<id>` in the original order". The unsplit state-surface guard **never visits `/sources/<id>`**: its route list at `e2e/state-surface-contrast-guard.spec.ts` L584–592 has no source-detail route, and `/sources` never auto-navigates to a detail page.
   - **Why it matters.** `RecentVisitsRouteObserver.tsx` records a `source` recent on arrival at `/sources/:id`. `CommandPalette.tsx` L130–131 prepends recents to the empty-query list. A replay that visits `/sources/<id>` therefore adds a recent the unsplit run never had. That changes the `command-palette` population, which is 15 per theme in r1.
   - **The mismatch rule.** "On any per-view mismatch the executor finds and replays the *missing* state" has no instruction for a *surplus*.
   - **Required wording.**
     - State-surface overlays cells replay exactly the unsplit predecessor navigation for the recents. The seed's dashboard creation and selection records the dashboard. The unsplit dark-theme route walk visits `/` → `/sources` → `/pipelines` → `/pipelines/<id>` → `/connectors` → `/chat` → `/settings` → `/`, so `/pipelines/<id>` is reached via a prior `/pipelines` load and gets a persisted title. Do **not** visit `/sources/<id>`.
     - The mismatch rule covers both missing and surplus state: replay must match the unsplit sequence, not add to it.
     - If `/sources/<id>` was meant for focus-presence, say so explicitly. Note that focus-presence opens no palette, so it needs no recents replay at all; r1 already shows its per-view counts are identical across themes.

### Non-blocking notes

- **Pre/post overhead.** It measures 163/179/152 s pre-test and about 9 s post-test, so "3.1 min total, the rest post-test teardown" overstates post-test. Put the measured per-run split in `profile.md`.
- **D4 modelling input.** The before-profile has no per-cell durations, because each guard is one test. Tell the executor how to estimate cells: the unsplit duration divided across cells, plus measured per-cell setup (`registerAndLogin` + UI dashboard creation + API seed + theme reload). Otherwise the `--list --shard` model in task 4.3 has no input for 28 of its ~175 tests.
- **Plateau at N≥5.** My model shows the slowest shard stops improving at N≥5 (about 200–230 s), because the 18 state-surface cells cluster in the tail shard. If N=4 misses after D5, the effective next lever is (2), a proven-isolated heavy file in the first shard, not raising N. Raising N also raises the max-of-N runner-overhead variance.
- **Per-cell setup estimate.** Per-cell setup was estimated at 4 s. Real UI login + UI dashboard creation + reload may cost 6–8 s, adding about 15–30 s to the guard-heavy shard. Measure it in the first PR run.
