## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `332c1cbf5995d92e64466fc1d1849ba2e04e56d0` against the base resolved live by `resolve-review-base.sh`:
`744c3772000379426a699e7abae2a2543e0953ee`. Evidence is in
`/home/matt/Development/helio/.concertino/runs/HEL-1478/evidence/skeptic-final-1/`, outside the worktree. The
`persist-evidence.sh` copies are under `.../evidence/.concertino/runs/HEL-1478/evidence/skeptic-final-1/`.

### What I verified (with evidence)

**Gates, run fresh at HEAD in WORKTREE_PATH**
- `npm run lint` (`eslint src --max-warnings=0`) exits 0 (`lint.txt`).
- `npm run typecheck` exits 0.
- `jest src/features/pipelines` (3 workers): 103 suites and 1387 tests pass, exit 0 (`jest-pipelines.txt`).

**AC4: no new eslint-disable**
- The diff `744c37720...HEAD -- frontend` has exactly one added and one removed `eslint-disable` line. Both are the same
  `react-hooks/exhaustive-deps` suppression, moved.
- `git grep -c eslint-disable` over `frontend/src` gives 44 at base and 44 at HEAD.

**AC1 and the masking proof, reproduced myself in throwaway detached worktrees**
- HEAD with the moved suppression deleted: ESLint JSON over all 28 files in `pipelines/hooks/` gives exactly one
  message. It is `usePipelineDebouncedAnalyze.ts:129 react-hooks/exhaustive-deps`, "missing dependency: 'steps.length'",
  the same text as base (`lint-probe-head-suppression-deleted.json`).
- Red run on base with the same deletion: 7 `react-hooks/refs` errors (L109, 129, 164, 274, 336, 339, 499) plus the same
  `steps.length` warning at L423 (`lint-probe-base-red.json`).
- No render-time ref access remains in the host. Lint is clean with no suppression in the host.

**Characterization green on base**
- The three new or extended test files at HEAD were copied into a base 744c37720 worktree and run with the reused
  `PipelineDetailPage.outputSwap` test: 4 suites and 17 tests pass (`char-on-base.txt`).
- The same tests are green at HEAD inside the 1387 above.

**Test-file discipline, checked per commit with `git show --stat`**
- Only 09a73f223 (characterization) and ceffa6520 (deep-link characterization) touch `*.test.*`.
- No D1 code commit and no split commit touches a test file.

**Split proof**
- I re-ran `split_proof.py` against ff81eb622 on a clean detached copy of HEAD. Result: PASS. The moves are identical,
  the hook sequence is 112 = 112 primitive hooks, and 58 deps arrays give 13 stable additions.
- Its `--red-move`, `--red-seq` and `--red-deps` runs each FAIL, exit 1 (`split-green.txt`, `split-red--*.txt`). The
  green output is line-identical to the evaluator's.
- I also ran my own check, independent of the script's region choices. Every line of the six new files that is not
  verbatim in the ff81eb622 host is one of these:
  - an import;
  - the params type or destructuring;
  - a docblock;
  - a `return`;
  - a whitelisted deps edit (refs or `useState` setters only).
- No logic line was rewritten.

**D1 equivalence, reviewed adversarially in the code**
- **Layout-effect readers.** I listed every reader of the five mirror refs. All of them are event handlers, timers or
  promise continuations. None reads during render, and none sits in a layout effect or ref callback.
  - A child's layout effect runs before the host's. So I checked all 7 `useLayoutEffect` users in `frontend/src`
    (Select, DataGrid, usePortalPopover, ActionsMenu, useScrollEdges, useVirtualRows, ProvenancePopover). None calls a
    host handler.
  - ActionsMenu's focus-in-layout-effect could only fire a blur handler in a commit that does not change `steps`.
- **Effect order.** The hook order is unchanged (proof above). The `allOutputsRef` layout effect stays at its original
  relative position inside C7.
- **D1b seed path.**
  - `setStepsInitialized` is only ever set to `true`, so the seed fires at most once per mount.
  - When `persistedSteps` is empty the seed never fires. The block requires `persistedSteps.length > 0`.
  - The token check sits after the `steps.length === 0` early return, so it is consumed on exactly the run where base
    consumed its flag.
  - StrictMode double-render or double-effect can only bump the token more than once, and the `!==` comparison is
    insensitive to that.
  - A discarded transition render discards the render-phase `setSeedToken` along with it.
- **D1c sync.** `pendingDraftMetaRef` is mutated at exactly 4 sites (`usePipelineStepCreation.ts` L162, L275, L332 and
  L385), and each is followed by `syncPendingDraftIds()`.
  - L332 runs inside `handleStepConfigChange`'s synchronous `setSteps` batch.
  - L385 runs in the same `.catch` as `setDraftCreateErrors`.
  - `usePipelineAnalyzeLookups` only reads the ref, inside callbacks.
- **D1d.** The render-time open is gated on a resolved id plus an identity change of the (searchParams, allOutputs) pair,
  with a `null` sentinel. The param clear stays in the effect with base's deps.

