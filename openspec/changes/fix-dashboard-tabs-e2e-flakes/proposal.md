## Why

Two tests in `e2e/hel1575-dashboard-tabs.spec.ts` flake on main: "an expired tab (16 minutes) refetches its panels"
(ticket's :593) and "logout clears the browser-stored warm copy" (ticket's :627, now :641). They fail every redesign
lane's CI intermittently. The second one may also hide a privacy defect: warm dashboard data from the previous session
surviving logout.

## What Changes

- Reproduce each flake on current main with `--repeat-each`, capture a failing trace, and establish the root cause
  by probe (no retries, no larger timeouts).
- Fix the test where the root cause is a test race; fix the app where it is an app defect.
- For an app defect, add a unit or seam test that is red before the fix and green after.
- Prove each test passes 40/40 after the fix.

## Capabilities

### New Capabilities

### Modified Capabilities

None expected. The warm cache's logout-clears behavior is already a requirement of `dashboard-tabs`; an app fix would
restore it, not change it. `skip_specs: true` is set. If the root cause turns out to need a new or changed requirement,
the plan is revised and re-gated before that work lands.

## Impact

- `e2e/hel1575-dashboard-tabs.spec.ts` (most likely).
- Possibly `frontend/src/features/dashboards/tabs/warm/*` and `frontend/src/features/auth/state/authSlice.ts` if
  :627 is an app defect, plus their unit tests.

## Non-goals

- HEL-1634's other per-user caches (output history, provenance, panels/dashboards slices), unless the :627 root cause
  is one of them. If the fix grows into HEL-1634's scope, escalate.
- Other main-CI flakes (`hel1685-draft-polish.spec.ts:252`, HEL-1583 phone dashboard at 375px), unless they share a
  root cause found here; then they are noted in the report, not fixed.
- Retries, longer timeouts, or `test.fixme`/skip.
