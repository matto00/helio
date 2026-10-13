## Standing Constraints

- [C1] Do not edit files touched by parked PRs #998/#994 (laneLayout.ts, SecondaryInputPicker.tsx, patchSets/*, assistant/proposalExtraction*).
- [C2] Split commits are byte-proven moves against SPLIT_BASE; no new eslint-disable; behaviour change only in the last commit.

### Frontend

## 1. Characterization (green on SPLIT_BASE, own commit)

- [x] 1.1 Add `state/pipelinesSlice.exports.test.ts` pinning the sorted runtime export list; record its red run  
  Proof: proof/export-surface-red-runtime.txt, proof/export-surface-red-type.txt
- [x] 1.2 Confirm `usePipelineDetailPage.identity.test.tsx` covers every cluster D3 moves; extend + red run if not  
  Proof: proof/identity-test-runs.txt (green after split; red when stepsRef loses stable identity)

## 2. Slice split (D2)

- [x] 2.1 Move thunks+helpers to `state/pipelinesThunks.ts`, state type+initialState to `state/pipelinesState.ts`; re-export
- [x] 2.2 Byte-move proof with a red run; tsc, lint, slice tests green; no importer edits  
  Proof: proof/slice-split-generate.sh, slice-split-verify.py, slice-split-verify.{green,red}.txt

## 3. Hook split (D3)

- [x] 3.1 Extract K1-K4 (D3); record measured line count; file Follow-up for remainder if still > ~400  
  Proof: measured: host 592 -> 421 after commit 3, 427 after commit 7; Follow-up for remainder to be filed by orchestrator
- [x] 3.2 Byte-move + hook-sequence proofs; identity test green; test diffs import-only  
  Proof: proof/hook-split-generate.py, hook-split-host.py, hook-split-verify.py (+ .green/.red-bytes), hook-sequence.cjs, hook-sequence.{base,after-commit3,diff,red-order}.txt

## 4. Shared river skeleton (D4)

- [x] 4.1 Add `ui/PipelineRiverSkeleton.tsx`; use it in `PipelineDetailSkeleton.tsx` and `PipelineDetailPage.tsx`
- [x] 4.2 Record outerHTML before/after for both call sites  
  Proof: proof/skeleton-dom-after.txt; characterization test green on base (commit e6ab69ca3) and after

### Tests

## 5. Test-helper dedupe (D6)

- [x] 5.1 Add `ui/pipelineDetailPageTestUtils.ts`; replace the three helper bodies; per-file test counts unchanged  
  Proof: proof/helper-test-counts-base.txt vs helper-test-counts-after.txt (identical)

## 6. Switch-test tightening (D7)

- [x] 6.1 Rename L388/L421/it.each L454 + comments; add scoped no-"A"-after-switch assertion; red by removing mountedRef gate  
  Proof: proof/switch-test-red-runs.txt
- [x] 6.2 Add `toHaveBeenLastCalledWith("B")` to the direct-fetch test
- [x] 6.3 Record act() warning counts before/after; reach zero without console silencing  
  Proof: proof/switch-test-act-counts.txt (13 -> 0), switch-test-base.txt, switch-test-after.txt

## 7. Steps error state with Retry (D8)

- [x] 7.1 Write failing tests for the spec scenarios + footer count + analyze-on-retry, red on the pre-change tree  
  Proof: proof/steps-error-red.txt (6 failed pre-change), steps-error-green.txt
- [x] 7.2 Add `retryStepsLoad`/`onStepsRetry` to `usePipelinePageLoad`, `stepsFailed`/`retryStepsLoad` to the host
- [x] 7.3 Render section `PageStatus` error; null footer step count while failed; re-analyze on retry if analyze failed; rewrite switch L291 test  
  Proof: proof/steps-error-mutations.txt, proof/steps-error-mutation-mountedref.txt
- [x] 7.4 Full frontend gates (lint, typecheck, format, jest in ≤600s foreground shards, workers ≤3, nice -n 19)
