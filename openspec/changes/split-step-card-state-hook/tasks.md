## Standing Constraints

- [C1] Split commits are behaviour-preserving byte-proven moves only; no new `eslint-disable`; deps arrays equal base
  (only provably-stable additions, otherwise stop and escalate); test files untouched or import-only in split commits.
- [C2] Execution starts only after HEL-1478 has merged to origin/main; re-sync, record `SPLIT_BASE`, re-verify premise.
  Never edit HEL-1478's worktree.
- [C3] Evidence, scratch scripts, gate transcripts, Playwright output and screenshots go under
  `/home/matt/Development/helio/.concertino/runs/HEL-1481/evidence/`; dev-DB throwaway users deleted by exact id; never
  print `backend/.env`; `git -C` not `cd`; memory >= 15 GB before commits; no pkill/pgrep/killall.
- [C4] Bugs found become follow-up notes in the report, not fixes in this PR.
- [C5] Machine rule: full jest and heavy jobs under `nice -n 19`; MemAvailable >= 15 GB before heavy runs; at most two
  concurrent `sbt testFull` machine-wide (this run is frontend-only: no `sbt testFull`).

## 1. Baseline (on SPLIT_BASE)

- [x] 1.1 Confirm HEL-1478 is merged; rebase/reset the branch onto origin/main; record `SPLIT_BASE`; re-measure both
  files and re-check design.md line ranges.
- [x] 1.2 Run the pipelines frontend tests on base and save the transcript.
- [x] 1.3 Commit `hooks/useStepCardState.characterization.test.ts` (design D4: return shape, 26-handler payload/error
  table, emitOrPersist, 26-row resync table + opType row, accumulating handlers twice-with-rerender, local echo) GREEN
  on base as its own commit; record the required red runs from D4 (incl. two separate non-fixture resync setter
  deletions and a stale-value accumulating-handler mutation), each reverted.
- [x] 1.4 Record the existing coverage of `handleInstantiateShape` and a red run of the identity test under a per-render-new
  dep mutation such as an inline `{}` (reverted).
- [x] 1.5 Capture the RUNNING app on base (light + dark) per design D5.

## 2. useStepCardState split (D1)

- [x] 2.1 Extract M1 `stepCardStateTypes.ts` (verbatim) with a re-export from the host.
- [x] 2.2 Extract M2 `useStepCardEditorState.ts` (contiguous L152–242 region, verbatim).
- [x] 2.3 Extract M3 `useStepCardPersist.ts` (const + refs/effect/persist + emitOrPersist, verbatim).
- [x] 2.4 Extract M4a/M4b handler modules (verbatim, no hook primitives); state the naming choice.
- [x] 2.5 Host keeps signature and return key order; every file ≤ ~250; commit.

## 3. usePipelineStepStructure trim (D2)

- [x] 3.1 Extract M5 `usePipelineShapeInstantiation.ts` in place, deps unchanged; host < ~250; commit.

## 4. Split proof (D5)

- [x] 4.1 Byte-move script over every moved region + red run.
- [x] 4.2 `git diff --color-moved=zebra` saved; non-moved added lines listed and justified.
- [x] 4.3 Hook-sequence script for both hooks + red run.
- [x] 4.4 Deps check + red run.
- [x] 4.5 Test files import-only/untouched in split commits; characterization + identity tests green on head.

## 5. Verification

- [x] 5.1 Full frontend gates (lint zero-warnings, typecheck, format:check, jest).
- [x] 5.2 RUNNING app after (light + dark), same scenario as 1.5, compared to base; no intended differences.
- [x] 5.3 Re-sync with origin/main before handoff; re-run gates if it moved.

## 6. usePipelineStepCreation split (D6, fold-in item 3)

- [x] 6.1 Record exact ranges at SPLIT_BASE; record existing draft-create test coverage.
- [x] 6.2 Red runs of the identity test under an inline `{}` dep on `createDraftIfComplete` and on `handleAddLaneStep`
  (each reverted).
- [x] 6.3 Extract M6 `usePipelineLaneStepCreation` and M7 `usePipelineDraftCreate` in place, consecutively; deps = base
  (+ only `creatingDraftIdsRef`/`setDraftCreateErrors` on M7); host < ~400 (target ~265); commit (tests untouched).
- [x] 6.4 Byte-move, hook-sequence, deps proofs with red runs.

## 7. Cross-file comment pointers (D7, fold-in item 4)

- [x] 7.1 Fix the five ticket-listed sites plus this PR's own cross-file pointers (grep moved comments for
  above/below); list each site and its resolution.
- [x] 7.2 Comment-only commit, LAST; proof that only comment text changed.

## 8. Final verification (all items)

- [x] 8.1 Full frontend gates on the final head (lint zero-warnings, typecheck, format:check, jest under nice -n 19).
- [x] 8.2 Running app re-check covering lane-step add and an AI-step draft create (light + dark) vs SPLIT_BASE.
- [x] 8.3 Re-sync with origin/main before handoff.
