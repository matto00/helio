## Standing Constraints

- [C1] No retries, no `test.setTimeout`/`test.slow`, and no raised poll, expect or navigation timeouts anywhere in the change.
- [C2] Throttle harness is scratch-only (never committed), identical for red and green runs, and applied to every page including per-iteration contexts.

## 1. Repro (red first)

- [x] 1.1 Under the e2e lock, with the scratch throttle harness at 2.5x (4x if 2.5x is not red), run the UNCHANGED test
  with `--repeat-each=40 --workers=2 --trace retain-on-failure`, and record the failure count and one failing trace's
  per-iteration timings in the scratch dir. Verify: at least one `Test timeout of 30000ms` failure at `openPalette`.

### Tests

## 2. Fix the test

- [x] 2.1 Restructure the section-order test per design.md D1/D2 (fresh API user, new context with only that cookie,
  `/dashboards`, shell wait, unchanged `openPalette`, close the context in `finally`), and update its comment to state
  the budget reason. Verify: `npm run lint`, `npm run format:check` and the e2e typecheck are clean.
- [x] 2.2 Mutation check: temporarily break the declared section order in app code, run the test once, see it red,
  then revert. Verify: the red output is recorded in scratch, and `git diff` shows no app change.

## 3. Proof

- [x] 3.1 Same harness and rate as 1.1: `--repeat-each=40` passes 40/40. Also run 40 at 4x and report the result and
  the max test duration. Verify: summaries saved in scratch, plus per-page throttle log lines.
- [x] 3.2 Run the whole hel516 file once unthrottled. Verify: all of its tests pass.
