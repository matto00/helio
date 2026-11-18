## Why

Five CI failures in five hours (2026-11-18) hit jobs unrelated to the change under test and each passed on one rerun.
Two are the backend compile-cache key (`hashFiles` over `backend/src/**` timing out at 120 s), one is a backend shard
running into sbt's 660 s in-step deadline while still running tests, and three are e2e specs. Every one costs a CI
cycle and a driver ruling. Planning pulled the attempt-1 logs of all three runs (the jobs API shows only the latest,
passing attempt) to `.concertino/scratch/HEL-1758/logs/` in the main checkout.

## What Changes

- **Backend compile-cache key** - root-cause why `hashFiles(...)` at ci.yml:280 intermittently takes over 120 s (normal
  restore step: 2-8 s over ~95 recent backend jobs; failures: exactly 120 s). Replace the key's input with a cheap,
  deterministic value computed from git (tracked content only, no filesystem walk and no runner-side hashing), keeping
  the `backend-compile-v3-<os>-` prefix so prefix restore still finds main's newest entry. Before/after restore-step
  timings from real CI runs.
- **Backend 660 s deadline** - determine hang vs under-provisioning from the attempt-1 log and the uploaded thread
  dump. Planning's reading: tests were still streaming output at the deadline (a new suite was migrating Flyway at
  02:40:34), and the shard had first compiled 110 main + 271 test sources. The suite-weights file the shard packer uses
  (`backend/project/test-suite-weights.tsv`) has not been regenerated since 2026-10-05, so every suite added since is
  packed at the median weight. Act: regenerate the weights from current CI JUnit timings; if the predicted heaviest
  shard still exceeds the budget in design.md, add a backend shard leg.
- **hel1665-home-phone-stability:437** - the failing serif run read `ch40 = 600` (the sans/fallback 40ch) while the
  settled cap was `640.001` (Fraunces 40ch); the page loaded and the test ran 7.4 s. Root-cause the probe's `40ch`
  read with a forced red, fix, 40/40.
- **hel1583-home-375:25** - Home shelf `cardCount` read 0 vs 4: find what the measurement waits on, force red, fix,
  40/40.
- **hel1573-motion-grid-chart:104** - `.chart-panel__canvas canvas` not found within 5 s after `goto("/dashboards")`:
  trace-driven root cause, force red, fix, 40/40 - or record the probes that failed to reproduce it.
- **HEL-1757** - stays separate (not folded in) unless the hel1665 trace shows a stalled fonts request; the evidence so
  far (font loaded, goto did not hang) says it is a different defect.

## Capabilities

### New Capabilities

### Modified Capabilities

- `ci-actions-cache-budget`: the backend compile-cache key is computed without walking the workspace, so the restore
  step cannot fail on a key-evaluation timeout.
- `backend-ci-test-execution`: the backend shard packing weights are kept current, so no leg runs into its in-step
  deadline from stale weights.

## Non-goals

- No sleeps, extra retries or longer timeouts, in e2e or in CI (the 660 s deadline and step/job bounds stay).
- No Flyway migration, no model calls, no prod action.
- Not fixing HEL-1757's suite-wide fonts dependency.
- No change to Popover/usePortalPopover/panelFit (HEL-1756) or the insight backend (HEL-1742).

## Impact

- `.github/workflows/ci.yml` (backend job: compile-cache key; possibly the backend matrix).
- `backend/project/test-suite-weights.tsv` (regenerated), possibly a small script to regenerate it.
- The three e2e specs and their support files, as the probes dictate; possibly a small product fix with a failing-first
  test if a probe shows a real defect.
