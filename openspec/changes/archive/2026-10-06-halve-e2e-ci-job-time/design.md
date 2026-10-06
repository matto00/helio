## Context

See proposal.md — Why. Ground truth gathered at Planning from CI logs of green `main` runs 37337348981 (32571b01),
37324205115, 37324120988 (list-reporter per-test durations, step timestamps):

- Job wall-clock 15–19 min; suite 12.3–16.3 m; `Running 145–149 tests using 2 workers` (default = half of the 4-vCPU
  runner). Summed per-test time 1343 s / 1481 s / 1203 s per run, i.e. the 2 workers are ~85% utilised — there is no
  idle-worker win.
- Two single-test guards dominate: `state-surface-contrast-guard.spec.ts:515` (4.5–4.7 m, `setTimeout(360_000)`) and
  `focus-presence-guard.spec.ts:146` (3.0–3.3 m). Each is one test walking every view × theme serially, so it is a
  hard floor on any shard/worker and must be split before sharding can pay off.
- Next tier (60–90 s/file): hel1028 (13 tests), hel1023 (5), hel516-palette-quick-create (10), hel813 touch-target
  (14), hel773 (11), hel519 (8), hel588, hel1094 (1 test, ~45 s), hel1065.
- Non-test critical path: 152–179 s pre-test, ~9 s post-test (per-run split recorded in `profile.md`): containers ~23 s, setup/caches ~25 s, `npm ci` ×2 ~15 s, browsers ~29 s,
  `sbt run` to `/health` ~86 s (compile + boot), Vite ~2 s.
- `ci-complete` (the only required status check, verified via the ruleset API) `needs: e2e` and fails on any
  `failure`/`cancelled` result; a matrix job under the same id reports `failure` if any leg fails.

- Scheduling (Playwright 1.55.1 `lib/runner/testGroups.js`): with `fullyParallel: false` every test of a default-mode
  file forms ONE group → one worker, one shard. `--shard` (`filterForShard`) assigns contiguous groups in collection
  order balanced by **test count, not duration**.

