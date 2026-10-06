## Standing Constraints

- [C1] Before/after timings come from CI logs only; local runs are for correctness, not measurement.
- [C2] Local Playwright: ≤ 2 workers under `nice -n 19`, own ports (DEV_PORT/BACKEND_PORT from workflow-state), own headless browser context; never reuse another lane's server.
- [C3] Every removed test names the surviving test that covers its behaviour; never remove a test to fix a flake; `hel1260-orphan-owner-repair.spec.ts` is neither removed, quarantined nor edited (flake tracked as HEL-1289).
- [C4] ci.yml edits are confined to the `e2e` job; CI still runs `npx playwright test` against the config glob + `testIgnore` (HEL-951).
- [C5] If ≤ 7 min looks unreachable without dropping real coverage, escalate instead of cutting coverage.
- [C6] Deletion targets (files, rows, processes) only by exact path/id/PID created and recorded by this run; nothing written under ~ outside the repo/worktree.
- [C7] A removed test needs an equal-or-stronger integration-level surviving test (or no behavioural expect, or a written no-integration-claim argument); the final-gate skeptic confirms every such ledger row.
- [C8] Owner ruling: e2e matrix ≤ 4 legs; shorten legs via Playwright workers per leg (isolated users/data), never more legs; if 4 legs can't reach ≤ 7 min median without cutting coverage, escalate with measured numbers.
- [C9] Owner ruling (cycle 4): 2 workers per leg, 4 legs; cut per-test setup (guard cells, API seeding, session reuse); ≥ 2 green CI runs, one at a time, at the final head; never edit HEL-1298 specs (hel519:90, hel910:90 failures) or hel1260; escalate again if the slowest leg misses.
- [C10] Cycle 5: root-cause (probe-confirmed) why a cookie session gives /settings 24 vs 25 elements before changing guard login; escalate if it is a product bug or the fix changes what the guard measures; never adjust the guard to fit; no dependency edits; no hel958 (HEL-1294) edits.
- [C11] Owner ruling: timing accepted (4 legs × 2 workers, slowest-leg median ~6.9 min, timeout-minutes 18). Hold pushes/CI until HEL-1294 merges; then merge origin/main (no force-push) and get 3 consecutive all-e2e-green runs at the final head; a streak break on anything but a known tracked flake is reported, not retried.
- [C12] Owner ruling (cycle 6): root-cause the backgrounded `sbt run` hang with a probe; add a fail-fast health wait (PID liveness + log progress) whose red is shown against a deliberately killed backend; changes stay in the e2e job; escalate if the cause is HEL-1287's backend/cache setup; any further streak break is reported, not retried.
- [C13] Cycle 7 (driver, owner budget delegation): remove the restart and `pkill -f` path entirely; fail-fast detection on the real process group including post-fork death; prove red against a really-killed backend; stay correct whether or not C12 accepts no root cause; leave the hel519 header as is pending C9; after evaluator PASS and a fresh 3-green streak, hold before the final skeptic.
- [C14] Owner rulings: C12 `accept-detection-without-root-cause` (root cause tracked as HEL-1339); C9 `keep-header`. Merge origin/main without force-push, keeping main's security and backend jobs exactly and touching only the e2e job; run the streak only once the GHSA-6qxp-vccf-f47h fix is on main.

## 1. CI profiling infrastructure

- [x] 1.1 Add a CI-only `json` reporter writing to a file under `test-results/` alongside `list`; verify `CI=1` run writes it and a bare run prints no JSON.
- [x] 1.2 Add a ranking script (outside `scripts/concertino/`) that turns CI JSON + `gh run view --json jobs` into per-step and top-15 spec tables; verify against run 37337348981's log.
- [x] 1.3 Write `profile.md` "before" section from main runs 37337348981/37324205115/37324120988 (steps, top 15, counts, waitForTimeout inventory, setup cost); verify numbers trace to those runs.

## 2. Redundancy removal

- [x] 2.1 Audit every spec; record proposed removals in `profile.md`'s ledger per design D2 (a)/(b)/(c) with surviving test file:line; verify each surviving test exists and asserts the behaviour.
- [x] 2.2 Delete the ledgered specs/tests (subject to evaluator + final-skeptic confirmation, D2) and update `e2e/README.md`; verify `npx playwright test --list` count drop matches the ledger.
- [x] 2.3 List quarantined `testIgnore` specs with their ticket status; remove none tied to an open ticket; verify config unchanged for those.

## 3. Long-runner optimisation

- [x] 3.1 Split `state-surface-contrast-guard` into parallel-mode per-cell tests per D3 (no beforeAll/afterAll); verify all 36 per-view lines equal run 37337348981's (exact unsplit recents replay per D3; missing or surplus mismatch → fix replay or escalate), 18 cells listed, per-cell fractions recorded, mutation red.
- [x] 3.2 Split `focus-presence-guard` likewise per D3; verify all 10 per-view lines equal run 37337348981's, 10 cells listed, mutation red, and `--list --shard=i/N` spreads guard cells over > 1 shard.
- [x] 3.3 Replace observable-condition `waitForTimeout`s in the top-15 specs with web-first assertions; verify those specs pass locally twice.

## 4. CI job (e2e only)

- [x] 4.1 Convert `e2e` to a shard matrix (`fail-fast: false`, `--shard=i/N`) with per-shard artifact names (D8), JSON uploaded always, logs on failure; verify `ci-complete` still `needs: e2e`.
- [x] 4.2 Overlap `sbt run` boot with npm/browser steps (done; no measurable pre-test drop) and evaluate a Playwright browser cache (measured, no gain, dropped; see profile.md Findings).
- [x] 4.3 Model shard composition via `--list --shard` before CI; tune per D4 levers (N, proven-isolated parallel file, else escalate); verify slowest-shard job ≤ 6.5 min on the PR. (superseded by C11: the owner accepted ~6.9 min; measured slowest legs were 6.5-7.1 min)

## 5. Verification

- [x] 5.1 Full local run (2 workers, nice 19) green; verify list count matches CI.
- [x] 5.2 Three consecutive green full CI runs on the PR head; record run ids and per-shard times in `profile.md` "after".
- [x] 5.3 Fill `profile.md` "after" top-15 and counts; note post-merge median/flake rate are measured by the driver on main.

## 6. Added scope (owner, cycle 4)

- [x] 6.1 Set `strategy.max-parallel: 4` on the e2e matrix (no workflow-level `concurrency:`; HEL-1287 owns it); verify in ci.yml diff.
- [x] 6.2 Set e2e `timeout-minutes` ≈ 2–3× the measured slowest leg; record expected time + chosen timeout in profile.md and the PR body.
- [x] 6.3 Prove `ci-complete` fails when a run is cancelled mid-flight: cancel one of OUR runs by exact id while e2e legs run; record run id and ci-complete conclusion.
- [x] 6.4 Add no new `actions/cache` entries; verify the e2e job's cache steps are unchanged from main.
