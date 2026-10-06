# HEL-1288: Halve e2e CI job time: profile, cut redundant Playwright specs, speed up slow ones

## Description

The CI `e2e` job takes 12–14 minutes. The owner's observation was "up to 15 min", and this isn't sustainable.
**Target: at most half of today's time.** The job's wall-clock must be **≤ 7 min**, taken as the median of 5
consecutive green `main` runs after merge.

Measured baseline (ticket author, run 35055008188 — NOTE: premise validation found this run is from 2026-09-16, and
today's main e2e job is ~15–19 min wall-clock with a Playwright-reported suite time of 12.3–16.3 m, 145–149 tests,
"using 2 workers"): `Run e2e suite` ~643 s; `Start backend (sbt run)` ~86 s; `Install Playwright browsers` ~29 s;
container init ~23 s; ~49 entries under `e2e/`; `playwright.config.ts` sets `fullyParallel: false`, `retries: 0`,
`timeout: 30_000`, no explicit `workers` — check what parallelism CI actually gets.

Owner direction: "look for redundant and unnecessary tests, then optimize long-running tests".

Order of work:
1. Profile first and commit the evidence: per-spec durations (e.g. JSON reporter on CI), setup cost per spec
   (signup/login, API vs UI seeding, backend boot), time in fixed waits (`waitForTimeout`), critical path of the
   job's non-test steps.
2. Remove redundant and unnecessary tests: specs covered by Jest/RTL or backend route specs, retired features,
   overlapping flows, long-quarantined specs in `testIgnore` that will never return. For each removal, state the test
   that still covers the behaviour. Quarantined specs tied to an open ticket (e.g. HEL-992) need a driver/owner ruling
   before removal. Do not delete a test to fix a flake.
3. Optimise long-running ones. Candidates to verify, not assume: reuse authenticated `storageState`; seed through the
   API; replace fixed timeouts with web-first assertions; explicit `workers` and sharding (isolated users/data, no
   shared mutable state); cache the Playwright browser; shorten backend boot (prebuilt jar / staged sbt, overlapped
   with the frontend build).

## Acceptance Criteria

- A profile artefact in the change: before and after per-step timings, plus the top 15 slowest specs before and after.
- Before and after spec and test counts, and every removed test listed with its remaining coverage.
- Report the flake rate over the post-merge runs. Parallelism must not introduce cross-test interference: a full run
  is green 3 times in a row on CI before merge.
- The ≤ 7 min median, measured on `main` after merge. If sharding is used, the measure is the slowest shard plus any
  setup on the critical path, and `ci-complete` must still gate on all shards.
- The HEL-951 glob and `testIgnore` contract stays intact: CI still runs `npx playwright test` against the config,
  not a hand-picked list.

## Driver constraints (this run)

- Keep ci.yml edits to the `e2e` job (HEL-1287 will touch the backend job).
- Do not delete/quarantine `e2e/hel1260-orphan-owner-repair.spec.ts` (red on main 1f955abd); report its cause if
  profiling reveals it.
- If the target looks unreachable without dropping real coverage, escalate; do not cut coverage to hit the number.
- Before/after numbers must come from CI logs.

## Added scope (owner, 2026-10-05, relayed by the driver; Linear comment not readable from this lane's tools)

- e2e matrix sets `strategy.max-parallel: 4`, matching the 4-leg cap (C8). The workflow-level `concurrency:` stanza
  (per-PR cancel-in-progress) is owned by HEL-1287 — this change adds none.
- Show that `ci-complete` is NOT satisfied when a run is cancelled mid-flight (the situation HEL-1287's PR-only
  cancel-in-progress creates for a superseded run).
- Each e2e leg gets `timeout-minutes` of ~2–3× its expected time, derived from the measured slowest leg; the expected
  time and the chosen timeout are stated in the PR body. HEL-1287 sets timeouts for the other jobs.
- No new Actions cache entries (cache limits are being hit; separate ticket); the Playwright browser cache stays dropped.
