## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `a27a2e9cada4f67687a9e4b13f82034050d52b59` against the live base `a29a7e5ce23108a682fd87aea7d79edd6b922dc9`. I resolved the base with `resolve-review-base.sh` (rc=0), and it equals SPLIT_BASE.

My own scratch, scripts and outputs are in `/home/matt/Development/helio/.concertino/runs/HEL-1481/evidence/skeptic-final-1/`, called `sf1/` below. I wrote my own checks and did not re-run the executor's or the evaluator's proof scripts.

### What I verified (with evidence)

**Commit structure** (`git show --stat` per commit):
- `fe938643d`: the characterization test only (1 file).
- Split commits `fb10776a3`, `e56b79fe6` and `9a78b4ea6`: they touch `hooks/*.ts` source only. No test file is touched.
- `46a2f1c7f`: comment-only, 9 files.
- `c22e62acf` and `a27a2e9ca`: openspec artifacts only.
- No `eslint-disable` line was added to source. The only grep hits are in markdown.

**Byte-move, independent method** (`sf1/movecheck.py`, `movecheck-green.txt`):
- **Method:** a multiset check per split commit, comparing the lines removed from the host with the lines added anywhere.
  - "Lost" lines are lines that were removed and not re-added. They are only:
    - two import lines;
    - base `usePipelineStepCreation.ts:392`, the deps array that Prettier re-wrapped. It is covered by the deps check below.
  - Every "new" line is plumbing, and I read each one. The categories are:
    - imports;
    - args types and `Pick<ReturnType<…>>`;
    - the function signature or destructure;
    - call sites;
    - `return` objects;
    - three new one-line or three-line doc comments.
  - No new logic line exists.
- **Order:** `sf1/ordercheck.py` and `ordercheck-green.txt` check order. Every substantial (>25 character) base line in each new module appears as an in-order subsequence of the parent host. There are two apparent exceptions, both diagnosed with `orderdiag.py`:
  - a destructure identifier in the host;
  - a duplicated `pushToast` args-type line.

  Both are plumbing.

**Hook primitive sequence** (comment-stripped grep counts, base vs branch with sub-hooks inlined):
- `useStepCardState`: useState x30, useRef x2, useEffect x1 on both base and branch. `build*` handler builders contain no hooks. They are called after `useStepCardEditorState` and `useStepCardPersist`, so the order is the same as base.
- `usePipelineStepStructure`: useCallback, `usePipelineStepCreation`, useCallback, then the shape callback in place.
- `usePipelineStepCreation`: useRef, useState x2, useCallback, useRef x2, then 6 useCallbacks plus the lane and draft sub-hooks (1 useCallback each) in the last two positions. This matches base's 8 useCallbacks.

**Deps** (`sf1/deps-*.txt`, diff of every deps array in `hooks/` at base vs HEAD):
- The only changes are relocations:
  - `[id, pushToast, roots, setSteps, setStepsInitialized]` and `[]` moved verbatim;
  - M7's array is base plus exactly `creatingDraftIdsRef` and `setDraftCreateErrors`.
- I traced both additions to base: `creatingDraftIdsRef` is `useRef` at `usePipelineStepCreation.ts:66`, and `setDraftCreateErrors` is a `useState` setter at `:70`. Both are stable.

**Characterization test is green on base and genuinely failable:**
- With the base `useStepCardState.ts` swapped in, 2 suites and 192 tests pass (`sf1/char-on-base.txt`).
- I ran my own mutations, chosen to differ from the executor's set:

| Mutation | Applied to | Result |
|---|---|---|
| Drop `setJoinConfig` resync | base host | 1 failed |
| `onLimitChange` persists a wrong count | base host | 1 failed |
| `onLimitChange` skips the local echo | base host | 2 failed |
| Second `captureErrors` site (`persist(newConfig, true)` at base L445) set to default | base host | 2 failed |
| Host passes `persist` as `emitOrPersist` (a wiring mistake the byte-move proof cannot see) | branch host | 4 failed |

- After each run I restored the file with `git checkout HEAD --`, and HEAD gives 174/174 passing.

