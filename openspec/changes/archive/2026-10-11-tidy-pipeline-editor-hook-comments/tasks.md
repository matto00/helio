## Standing Constraints

- [C1] No behaviour change except item 7 if fixed; no new `eslint-disable`; zero-warnings lint holds.
- [C2] Every line reference re-derived from current main; no HEL-1501 scope.

### Frontend

## 1. Comments (items 1-4)

- [x] 1.1 Fix the "eight per-op-kind"/"eight typed change handlers" header in `useStepCardState.ts`
- [x] 1.2 Fix "20 change handlers" to 26 in `useStepCardPersist.ts` and `useStepCardState.test.ts` header
- [x] 1.3 Probe the shape-at-anchor-with-lane reparent hazard; rewrite `anchorHasTail` comments to proven facts; file bug if real
- [x] 1.4 Re-point the "defined below" `onTerminal` comment in `usePipelineDetailPage.ts` to `usePipelineRunStream.ts`
- [x] 1.5 Re-wrap comment lines over 120 columns in the split hooks; record awk before/after

## 2. Shared EMPTY_OUTPUTS (item 5)

- [x] 2.1 Export one sentinel and import it in `ui/LaneColumn.tsx` and `ui/PipelineRiverView.tsx`
- [x] 2.2 Update the pointer comment in `usePipelineOutputSheets.ts`

## 3. Item 7 investigation

- [x] 3.1 Reproduce via live capture.mjs; explain BOTH convertformat PATCHes, with and without the 422
- [x] 3.2 Probe-confirm the root cause
- [x] 3.3 Fix (trivial, behaviour-preserving, red-first test) or file a Follow-up ticket with the repro

### Tests

## 4. Tests and proofs

- [x] 4.1 Add the EMPTY_OUTPUTS identity guard for all 3 call sites; mutate each site separately with inline `[]`
- [x] 4.2 Move the characterization tables to `useStepCardState.characterization.fixtures.ts`
- [x] 4.3 Record before/after jest `--json` test counts and `expect(` counts; mutate one row per moved table, show red
- [x] 4.4 Run lint, typecheck, format:check, and the pipelines jest suites
