## Context

See proposal.md - Why. HEL-1691 (0f194882f) built a production-build e2e lane: a test opts in with `{ tag: "@prod-build" }`;
`HELIO_E2E_PROD_BUILD=1` makes the only projects `prod-build-guard` (fails closed unless `baseURL` serves a production build) and
`prod-build` (tagged tests only); with it unset the only project is `dev` (untagged tests only). CI runs the tagged tests in the
required `e2e-prod-build` job (`npm --prefix frontend run build`, `vite preview` on 5173, same backend/env as the shard legs;
`timeout-minutes: 8`, measured 196 s when it had 2 tests). `npm run check:e2e-prod-build-projects` (+ `:selftest`) keeps the
partition honest. Lanes run it with the HEL-1699 sequence in e2e/README.md (`stop-servers.sh`, `e2e-backend.sh lane-start`,
`npm run e2e:prod-build`). The shard legs list `--project=dev` only, so a file whose every test is tagged simply leaves the
legs; its `e2e/shard-weights.tsv` row is then reported stale and ignored (README "CI runtime").

`e2e/hel1683-regex-main-thread.spec.ts` has three tests, each asserting `longest long task <= 100 ms` in a window around one
`fill` of the Pattern box:
1. HEL-1683 catastrophic pattern (control window, probe window, overrun window; LoAF attribution logged per window, HEL-1808);
2. HEL-1697 single quantifier over 12 x 10,000 cells (declined to the server);
3. HEL-1807 start-anchored `^(.*)$` over the same frame (evaluated on the client, no draft-preview request).

## Goals / Non-Goals

**Goals:**
- All three probes run against the production build, locally and in CI, with the 100 ms bound unchanged.
- Each probe still goes red under its mutation, on the production build.
- Measured production-build task times and margin recorded; CI cost measured and stated.

**Non-Goals:**
- No new Playwright config/project/webServer and no new CI job (the HEL-1691 lane is that mechanism).
- No change to the bound, the patterns, the frame sizes, the waits or the assertions' meaning.
- No hand edit of `e2e/shard-weights.tsv`; no app code; no change to any other spec file.

## Decisions

**D1 Reuse the `@prod-build` lane.** Tag each of the three tests `{ tag: "@prod-build" }` (the second argument form the
HEL-1631/1632 users use). Alternative rejected: a separate config with its own `webServer` gated to this file, which is what
the ticket suggested before HEL-1691 existed; it would duplicate the guard, the partition checker and the CI job, and the
ticket's "e.g." permits the existing equivalent.

**D2 All three tests move, whole.** HEL-1807's test asserts the same bound in the same kind of window, so it has the same
dev-noise problem; the ticket predates it. The non-timing assertions in each test (server outcome, out cells, no draft-preview
request) move with it; they are build-independent and still run in a required CI job.

**D3 No dev-build copy.** A tagged test is excluded from `dev` by design (`check:e2e-prod-build-projects` enforces it), so
keeping a dev run would mean a duplicated test. Not kept, because: (a) every assertion runs unchanged in the required
`e2e-prod-build` job, so no product behavior loses coverage; (b) the only thing the dev run additionally measures is React
development-mode render cost in the input handler, which users never pay and which is exactly the false-red source the
ticket removes; a duplicate would keep that flake on 8 legs; (c) HEL-1691 moved its burst test outright with the same reasoning.
This is not an owner-level coverage trade-off: nothing a user can experience is unguarded afterwards. The executor records the
dev-build baseline once (evidence) for comparison.

**D4 Measurement on the production build.** Run the spec on the production build (HEL-1699 lane sequence) at least 3 times,
plus once with the existing `HEL1808_CPU_THROTTLE=4` diagnostic (slow-host proxy). For each window (control, probe, overrun,
long-cell, anchored) record the longest task per run; margin = 100 ms minus the worst observed. Record the dev-build baseline
of the same windows from one run before tagging. LoAF attribution lines must still print on the production build (sourceURL
becomes a hashed chunk name; that is expected and acceptable).

**D5 Mutations on the production build.** Rebuild after each mutation (`npm run e2e:prod-build` builds), run the full spec,
record which assertion failed with its measured value, revert, and prove the tree clean (`git diff --exit-code` on the
mutated files):
- M1 decline disabled: the HEL-1808 diff (`openspec/changes/archive/2026-11-21-regex-probe-control-headroom/mutation-decline-disabled.diff`,
  re-applied to the current tree, re-derived if it no longer applies). HEL-1683's probe and HEL-1697's long-cell test must fail
  on their 100 ms assertion (the probe must fail on the bound, not on a timeout).
- M2 HEL-1807 anchored rule removed (eligibility forced false, M1 of `.../2026-11-21-anchored-regex-cost-refinement/mutations.txt`):
  the anchored test must fail.
Mutated sources are never committed; only the diffs and run outputs (`.txt`).

**D6 CI cost and shard impact.** Before/after `DEV_PORT=<port> node scripts/e2e-shard.mjs plan` (record each leg's load and
the max) — removing a file can reshuffle LPT assignment, so the after-max must be no higher than before (else escalate). CI
cost: `e2e-prod-build` job duration on the PR run versus recent main runs (`gh run` data, not guesses), stated in the PR with
the 8-minute timeout headroom; `timeout-minutes` changes only if measurement shows < 2x headroom.

**D7 Red first.** Before tagging, commit as `.txt`: `HELIO_E2E_PROD_BUILD=1 npx playwright test --list` (the three probes
absent from `prod-build`), the `dev` list (present), and the dev-build baseline run. After tagging, the same lists invert.

## Risks / Trade-offs

- [Prod build makes a mutation's task shorter, so a mutation passes] → D5 is the gate; the regex cost under M1 is V8 backtracking, not render cost, but it is not build-independent: ~1.1-1.3 s on the dev build
  (HEL-1697 measurement), 561 ms on the production build (HEL-1816 M1 run), still more than 5x the 100 ms bound; if any mutation
  goes green, escalate.
- [The `e2e-prod-build` job becomes a longer pole] → D6 measures it; three tests of ~14 s total weight against an 8-minute bound.
- [Stale weight row for the moved file] → documented behavior (ignored + reported); regenerated from CI artifacts later, never by hand.
- [Lane prod-build run collides with the lane dev server port] → HEL-1699 sequence stops lane servers first and restarts them after.
