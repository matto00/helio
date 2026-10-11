## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `332c1cbf5995d92e64466fc1d1849ba2e04e56d0` against base `744c3772000379426a699e7abae2a2543e0953ee`
(resolved live by `resolve-review-base.sh`; equals `git merge-base HEAD origin/main`). Evaluator evidence lives under
`/home/matt/Development/helio/.concertino/runs/HEL-1478/evidence/eval-1/`, outside the worktree (durable).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (7 `react-hooks/refs` errors): fixed by D1a (five layout-effect mirrors), D1b (`seedToken` state plus an
  effect-written `consumedSeedTokenRef`) and D1c (`pendingDraftIds` state mirror). Re-probed by the evaluator (below).
- AC2 (debounced effect moved): `usePipelineDebouncedAnalyze.ts`, called right after the watchdog. Byte-move proven.
- AC3 (C5-C9 extracted): `usePipelineRunStream`, `usePipelinePageLoad`, `usePipelineOutputSheets`,
  `usePipelineSourceScheduleActions`, `usePipelineRunAndSaveActions`. Byte-move, hook-sequence and deps proofs reproduced.
- AC4: `npm run lint` passes with zero warnings. `git grep -c eslint-disable` over `frontend/src` gives 44 at base and 44
  at head. The diff's only added disable is the moved L423 line (one `+` and one `-`).
- AC5: running app compared base vs head, light and dark. Byte-identical (see Phase 3).
- AC6: the watchdog comment now names `usePipelineDebouncedAnalyze` (comment-only). spec.md:66 was retitled on the title
  line only. `check:spec-structure` and `check:openspec` are green.
- D1d: implemented per the owner ruling `rewrite-deep-link` (events.jsonl escalation.answered, answer_source human).
  Items 4/5 were deferred to HEL-1481 per the approved scope.
- Tasks: all ticked except 2.6, which correctly stays unticked because no STOP was triggered.
- CONSTRAINTS C1-C5 are honoured. C1 and C2 were verified above and below. C4: evidence is under the run dir. C5:
  `backend/.env` was never printed or sourced by the evaluator.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates, fresh, run in WORKTREE_PATH** (`eval-1/gates/`):
- lint: exit 0
- format:check: exit 0
- `npm test`: root 44 suites / 433 tests and frontend 505 suites / 5280 tests, exit 0
- frontend build: exit 0 (the chunk-size notice is pre-existing)
- typecheck: exit 0

**Lint masking proofs** (`eval-1/lint/`). Each probe ran in a throwaway detached worktree with the suppression line
deleted, so the executor's tree was never touched:
- base 744c37720 (red): 8 messages. Seven `react-hooks/refs` errors at L109/129/164/274/336/339/499, plus the
  `exhaustive-deps` warning at L423.
- post-D1d ff81eb622, host: the complete JSON is exactly 1 message, `exhaustive-deps` at L441: "React Hook useEffect
  has a missing dependency: 'steps.length'. ...". This is byte-equal to base.
- head, `usePipelineDebouncedAnalyze.ts`: exactly 1 message, the same `'steps.length'` text, at L129.

**Test-file discipline:** only 09a73f223 (two files) and ceffa6520 (one file) touch `*.test.*`. Every later commit
touches 0 test files, and `git diff ceffa6520 HEAD -- '*.test.*'` is empty. The identity-test change is additive only
(13 keys added).

**Characterization** (`eval-1/char/`, `eval-1/mutations/`):
- Green on base: the three new or extended files were copied into a base 744c37720 scratch worktree and run alongside
  the reused `outputSwap` test. Result: 4 suites, 17 tests, all green. At head: 17/17 green.
- Evaluator's own red mutations, all recorded and reverted:
  - M1 (base): deleting `skipNextAnalyzeRef.current = true` turns 6/8 red, including F-105 seed-at-mount and T3.
  - M2 (base): dropping the draft exclusion turns T2 draft and T2 L370 red.
  - M3 (head): omitting the `.catch` `syncPendingDraftIds()` turns T2 L370 red.
  - M4 (head): initialising `deepLinkSeen` to the current pair turns (vi) red.
  - M5 (head): dropping the `allOutputsRef` layout effect turns both T4 cases red.
  - M6 (head): dropping the param clear turns (ii) and (iii) red.

**Split proof** (`eval-1/split/`). `split_proof.py` was re-run against ff81eb622 on a clean detached copy of HEAD. It
reported PASS: moves IDENTICAL, 112 = 112 primitive hooks, 58 deps arrays, 13 stable additions. Red runs:
- the script's built-in `--red-move`, `--red-seq` and `--red-deps` all FAIL as expected;
- the evaluator's own on-disk mutations FAIL as expected: a 1-byte edit in C7, `[id]` added to
  `handleCloseOutputSheet`, and a swap of the C7/C8 call order.

The whitelist was spot-checked against the ff81eb622 declarations. It contains 10 distinct names (13 additions), and
every one is a `useRef` or a `useState` setter: L108, L160, L168, L170, L176, L191, L192, L209, L210, L233.

**D1 reader inventory and transition argument: they hold.**
- Every reader of the five mirrors is a handler, a timer or a promise continuation.
- Project-wide `useLayoutEffect` users (Select, DataGrid, usePortalPopover, ActionsMenu, useScrollEdges,
  useVirtualRows, ProvenancePopover) never call a host handler.
