# Execution evidence (HEL-1481) — files under /home/matt/Development/helio/.concertino/runs/HEL-1481/evidence/

SPLIT_BASE = a29a7e5ce23108a682fd87aea7d79edd6b922dc9. Ranges re-read: `exec/ranges-at-split-base.md`.

Commits: characterization test (green on base) -> useStepCardState split -> usePipelineStepStructure trim -> this evidence/tasks commit.

- Characterization red runs (each reverted): `exec/red-summary-char.txt` (+ `exec/mutate.py`, `exec/redrun.sh`). 12 mutations, every one red in the intended group: swap keys (g1), flip captureErrors fillnull/dedupe (g2), datebucket blank-outputColumn (g2), convertformat via persist (g3), delete setCasts / setUpsertSourceConfig from the resync block (g4), drop the opType disjunct (g4b), stale selectedFields/renames/casts (g5), drop a local setter (g6).
- handleInstantiateShape coverage: `exec/instantiate-coverage.txt`; identity test red under inline `{}` dep: `exec/red-identity_inline_dep.txt`.
- Byte-move: `proof/d3-green.txt` / `proof/d3-red.txt` (useStepCardState), `proof/d3-structure-green.txt` / `-red.txt` (trim). Added (non-moved) lines: `proof/added-lines.txt`; color-moved: `proof/color-moved.ansi`, `proof/color-moved-summary.txt`.
- Hook sequence: `proof/d3b-green.txt` / `d3b-red.txt`. Deps: `proof/d4-green.txt` / `d4-red.txt`. Tests import-only: `proof/tests-diff.txt` (no existing test file touched).
- Gates: `proof/gates.txt` (lint/format/typecheck), `proof/jest-full.txt` (506 suites / 5454 tests), `proof/build.txt`.
- Running app before/after (light + dark): `app/shots/` (base-* vs head-*), `app/shots/dom-compare.txt`, summaries `base-summary.json` == `head-summary.json`. Throwaway user/data deleted by exact id: `app/dev-db-deletion-transcript.txt`.

## Fold-in (items 3-4), commits 9a78b4ea6 (D6 split) and 46a2f1c7f (D7 comment-only)
Evidence root: /home/matt/Development/helio/.concertino/runs/HEL-1481/evidence/
- D6 ranges at SPLIT_BASE: handleAddLaneStep comment+callback L227-318, createDraftIfComplete comment+callback L320-393 (base file `d6/base-usePipelineStepCreation.ts`). Existing coverage: `d6/draft-create-coverage.txt` (StepCard.enumSaveError.test.tsx, useStepCardState.test.ts) plus the identity test for `handleAddLaneStep` and, transitively, `createDraftIfComplete`.
- Identity test red under inline `{}` dep on handleAddLaneStep and on createDraftIfComplete separately: `d6/red-identity.txt`.
- Lint on the first M7 extraction demanded exactly `creatingDraftIdsRef` and `setDraftCreateErrors` (preserve-manual-memoization x2 + exhaustive-deps); added, nothing else; no suppression.
- Proofs: `d6/proof-green.txt`; red runs `d6/proof-red-bytes.txt`, `proof-red-hooks.txt`, `proof-red-deps.txt` (script `d6/d6_proof.py`).
- D7 sites and resolution (each now names the actual file): usePipelineOutputSheets.ts EMPTY_OUTPUTS -> ui/LaneColumn.tsx and EMPTY_ANALYZE_COLUMNS -> usePipelineAnalyzeLookups.ts; usePipelineOutputSheets.ts derived-state block -> usePipelineDetailPage.ts; usePipelineDebouncedAnalyze.ts pendingSinceRef comment -> usePipelineDetailPage.ts; usePipelineRunAndSaveActions.ts x2 onTerminal -> usePipelineRunStream.ts; ui/PipelineRiverView.tsx EMPTY_ANALYZE_COLUMNS -> usePipelineAnalyzeLookups.ts (included); this PR's own: useStepCardEditorState.ts (-> stepCardStateTypes.ts), stepCardStateTypes.ts (-> stepCardOpHandlers.ts), stepCardOpHandlers.ts (-> stepCardFieldHandlers.ts), usePipelineLaneStepCreation.ts handleInsertStep (-> usePipelineStepCreation.ts), usePipelineStepCreation.ts args comment "every mutation below". Greps of `above`/`below` over all new modules found no other cross-file pointer (same-file ones kept; anchorHasTail pointers stay follow-up).
- D7 proof: `d7/proof-green.txt` (every changed line is a comment; ts emit with removeComments identical per file), red `d7/proof-red.txt`.
- Final gates on head: `d6/gates-final.txt` (lint, format:check, typecheck, jest 506 suites / 5454 tests under nice -n 19, build; all exit 0).
- Running app (lane-step add + AI draft create incl. forced-500 error and retry, light + dark) vs SPLIT_BASE: `app2/shots/` (summaries and DOM identical; `dom-compare.txt`); servers stopped by PID; throwaway data deleted by exact id (`app2/dev-db-deletion-transcript.txt`).
- Re-sync: origin/main still a29a7e5ce.
