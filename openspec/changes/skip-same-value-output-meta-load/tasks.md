## Standing Constraints

- [C1] A bare renderHook of useOutputMeta cannot demonstrate the redundant render (eager bailout); red/green proofs must be at PanelCardBody level or via a wrapper with another pending mount-time update, with exact before/after render counts; bare hook tests are labelled GUARD and shown failable by a stated mutation.
- [C2] No render-time ref writes (react-hooks/refs lint error); keep any ref mirror in sync next to setters or in an effect declared before the fetch effect, or derive loading from resolved-for id.

## 1. Proof first (red)

- [x] 1.1 Add a PanelCardBody render-count-on-mount test (cache-miss output panel, never-resolving fetches, everything inside act, cache/freshness reset between tests) asserting the exact post-fix PanelCardBody render count; run it against the CURRENT hook and record the RED output with the exact pre-fix count (expected one higher).
- [x] 1.2 Add a null-branch render-count test: a wrapper component calling `useOutputMeta(null)` plus one other mount-time state update (or a real consumer in that situation), inside act, asserting the exact post-fix render count; record RED on the current hook with the exact pre-fix count.
- [x] 1.3 Add hook-level GUARD tests (renderHook, cache reset between tests) pinning loading transitions: cache-miss mount (true), resolve (false), reject (false, output null), loaded→uncached id (true before resolve), loaded→null (false, output null), null mount (false), cache-hit mount (false, no fetch flash). Label them GUARD in the test file; demonstrate at least the loaded→uncached-id guard fails under a stated mutation (e.g. never queuing setIsLoading(true)) and record that output.

## 2. Fix

- [x] 2.1 Change `frontend/src/features/panels/hooks/useOutputMeta.ts` per design.md D1 (lint-clean, C2) so no same-value set is queued on mount (cache-miss `setIsLoading(true)` and null-branch reset); public signature/return shape unchanged. Verify 1.1 and 1.2 go GREEN and 1.3 stays green; `npm run lint` clean on the file.
- [x] 2.2 Correct HEL-1215's comments in `frontend/src/features/panels/ui/PanelCard.test.tsx` (~L590-616) that describe the removed same-value update; keep the absorption rerender. Verify that test still passes.

## 3. Regression

- [x] 3.1 Run every test touching useOutputMeta/outputMetaCache/PanelCard/PanelCardBody/PanelContent/usePanelRunRefresh (incl. HEL-1392's cache/staleness tests) and the full frontend `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`; all green. If the measured render drop is not exactly one, report the real numbers rather than forcing "one fewer".