**Running app (AC5): base vs HEAD in light and dark, with my own throwaway user, seed and probe**
- Servers came up through `start-servers.sh` and `assert-phase.sh servers` (PASS). For base, I stopped my HEAD vite and
  served base 744c37720 from a scratch worktree with the configured pinned command. A `curl` of the served
  `usePipelineDetailPage.ts` confirmed base code: `skipNextAnalyzeRef` appears 4 times (`base-served-check.txt`).
- Scenario: pipeline A (3 steps, one Output, a schedule) and pipeline B (1 step, one Output). Steps:
  1. open A, then edit and revert an expression;
  2. in-app deep link `?outputId=` on A, then Escape;
  3. an unknown id;
  4. **in-app re-navigation A to B with B's deep link**;
  5. back to A with A's deep link.
- Base and HEAD summaries are identical in both themes (`base-probe-summary.json`, `head-probe-summary.json`):
  - `/analyze` count is 1 on open, 1 after the edit and 1 after the revert;
  - the sheet opens for A, the param clears, and the sheet stays closed after Escape;
  - an unknown id opens nothing and keeps the param;
  - re-navigation to B opens B's sheet, and back to A opens A's;
  - the only console error is one existing 404.
- Screenshots: 8 views per side (editor, step open, sheet A, sheet B, each in light and dark).
  - 6 of 8 are pixel-identical.
  - sheet-B differs by 1 pixel (light) and 5 pixels (dark) in the header, under the modal's blurred backdrop
    (`shots-compare.txt`). In crops of that region (`shots/crop-*-dark-sheet-B.png`) base and HEAD look the same to the
    eye.
  - The diff changes no markup, CSS or `.tsx`, so this is backdrop render noise.
- I looked at the HEAD screenshots myself (dark editor, light sheet A). Nothing is off-pattern, and no UI was changed.

**AC2 / AC3 / AC6**
- The debounced effect lives in `usePipelineDebouncedAnalyze.ts`, called right after the watchdog.
- C5-C9 are extracted. The new files are 58-149 lines.
- The watchdog comment now names `usePipelineDebouncedAnalyze`.
- spec.md:66 is retitled to "Lookup string match field against integer reference match field" (title line only).

**Scope cut (HEL-1481)**
- I read the ticket in Linear. It carries items 4 and 5 (`useStepCardState.ts`, `usePipelineStepStructure.ts`), which
  is honest against the ticket's driver-approved scope clause.

**Gate-defect check**
- No report here rests on mtime ordering. Every equality claim above is content or checksum based.

### Verdict: CONFIRM

### Non-blocking notes
1. **Stale positional comment pointers, my judgement.** I accept them as move artefacts, not merge blockers.
   - Two existed on base and were moved verbatim:
     - `usePipelineOutputSheets.ts:26` "`EMPTY_ANALYZE_COLUMNS` pattern above" was already false at 744c37720, where the
       constant lives in `usePipelineAnalyzeLookups.ts`.
     - `usePipelineRunAndSaveActions.ts:46,50` "below" for `onTerminal` was already false on base, where `onTerminal`
       (~L223) sits above `refreshVisibleOutputPreviews` (~L647).
   - Two were made false by this PR:
     - `usePipelineDebouncedAnalyze.ts:97` "see `pendingSinceRef`'s comment above" (by D2);
     - `usePipelineOutputSheets.ts:66-67` "(like the derived-state block above)", which was written in D1d and moved by C7.
   - Strictly, the D2 one diverges from design D5 ("comments made false by D1/D2 fixed in the commit that falsifies
     them"). D5 conflicts with D2's own byte-identical-body requirement, and the executor kept the byte proof.
   - Both pointers name their target (`pendingSinceRef`, "the derived-state block"), so a reader can still resolve them.
   - Recommendation: before merge, either add one comment-only commit with the split proof re-anchored at cbe76da4d and
     the diff limited to comment lines, or list all four in the PR body and on a follow-up. HEL-1481 does not currently
     mention them.
2. **Files over CONTRIBUTING's 400-line threshold.** The host is at 553 (816 on base, which the design's Non-Goals
   accept) and `usePipelineStepCreation.ts` at 405. Both are over the threshold, so the PR body should carry the split
   proposal (or a pointer to HEL-1481).
3. **Pre-existing behaviour that needs triage, not caused by this change.** On an in-app navigation from pipeline A
   (3 steps) to pipeline B (1 step), the page showed 3 step-card toggles on B, identically on base and HEAD
   (`navB_stepCards: 3` in both probe summaries).
   - This is consistent with `stepsInitialized` never resetting on an `:id` change: the route element is not keyed and
     the derived-state block is unchanged.
   - I did not dig further. It is worth one ticket so someone can confirm it with the sidebar link.

### Hygiene
- My throwaway user, source, 2 pipelines, 4 steps, 2 Outputs and schedule were deleted by exact id in one guarded
  transaction with postconditions, then independently re-read: 0 rows remain (`dev-db-ids.txt`,
  `dev-db-deletion-transcript.txt`).
- The servers I started were stopped by pid, each with its cwd verified first:
  - HEAD vite 302351/302336;
  - base vite 308278/308266;
  - backend 302008/301806.
- The scratch worktrees were removed by exact path.
- `backend/.env` was never printed; only variable names were listed.
- There is no `.playwright-mcp` at the main checkout root.