- The two pipelines ref callbacks only assign local refs.
- `setSteps` and `setSseActive` are never called inside a transition.

**D1b equivalence: verified.** `setStepsInitialized` is only ever set `true`, so the seed block runs at most once per
mount, and only from `steps = []` to a non-empty persisted list. So `seedToken` changes only in the render where
`stepsFingerprint` changes. The empty-persisted edge case matches too: the base flag stays set until the first
non-empty run, and so does the unconsumed token.

**D1b/D1c, no extra renders:**
- T3 is green at both base and head.
- Independently, a scratch render-count probe of draft insert, complete and create-failure gave identical counts on base
  and head: `{open 4, afterInsert 5, insertSettled 5, afterComplete 6, completeSettled 8, afterReject 9,
  rejectSettled 11, analyze 3}`. See `eval-1/renders/`.
- All four D1c sync sites sit in the same synchronous batch as an existing `setSteps` or `setDraftCreateErrors`.

**D1d: trigger equivalence verified.**
- The open fires only when the id resolves and the (searchParams, allOutputs) identity pair changed. That matches base's
  effect firings.
- `setSearchParams`-only changes cannot re-open, because a same-`search` pathname change also changes the route id and
  therefore `allOutputs`.
- StrictMode double-invocation is benign.
- The declared single difference (the sheet opens one commit earlier) is the only one.

### Phase 3: UI Review — PASS
Issues: none.

**Servers.** `start-servers.sh` plus `assert-phase.sh servers` passed for head. For the base side, the head vite I had
started was stopped and a base-744c37720 vite was started from a scratch worktree using the configured start command
with explicit pins (`PORT=6910 BACKEND_PORT=9817 npm run dev`). `start-servers.sh` refuses to reuse a backend from
another tree, and the backend is unchanged by this diff. I confirmed vite served base code (`skipNextAnalyzeRef` was
present in the served module).

**Captures and comparison** (`eval-1/shots/`, `eval-1/shots-compare.txt`). Throwaway user; scenario per design D4
(three steps, one Output, schedule bar, edit + revert, dry run, `?outputId=` sheet), light and dark.
- base-A, head-A and head-B are byte-identical PNGs and identical DOMs in all six shots (editor, after-dry-run,
  output-sheet, in both themes).
- The executor's 58/74-pixel after-dry-run delta is therefore not code-caused. My crop of their region shows scattered
  low-amplitude single pixels. Their own same-code control only showed that noise for dark, so it did not establish it
  for light by itself; mine does.
- base-B differs from all others in DOM only because its starting state was dirty: an aborted base-B dark attempt (a
  session loss mid-run, likely the general `/api` rate limit) left the expression persisted as `amount * 2 + 0`. That
  is a fixture artefact, visible in the DOM diff, and it was excluded from the comparison.
- `/analyze` counts, base and head in both themes: 1 on open, 1 after the edit, 1 after the revert.

**Console and deep-link check at head** (`eval-1/console-check.json`), both themes:
- the sheet opens from `?outputId=`, the param is cleared, and Escape closes it with nothing reopening;
- an unknown id opens nothing and the param stays;
- the only console errors are 3 x 404 on `GET /api/pipelines/:id/schedule`, because no schedule was seeded on that run.
  This is existing, expected behaviour.

**Breakpoints.** The diff touches no `.tsx`/`.css`/markup, and the DOM is byte-identical at 1280. No layout surface
changed, so a breakpoint sweep adds no information.

**Dev DB.** Both throwaway users and all their rows were deleted by exact id in guarded transactions with postcondition
checks and an independent re-read (`eval-1/dev-db-ids.txt`, `eval-1/dev-db-deletion-transcript.txt`). The servers I
started were stopped by verified cwd, the scratch worktrees were removed by exact path, and there is no `.playwright-mcp`
at the main checkout root.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- **Line counts in the PR body.** The executor's "base 869" is the post-D1d split-proof base (ff81eb622), not the
  ticket base. Measured values:
  - host: 816 at 744c37720, 869 at ff81eb622, 553 at HEAD;
  - new files: DebouncedAnalyze 149, RunStream 69, PageLoad 78, OutputSheets 124, SourceScheduleActions 58,
    RunAndSave 137;
  - grown files: StepCreation 389 → 405, StepStructure 271 → 274.
  The PR body should state 816 → 553.
- **`usePipelineStepCreation.ts` is now over 400 lines** (405). CONTRIBUTING L24 asks for a split proposal in the PR
  description once a file crosses ~400. Cite it there, or add it to HEL-1481.
- **Stale positional comment pointers left by the moves.** This is the same defect class AC6 fixed for HEL-1465.
  - Introduced here:
    - `usePipelineOutputSheets.ts:66-67` "(like the derived-state block above)": that block is in the host.
    - `usePipelineDebouncedAnalyze.ts:97` "see `pendingSinceRef`'s comment above": the comment is in the host.
  - Pre-existing, moved verbatim:
    - `usePipelineOutputSheets.ts:26` "`EMPTY_ANALYZE_COLUMNS` pattern above" (it lives in `usePipelineAnalyzeLookups.ts`).
    - `usePipelineRunAndSaveActions.ts:46,50` "below" for the SSE `onTerminal` handler (now in `usePipelineRunStream.ts`).

  A comment-only fix inside moved regions would make the HEAD-anchored split proof report non-verbatim. Either
  re-anchor the proof at cbe76da4d and do a comment-only commit, or fold these into HEL-1481.
