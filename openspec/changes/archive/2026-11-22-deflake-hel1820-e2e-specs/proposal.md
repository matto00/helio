## Why

Three e2e tests failed on CI runs whose code they do not depend on (HEL-1820, 2026-11-22). Each unlisted failure costs
a lane a rerun or a park. Each needs a probe-confirmed root cause and a fix that keeps its assertion.

## What Changes

- Root-cause, by probe, `hel1791-compact-counter-stack-height.spec.ts:290` (HEL-1804 live-region test),
  `hel1582-mobile-pipeline-motion-and-states.spec.ts:244` ("N fields" panel on screen, phone sizes) and
  `hel1572-appearance-preferences.spec.ts:126` (type style, no reload, another device).
- Fix each test in `e2e/` only, without weakening what it asserts.
- Commit red runs, mutation runs and 20x green runs as `.txt` evidence in the change dir.
- A test whose cause is in the app, or that cannot be reproduced or root-caused, is NOT fixed by app edits here: it is
  reported (follow-up triage by the orchestrator) and recommended for the lane flake list by its title.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change (`skip_specs: true`).

## Impact

`e2e/` spec and support files for the three tests only. No app, schema, backend or CI config change.

## Non-goals

- App code changes (an app cause is escalated, never fixed silently here).
- Other flaky specs; HEL-1615 / HEL-1624 files.
