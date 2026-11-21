## Why

`e2e/hel1786-shared-dashboard-freshness.spec.ts:309` (editor) failed on main (job 136742317338): for the whole 15 s
`expectFact` window the editor's freshness line read "refreshed 17 seconds ago" while the owner's view of the latest run
said "last run failed". (`<>` is the test's own mismatch separator, not UI text.) A flaky gate on main costs every lane a
rerun, and a real grantee/owner disagreement would be a HEL-1786 correctness bug.

## What Changes

- Root-cause the disagreement by probe (systematic-debugging law) and record the evidence.
- If the cause is the test (it compares a live owner read against a grantee view that is refreshed by a 15 s
  periodic poll, inside a 15 s window, while a late HEL-1093 auto-run can land): make `expectFact` / the spec wait on a
  settled state (no pending auto-run, or the grantee's own panel-status read agreeing with the owner) rather than on time,
  without weakening what it asserts.
- If the cause is the UI (the grantee's derived fact differs from the owner's for the same panel-status data, or stays
  wrong past the next poll): fix the derivation/store with a failing-first unit test, and add a spec delta.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none expected; `skip_specs: true` provisionally. If the probe shows a UI bug that changes observable behavior, a
`dashboard-grantee-access` delta is added and `skip_specs` removed.)

## Impact

`e2e/hel1786-shared-dashboard-freshness.spec.ts`; possibly `frontend/src/features/panels/state/dashboardMeta.ts`,
`panelStatusStore.ts`, `frontend/src/app/dashboardMeta/RefreshFact.tsx`. No backend, schema or migration change.

## Non-goals

- Changing the 15 s panel-status poll cadence or the HEL-1786 product behavior unless the probe proves a defect.
- Other listed flakes (C11) and the sibling lanes HEL-1796 / HEL-1805.
