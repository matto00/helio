# HEL-1634 red run (task 1.4)

Recorded against unmodified application code. The only non-test files added before this commit are
scaffolding so the guard compiles: `frontend/src/shared/session/sessionReset.ts` (empty no-op
registry API) and `sessionStateAllowlist.ts` (the storage key lists only; the module-state list is
empty). Neither changes behaviour.

- `jest-red.txt`: `npx jest src/shared/session` -> 4 suites failed, 45 tests failed, 6 passed.
  - Failing: every per-slice test, the root-reducer test, the sticky-toast test, the four late-response
    tests, every module-cache test (provenance, history, comparison, insight chrome, filter
    capabilities, saved rows, pipeline ownership, keyboard write timer), the storage tests, the Home
    dot and Home summary tests, the guard's module-state test (135 unaccounted identifiers) and
    runtime half (cleared keys remain). Each fails on A's data still being served, not on a compile
    or import error.
  - The 6 passing tests are guards, not red proofs: the seed-table coverage test, the detector
    shape test, the storage-key-listed test (the storage lists are filled), the `via` check and the
    two allowlist-reason checks (vacuous while their lists are empty).
- `e2e-red.txt`: `e2e/hel1634-logout-user-switch.spec.ts` fails because B's Home summary request
  carries `dashboardIds=<A's dashboard>`, `/api/dashboard-changes?ids=<A's dashboard>` and a
  preferences PATCH with A's id, and because A's dashboard is still in B's dashboards list.