**Comment-only commit `46a2f1c7f`:**
- I read the full diff. Every changed line is inside a comment.
- I grepped each rewritten pointer's target:
  - `onTerminal` is at `usePipelineRunStream.ts:35`.
  - `EMPTY_ANALYZE_COLUMNS` is at `usePipelineAnalyzeLookups.ts:13`.
  - `EMPTY_OUTPUTS` is at `ui/LaneColumn.tsx:24`.
  - The `pendingSinceRef` comment is at `usePipelineDetailPage.ts:160-184`.
  - The "Derived-state initialization" block is at `usePipelineDetailPage.ts:220`.
  - `onWindowChange` is in `stepCardFieldHandlers.ts`, and `onUpsertSourceChange` is in `stepCardOpHandlers.ts`.
  - `handleInsertStep` is in `usePipelineStepCreation.ts`.
  - `syncPendingDraftIds()` is called after each ref mutation in the host, the lane hook and the draft hook.
- All rewritten pointers are accurate.

**Gates, run fresh on HEAD:**
- `npm run lint` (`--max-warnings=0`): rc 0.
- `npm run typecheck`: rc 0.
- `npm run format:check`: rc 0 (`sf1/gates-static.txt`).
- Full frontend jest under `nice -n 19` with `HELIO_JEST_MAX_WORKERS=3` (MemAvailable about 54 GB): 506 suites / 5454 tests passed, rc 0 (`sf1/jest-frontend-full.txt`).

**Sizes:** every source file is under its target.
- `useStepCardState` 211 lines; the new modules are 90, 207, 131, 178 and 164.
- `usePipelineStepStructure` 171, and `usePipelineShapeInstantiation` 143.
- `usePipelineStepCreation` 261, the lane hook 135 and the draft hook 120.

**Running app** (HEAD, private headless playwright-core `sf1/skeptic-app.mjs`; the shared MCP browser was not touched):
- `start-servers.sh` and `assert-phase.sh servers` reported PASS on 6913/9820.
- The scenario used a throwaway user and a pipeline with filter, fillnull, window and limit steps, in light and dark (`sf1/app-summary.json`):
  - all cards expanded;
  - a Limit burst-edit sent 0 PATCHes before the debounce, then exactly one `{"config":{"count":750}}`;
  - a forced 422 on the fillnull PATCH showed the inline save error in both themes;
  - there were no page errors. The console errors were the expected schedule 404 and the forced 422.
- I looked at `sf1/head-light-after-edits.png` and `sf1/head-dark-after-edits.png`. Both render correctly and with parity, as expected for a pure refactor. The before/after DOM-identity claim rests on the evaluator's base-vs-branch capture. I accept it because the code-level proofs above independently show that no render path changed.
- **Cleanup:**
  - Throwaway user `42ea0bab-042b-4d78-9021-2a6b1b24dd18` plus its 1 source, 1 pipeline and 4 steps were deleted with a guarded exact-id SQL transaction (`sf1/cleanup.sql`, `cleanup-transcript.txt`). A re-read finds 0 rows.
  - Servers were stopped by recorded PID (`sf1/server-pids.txt`), and the ports are closed.
  - The worktree is clean apart from the pre-existing untracked `evaluation-1.md`.

**AC trace:**

| Acceptance criterion | Evidence |
|---|---|
| Byte-move with red runs | movecheck/ordercheck, plus the evaluator's red runs, re-judged |
| Hook sequence unchanged | counts above |
| Deps equal base plus stable only | deps diff above |
| Tests import-only | no test touched in split commits |
| Characterization test green on base first, and failable | own runs above |
| App before/after, light and dark | own HEAD run, plus the evaluator's base-vs-head DOM compare |
| Items 1-4 | sizes above, and the comment commit verified |

**Gate defect check:** no mtime-ordering evidence is relied on anywhere. No gate defect.

### Verdict: CONFIRM

### Non-blocking notes
- `usePipelineOutputSheets.ts:25-26` now says `EMPTY_OUTPUTS` is "in `ui/LaneColumn.tsx`". `ui/PipelineRiverView.tsx:44` declares a second `EMPTY_OUTPUTS` used the same way, so the pointer is accurate but incomplete.
- `usePipelineDetailPage.ts:130-131` ("SSE `onTerminal` closure (defined below …)") is another stale cross-file pointer. The handler lives in `usePipelineRunStream.ts`. It was stale on base, after HEL-1478, and is not in the ticket's list, so it is a follow-up candidate.
- The evaluator's notes still stand:
  - the "eight per-op-kind" and "20 change handlers" comments are stale;
  - `anchorHasTail` references remain;
  - some long D7 comment lines exceed the wrap width;
  - the characterization test is 1204 lines.