Arithmetic (count-based model on run 37337348981, skeptic-design-1): at N=4 with the guards left as single tests the
slowest shard's suite is ~368 s (≈ 8.8 min job with today's ~2.7 min pre-test overhead) — misses. With the guards
split into parallel-mode cells it is ~226 s (≈ 6.5 min with today's overhead) — so D3 *and* D5 are both load-bearing;
neither is optional, and redundancy cuts (D2) are margin, not the plan.

## Goals / Non-Goals
**Goals:** median e2e critical path (slowest shard job incl. its setup) ≤ 7 min on CI, with margin (target ≤ 6.5 min
on PR runs), no loss of real coverage, HEL-951 contract intact, 3 consecutive green full runs on the PR.
**Non-Goals:** fixing the hel1260 flake (report findings only); removing quarantined specs tied to open tickets;
touching the `backend` job; `fullyParallel: true` globally; product code changes.

## Decisions

**D1 — Profile from CI, committed as `profile.md`.** Add a `json` reporter alongside `list`
(`outputFile` under `test-results/`, CI-only — see D8) and upload it as an artifact on every run (not only failure), so per-test
durations come from CI, not the 12-thread dev box. A small script under `e2e/support/` (or `scripts/`, not
`scripts/concertino/`) ranks specs and step timings from the JSON + `gh run view --json jobs`. `profile.md` holds:
before (from the main runs above) and after (from PR runs) per-step timings, top-15 specs, spec/test counts, the
`waitForTimeout` inventory with total ms, and the removal ledger. Alternative (local profiling) rejected: local
timing is not the measurement (driver rule; gates-run-on-one-machine hazard).

**D2 — Redundancy first, each removal with a named surviving test at an equal-or-stronger integration level.**
Executor audits each spec. A removal is allowed only when one of:
(a) another **e2e** test (real browser → real backend) asserts the same behaviour — ledger names file:line; or
(b) the removed test has NO explicit assertion (`expect`/`expect.poll`/`expect.soft`) AND no implicit one
(`waitForSelector`/`waitForURL` on a state change, role/text-located actions whose failure is the check); or
(c) a Jest/RTL or backend route spec covers the behaviour AND the ledger carries a written argument that the removed
test asserts nothing integration-specific (no wire/cookie/CSRF/SSE/persistence/round-trip claim). Mocked-service unit
tests alone never satisfy (a).
A theme-dependent assertion (contrast, focus ring, colour) is never collapsed to one theme. **Approval:** the
executor proposes; the evaluator checks every ledger row against the named surviving test; the final-gate skeptic
must independently confirm every (a)/(b)/(c) row before delivery — a row it rejects is restored. Pre-identified
candidates to VERIFY: `hel516-screenshots.spec.ts` and `hel519-screenshots.spec.ts` — NOT class (b): hel516-shots has
implicit assertions (Ctrl+K opens the palette via `expect.poll`, theme-switch option, `?` opens help — L21–28/45/69),
so any removal goes through (a)/(c) naming surviving tests for each; overlapping
palette/keyboard flows (hel503/hel510/hel516/hel519). Quarantined specs: listed with ticket status; none removed if
the ticket is open (a non-running file costs no CI time; removal would need an owner ruling).

**D3 — Split the two guards into parallel-mode per-cell tests, same population.** Each guard file gets
`test.describe.configure({ mode: "parallel" })` on its describe — scoped to those two files only, NOT the globally
rejected `fullyParallel: true` — and NO `beforeAll`/`afterAll` (hooks would push cells into `parallelWithHooks`
chunking). Each cell does its own `registerAndLogin` + API seed (the existing seed code, extracted to a helper).
Cells:
- state-surface (`e2e/state-surface-contrast-guard.spec.ts`): theme ∈ {dark, light} × {`chrome` on `/`, each route
  in `routes` (one cell per route), `overlays` (command-palette + modal:add-source + actions-menu)}.
- focus-presence (`e2e/focus-presence-guard.spec.ts`): theme ∈ {dark, light} × each route in its `routes` list.
Expected counts: 18 state-surface cells (2 × [chrome + 7 routes + overlays]), 10 focus-presence cells (2 × 5 routes).
Titles are static at collection time: runtime-id routes are keyed by a label (`source-detail`, `pipeline-detail`)
and the id is resolved inside the cell. Per-cell `test.setTimeout` drops to a cell budget (≤ 120 s).
Executor may merge adjacent cheap cells (record which) but never drops one.
Cross-view state: the unsplit guard accumulates order-dependent browser state — `localStorage["helio.recentVisits"]`
(written by `RecentVisitsRouteObserver.tsx`/`recentVisitsListeners.ts`, prepended to the empty-query palette in
`CommandPalette.tsx` L130–131) and `helio-theme` (set per cell by `setTheme`). Each state-surface `overlays` cell
replays EXACTLY the unsplit predecessor navigation — seed's dashboard creation/selection, then `/` → `/sources` →
`/pipelines` → `/pipelines/<id>` → `/connectors` → `/chat` → `/settings` → `/` — and nothing else (never
`/sources/<id>`, which the unsplit guard never visits), so the palette set is the same set, not just the same count.
Focus-presence opens no palette and needs no recents replay.
Assertion mapping:
- Per-route `assertPartitioned` (state-surface): already self-contained — `chromeCoverageHere` is collected by
  `collectCandidates` on the route's own document (L686–697), not carried from the chrome probe — so it moves into
  the route cell unchanged.
- Failure-verdict assertions (contrast `fail`, focus findings): per cell; a failing element fails the suite either
  way — equivalent.
- `unresolvedFraction < 0.5` (state-surface L862, run-wide): becomes **per-cell** `< 0.5` — stricter. Justification:
  the ceiling detects a probe that has stopped resolving colours, which is equally a defect in any single view. The
  executor records each cell's fraction (CI log) in `profile.md`; if any cell legitimately exceeds 0.5 the executor
  escalates rather than loosening it.
- `totalMeasured > 0` (focus-presence L383, run-wide vacuity guard): becomes per-cell `measured > 0` — stricter; every
  route view has focusables (pre-split log shows 19–34 per view).
Population equality is checked **per view**, not by totals (a sum hides compensating deltas): every existing
per-view line — `[HEL-866 guard] view "<view>" (<theme>): N visible interactive element(s), sampled M` (36 lines in
run 37337348981) and `[HEL-520 focus-presence guard] view "<view>(<theme>)": n focusable element(s) measured
(uncapped)` (10 lines) — on a PR CI run must equal the same view's line in main run 37337348981 (no product code
changes; runtime ids normalised to their label). Totals are reported too. On any per-view mismatch (missing OR surplus)
the executor makes the replay match the unsplit sequence exactly, or escalates; a cell is never adjusted merely until the totals match. Failure-signal equivalence: a mutation (break one
focus ring / one state colour) must turn the split guard red — run once, record the red output.
Schedulability signal: `npx playwright test --list --shard=i/N` for the chosen N shows guard cells in > 1 shard.

