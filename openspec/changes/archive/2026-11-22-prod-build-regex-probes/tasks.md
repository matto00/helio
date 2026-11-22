## Standing Constraints

## 1. Red / baseline (commit before any spec edit)

- [x] 1.1 Record `DEV_PORT=7248 BACKEND_PORT=10155 HELIO_E2E_PROD_BUILD=1 npx playwright test --list` and the default (`dev`) list with the lane `DEV_PORT`; verify the three hel1683 tests are absent from `prod-build` and present in `dev`; save as `evidence/red-list-*.txt`.
- [x] 1.2 Run the full spec on the dev build (lane servers, lane DB, 2 workers max) and save `evidence/baseline-dev-build.txt` with every window's longest task.
- [x] 1.3 Record `DEV_PORT=7248 node scripts/e2e-shard.mjs plan` (8 legs) as `evidence/shard-plan-before.txt`; commit 1.1-1.3.

## 2. Opt the probes in

- [x] 2.1 Tag the three tests in `e2e/hel1683-regex-main-thread.spec.ts` with `{ tag: "@prod-build" }`; update the comments that describe dev-build costs/frames to state the build they run on (keep historical numbers attributed to the dev build); verify `npm run check:e2e-prod-build-projects`, its `:selftest`, `npm run check:e2e-types`, lint and prettier pass.
- [x] 2.2 Re-record both lists (`evidence/green-list-*.txt`): the three tests appear only under `prod-build`; and `evidence/shard-plan-after.txt`; verify max leg load is not higher than before (D6).
- [x] 2.3 Update `e2e/README.md` / `CONTRIBUTING.md` prose that names `@prod-build` users; verify by grep.

## 3. Measure and mutate on the production build

- [x] 3.1 Run the spec via the HEL-1699 lane sequence (`npm run e2e:prod-build`) 3 times and once with `HEL1808_CPU_THROTTLE=4`; save outputs; verify all pass, LoAF lines print, and write `evidence/margin.md` (per-window worst across all runs including the throttled control window, margin = 100 ms minus that worst, dev-build comparison).
- [x] 3.2 M1 decline disabled (D5): apply, rebuild, run the spec on the production build, save diff + output; verify HEL-1683 probe and HEL-1697 tests fail on the 100 ms assertion; revert and verify `git diff --exit-code` on the mutated files.
- [x] 3.3 M2 anchored rule removed (D5): same procedure; verify the HEL-1807 test fails and state which assertion it failed on (expected: the no-draft-preview routing assertion, not the timing bound; say so plainly); revert and verify clean.

## 4. CI

- [ ] 4.1 After push (orchestrator, Delivery): read the PR run's `e2e-prod-build` job duration and recent main runs' durations via `gh`; state the cost and timeout headroom in the PR body together with the margin.
