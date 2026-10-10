## Standing Constraints

- [C1] Split commits are behaviour-preserving moves only: no logic/JSX edits; the ONLY permitted dependency-array edit is adding provably-stable values (ref objects, useState setters, dispatch) that the linter requires once they become sub-hook params — no eslint-disable; test files change import-only in those commits; items 2 (lookup id) and 3 (warning wording) land in their own later commits.
- [C2] Every moved region is proven byte-identical (whitelisted new lines only) and the primitive hook sequence of StepCard and usePipelineDetailPage is proven unchanged, each with a recorded red run.
- [C4] Only permitted deps edit in the split is adding provably-stable values the linter requires; no eslint-disable; the F-146 identity characterization test is committed green on base first.
- [C3] Proof artifacts, scratch scripts, gate transcripts and screenshots go under `/home/matt/Development/helio/.concertino/runs/HEL-1465/evidence/`, never the repo root; dev-DB throwaway users only, every created id recorded and deleted by exact id.

## 1. Baseline

- [x] 1.1 Record base sizes and run the pipelines frontend test suite on base (`npm --prefix frontend test -- --testPathPatterns=features/pipelines`) and save the transcript.
- [x] 1.2 Commit the F-146 identity-stability characterization test (design D3) GREEN ON BASE as its own first commit; record its red run under a non-stable-dep mutation (reverted).
- [x] 1.3 Capture the RUNNING app on base (light + dark): pipeline with join, lookup (x2), aggregate, compute steps; a warning-bearing step expanded; a preview open. Screenshots + editor-region DOM snapshot to the evidence dir.

## 2. StepCard split (D1)

- [x] 2.1 Move `StepCardProps` to its own types module, verbatim.
- [x] 2.2 Extract `StepCardHeader`, `StepCardWarnings` (useId stays in StepCard), `StepCardPreviewTray` as verbatim JSX moves; StepCard.tsx <= ~250 lines.
- [x] 2.3 Commit (tests import-only, if touched at all).

## 3. usePipelineDetailPage split (D2)

- [x] 3.1 Extract C1 `usePipelineAnalyzeScheduler` in place (ends before the clearRunState unmount effect).
- [x] 3.2 Extract C2 `usePipelineAnalyzeLookups` in place (ends at `getAnalyzeWarnings`; isDirty/beforeunload/pipelineName stay in host).
- [x] 3.3 Extract C3 `usePipelineStepStructure` in place.
- [x] 3.4 Extract C4 `usePipelineStepMutations` in place (two consecutive hooks if > ~250).
- [x] 3.5 Commit(s); record final line counts of every touched/new file.

## 4. Split proof (D3)

- [x] 4.1 Byte-move script over every moved region + red run (one-char edit -> DIFFERENT, reverted -> IDENTICAL).
- [x] 4.2 `git diff --color-moved=zebra` saved; every non-moved added line listed and justified.
- [x] 4.3 Hook-sequence script for StepCard and usePipelineDetailPage (sub-hooks inlined at call sites) + red run (swap two hook lines -> DIFFERENT).
- [x] 4.4 Deps-array check (branch = base + whitelisted stable names, each traced to its base declaration) + red run (add `steps` -> FAIL).
- [x] 4.5 Show split commits' test-file diffs are import-only; characterization test green on the branch head.

## 5. Unique lookup id (D4) — separate commit

- [x] 5.1 Add a test rendering two lookup editors asserting distinct ids, single-occurrence ids, and each card's `<label htmlFor>` resolving to its own input (not getAllByLabelText — aria-label makes that pass on base); run it red on the split head.
- [x] 5.2 `LookupConfig` uses `useId()` for the "Reference match field" input/label; test green; commit.

## 6. Lookup warning wording (D5) — separate commit

- [ ] 6.1 Grep backend/frontend/helio-mcp/e2e for "source key"/"lookup key"/consumers of the lookup warning text.
- [ ] 6.2 Add `AnalyzeSchemaWarningsSpec` assertions for all three lookup messages (type mismatch, missing reference match field, missing match field: new phrases present, old absent) and join missing-key message unchanged; run red on base wording.
- [ ] 6.3 Update `AnalyzeSchemaWarnings.scala` messages per D5; spec green (`sbt "testOnly *AnalyzeSchemaWarningsSpec"` plus `testFull` before handoff); commit.

## 7. Verification

- [ ] 7.1 Full frontend gates (lint, typecheck, format:check, jest) and backend `sbt testFull`.
- [ ] 7.2 RUNNING app after (light + dark), same scenario as 1.3, compared to base; the only intended differences are the lookup input id values and the lookup warning wording.