**D4 — Shard the `e2e` job: `strategy.matrix.shard: [1..N]`, `fail-fast: false`, run
`npx playwright test --shard=${{ matrix.shard }}/N`.** This still runs the config's glob honouring `testIgnore`;
`--shard` partitions that collected set (verified in `filterForShard`), it does not hand-pick files — the HEL-951
contract is preserved and stated in a comment. Each shard is its own runner with its own Postgres service and
backend, so sharding adds no shared mutable state. **Owner ruling (2026-10-05, via driver): N ≤ 4 legs** (account-wide
~20 concurrent-job cap shared with HEL-1287's ≤ 4 backend legs); shorten legs with more Playwright workers per leg.
`ci-complete` keeps `needs: e2e` unchanged (matrix result aggregates to `failure` if any leg fails).
**Tuning procedure (count-based balance):** before spending CI runs, the executor runs `--list --shard=i/N` for
candidate N and models the slowest shard from the before-profile's per-test durations (split-guard cells: unsplit
duration ÷ cells + measured per-cell setup, likely 6–8 s). Modelled plateau at N ≥ 5, so lever (2) beats raising N. If the slowest shard is over
budget, the levers in order are: (1) workers per leg (3–4 on the 4-vCPU runner; every test in a parallel-scheduled
file has its own user/data; flake rate watched); (2) `describe.configure({ mode: "parallel" })` on another heavy file
**proven isolated** (no `beforeAll`, no shared user/data across its tests, passes twice locally in parallel mode);
(3) escalate under C5. Never reorder/rename files to game the shard split.
Alternative rejected: global `fullyParallel: true` (unverified shared `beforeAll` users/serial order).

**D5 — Shorten each shard's non-test path (load-bearing: the count model needs ~30–60 s off today's ~2.7 min).** (a) Start `sbt run` in the background immediately after the sbt cache
restores, before `npm ci`/browser install; health-wait in a later step (overlap ~60 s). (b) Cache
`~/.cache/ms-playwright` keyed on the installed `@playwright/test` version; on hit run `install-deps` only if
needed (`npx playwright install --with-deps chromium` is still run but becomes fast) — executor measures. (c) Evaluate
`vite build` + `vite preview` (with the same `/api` proxy) vs the dev server only if profiling shows page-load
dominates per-test time; adopt only with a green full run and no dev-only behaviour dependency. A prebuilt backend
jar from the `backend` job is rejected (couples to HEL-1287's job and serialises the critical path).

**D8 — Per-shard artifacts.** Every `upload-artifact` in the job gets a per-shard name
(`playwright-report-shard-${{ matrix.shard }}`, `playwright-json-shard-${{ matrix.shard }}`) — v4+ rejects duplicate
names within a run. The failure upload keeps `test-results/`, `/tmp/backend.log` and `/tmp/frontend.log`. The JSON
reporter writes to a file under the gitignored `test-results/` (never stdout) and is enabled only when `CI` is set, so
a bare local `npm run e2e` is unchanged.

**D6 — Fixed waits.** Replace `waitForTimeout` in the top-15 specs with web-first assertions only where the wait
guards an observable condition; a wait that deliberately proves "nothing happens within X" (e.g. debounce/autosave
negative checks) stays and is documented in the inventory.

**D7 — Pre-merge evidence.** Three consecutive green full CI runs on the PR head (re-runs of the same head count,
via `gh run rerun`), each with the per-shard timings in `profile.md`. Post-merge 5-run median and flake rate are
measured by the driver on `main`; `profile.md` and the PR body state plainly that the ≤ 7 min AC is unmeasured at
merge time, and that the `backend` job (~18 min) bounds overall CI wall-clock until HEL-1287 lands.

## Risks / Trade-offs
- [Runner-minutes rise ~N×] → wall-clock is what the owner asked for; noted in the PR.
- [Shard imbalance from long files] → D3 removes the two worst; executor checks the slowest shard in CI logs.
- [Split guards lose population] → D3 count-equivalence + mutation red required.
- [Background `sbt run` failure masked] → the health-wait step still fails loudly and dumps `/tmp/backend.log`.
- [hel1260 flake recurs in a shard] → not quarantined; recorded as a finding with the run id; a red run does not
  count toward the 3-in-a-row.
- [Target unreachable without cutting coverage] → escalate to the driver (driver rule), do not cut further.
## Planner Notes
- Self-approved: `skip_specs: true` (CI/test tooling only); no new external dependency.
- Baseline staleness (ticket cites a 2026-09-16 run) is in premise validation; the ≤ 7 min absolute target binds.
