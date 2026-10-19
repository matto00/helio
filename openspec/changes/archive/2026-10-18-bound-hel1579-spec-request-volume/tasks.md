## Standing Constraints

- [C1] Do not raise RATE_LIMIT_REQUESTS_PER_WINDOW or any limiter config, and do not exempt or special-case test users.
- [C2] Red before fix: probe-confirmed evidence (429s observed or a per-user 60s window >120, with a request breakdown) is recorded in measurements.md before any fix is committed.
- [C3] Resource and process discipline: Playwright and jest at most 2 workers under `nice -n 19`. Full Playwright suites go under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock`, and `sbt testFull` under the same path's `sbtfull.lock`. Load gate: if the 1-minute load is over 10, sleep 60 s and recheck, for up to 30 minutes. Playwright uses `--trace retain-on-failure`. Scratch goes in `/home/matt/Development/helio/.concertino/scratch/HEL-1620/`. Never use kill/pkill/pgrep/killall; stop servers only with `scripts/concertino/stop-servers.sh`.
- [C4] Red evidence must be observed: 429s, or a measured per-user 60 s window over 120, locally or in a CI trace. Arithmetic on a total count is never red evidence.
- [C5] The request counter attaches before registerAndLogin, so it captures the requests the post-login page makes during seeding. It counts requests, not only responses.

## 1. Measure (red)

- [x] 1.1 Add `e2e/support/apiRequestCounter.ts`, which records every `/api` response (timestamp, method, path template, status) for a page context and computes the total, the max sliding-60s window, the 429 count and a top-N breakdown. Verify whether `page.request` responses are captured, and if not, count them at the call site. Verify with a quick one-test run that the printed total is non-zero and plausible.
- [x] 1.2 Wire the counter (temporarily, report-only) into every test of the unmodified `e2e/hel1579-pipeline-spine-layout.spec.ts`, run the spec, and record in `openspec/changes/bound-hel1579-spec-request-volume/measurements.md` the per-test total, max 60s window, 429 count and top breakdown for each test. This is the red evidence for the accent audit. Verify that measurements.md has a row per test and shows the accent audit over the limit.

## 2. Classify

- [x] 2.1 Apply design D2's rule to the breakdown: list every request type per load and per click, and mark each as defect or required, with reasons. Check the two static candidates (unguarded pipeline-schedules fetch, dashboard panels on /pipelines). If a defect is found, check the HEL-1630 overlap with `gh pr list` / `gh pr diff`. Record everything in measurements.md. Verify that the classification table is present.

## 3. Fix

- [x] 3.1 (Only if 2.1 found a defect whose fix changes no spec requirement.) Remove the redundant request in product code, with a unit test that fails before the fix and passes after. Verify the jest test red then green.
- [x] 3.2 Split the accent audit into one test per theme/accent pair, each with a fresh user, its own seed and one page load, keeping every assertion. Restructure any other test whose measured max window exceeds 90 the same way. Verify that the new tests pass and that every audited row, the tab-focus check and both themes and presets are still covered.
- [x] 3.3 Make the counter a permanent guard in the spec: assert zero 429s and a max 60s window of at most 90 per test, with a breakdown in the failure message. Mutation-check it (lower the threshold below the measured value, or temporarily revert the split) and record the failing output in measurements.md. Verify that the guard is red under mutation and green when restored.

## 4. Verify

- [x] 4.1 Run the hel1579 spec 10 times (`--repeat-each=10` or 10 sequential runs, 2 workers max), and record in measurements.md the per-test max windows and the total 429 count across all runs. Verify that the 429 count is 0 and every window is at most 90.
- [x] 4.2 Run the repo's standard gates for the touched files (lint, typecheck, format check, the jest tests for any product change). Verify that all are green.
