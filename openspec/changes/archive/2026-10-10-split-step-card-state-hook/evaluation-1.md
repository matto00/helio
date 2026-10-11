## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `a27a2e9cada4f67687a9e4b13f82034050d52b59` against base `a29a7e5ce23108a682fd87aea7d79edd6b922dc9`. The base was resolved live with `resolve-review-base.sh`, and it equals SPLIT_BASE.

All evaluator evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1481/evidence/eval1/` (called `eval1/` below). It sits outside the worktree, so it survives cleanup. Every proof below comes from scripts I wrote and ran myself. I did not re-run or reuse the executor's `d3*.py`, `d4_deps.py`, `d6_proof.py` or `d7_proof.cjs`.

### Phase 1: Spec Review — PASS

- **Ticket item 1.** `useStepCardState.ts` was split from 602 to 211 lines into five modules: `stepCardStateTypes` 90, `useStepCardEditorState` 207, `useStepCardPersist` 131, `stepCardFieldHandlers` 178 and `stepCardOpHandlers` 164. All of them are within the ~250 budget.
  - The name, signature, return type and 54-key return order are unchanged.
  - The `StepCardStateHandlers` type is re-exported, so no importer changed.
- **Ticket item 2.** `usePipelineStepStructure.ts` went from 274 to 171 lines, which is under ~250.
- **Ticket item 3.** `usePipelineStepCreation.ts` went from 405 to 261 lines, which is under the ~400 threshold.
- **Ticket item 4.** The comment-only commit `46a2f1c7f` fixes the following:
  - all five ticket-listed sites;
  - the `EMPTY_OUTPUTS` / `PipelineRiverView.tsx` pointers;
  - five pointers that this PR's own moves made stale.

  I grepped the target of each new pointer and every one resolves:
  - `onTerminal` is in `usePipelineRunStream.ts:35`;
  - `EMPTY_ANALYZE_COLUMNS` is in `usePipelineAnalyzeLookups.ts:13`;
  - `EMPTY_OUTPUTS` is in `ui/LaneColumn.tsx:24`;
  - `pendingSinceRef` is in `usePipelineDetailPage.ts:184`;
  - `onWindowChange` is in `stepCardFieldHandlers.ts:138`;
  - `onUpsertSourceChange` is in `stepCardOpHandlers.ts:125`;
  - `handleInsertStep` is in `usePipelineStepCreation.ts:144`.
- **Acceptance criteria:** each one is re-verified with fresh evidence in Phase 2/3.
- **No AC was reinterpreted.** Tasks 1.1–8.3 are all ticked and match the commits.
- **Scope:** there is no scope creep. The diff covers frontend `hooks/` plus one comment line in `ui/PipelineRiverView.tsx`, and design D7 explicitly includes that line. There are no API, schema or spec changes, and `skip_specs` is true.
- **Planning artifacts** (proposal, design D1–D7, tasks, files-modified) match what was implemented.
- **CONSTRAINTS C1–C5 are honoured:**
  - C1: byte, hook, deps and test-file proofs below, and no new `eslint-disable`.
  - C2: HEL-1478 is merged, and SPLIT_BASE equals origin/main.
  - C3: evidence paths and exact-id deletion.
  - C4: no bug fixes are folded in.
  - C5: jest ran under `nice -n 19` with 3 workers and no `sbt testFull`.

### Phase 2: Code Review — PASS

**Behaviour-preserving proofs (each one re-run independently, each with a red run):**

1. **Byte-move** (`eval1/bytemove.py`)
   - **Method:** difflib matches each branch file against the base file to find verbatim runs of 2 or more lines. The script then lists every line that is not in such a run. A line counts as allowed only if it matches a plumbing pattern, and I reviewed every listed line by eye.
   - **useStepCardState split (fb10776a3):** 0 non-plumbing lines (`bytemove-split1-green.txt`). `stepCardStateTypes.ts` is 100% verbatim. The only base lines dropped are two `import` lines and one blank line.
     - Red run: changing `persist(newConfig, true)` to `fals` in `stepCardOpHandlers.ts:63` gives exit 1 and the line is flagged BAD (`bytemove-split1-red.txt`).
   - **usePipelineStepStructure trim (e56b79fe6):** the non-moved lines are the following, and nothing else (`bytemove-structure-green.txt`):
     - the call site;
     - the args type;
     - a new 3-line doc comment;
     - `return handleInstantiateShape;`.

     Red run: one trailing space added at `usePipelineShapeInstantiation.ts:61` is flagged, and base L180 shows as dropped (`bytemove-structure-red.txt`).
   - **usePipelineStepCreation split (9a78b4ea6):** the non-moved lines are the following, and nothing else (`bytemove-creation-green.txt`):
     - two call sites;
     - two args types;
     - two one-line doc comments;
     - two `return` lines;
     - M7's deps array, which Prettier re-wrapped. It replaces base L392 and is covered by the deps check.

     Red run: one changed character at `usePipelineLaneStepCreation.ts:70` is flagged, and base L256 shows as dropped (`bytemove-creation-red.txt`).
2. **Hook primitive sequence** (`eval1/hookseq.py`)
   - **Method:** the script strips comments and extracts the `use*(`/`build*(` call order. On the branch it inlines the sub-hooks recursively.
   - **Results** (`hookseq-*-green.txt`):
     - `useStepCardState`: useState x30, then useRef x2, then useEffect. This is IDENTICAL to base, and the build* handler builders contain no hook calls.
     - `usePipelineStepStructure`: IDENTICAL, 4 calls.
     - `usePipelineStepCreation`: IDENTICAL, 14 calls.
   - **Red runs:**
     - Moving `requestTokenRef` after the effect gives DIFFERENT at call #31 (`hookseq-stepcard-red.txt`).
     - Moving `creatingDraftIdsRef` after `useState` gives DIFFERENT at call #0 (`hookseq-creation-red.txt`).
3. **Deps arrays** (`eval1/deps.py`)
   - **Method:** I compared all 13 `useCallback`/`useEffect` deps arrays across the three hosts and the new modules.
   - **Result** (`deps-green.txt`): 12 are identical to base. `createDraftIfComplete` has exactly two additions, `creatingDraftIdsRef` and `setDraftCreateErrors`, which the script allows by name.
     - `creatingDraftIdsRef` is a `useRef` at `usePipelineStepCreation.ts:67`.
     - `setDraftCreateErrors` is a `useState` setter at `:71`.
     - Both are provably stable.
   - **Red runs:**
     - Adding `step` to the persist cleanup effect's `[]` gives FAIL (`deps-red.txt`).
     - Adding `pushToast` to M7's deps gives FAIL (`deps-red2.txt`).
4. **Test files are untouched in the split commits** (`eval1/tests-untouched.txt`).
   - The split commits `fb10776a3`, `e56b79fe6` and `9a78b4ea6`, and the comment commit `46a2f1c7f`, touch no test file.
   - The only test file in the whole range is the new characterization test, which was added in its own commit `fe938643d`.
   - There are zero added `eslint-disable` lines.
5. **Characterization test is green on base.** I swapped the 11 modified files back to their SPLIT_BASE versions in place (verified with `git diff a29a7e5ce -- frontend`, which shows only the added files). I then ran `useStepCardState.characterization.test.ts` and `useStepCardState.test.ts` against the base host: 2 suites, 192 tests, all passed (`eval1/char-test-on-base.txt`).
6. **Comment-only commit `46a2f1c7f`** (`eval1/tokens.cjs`)
   - **Method:** the TypeScript scanner compares the token stream of each touched file with its parent, ignoring trivia (comments and whitespace).
   - **Result:** all 9 files are IDENTICAL (`comment-only-green.txt`).
   - **Red run:** inserting `void 0;` in `usePipelineRunAndSaveActions.ts` gives FAIL at token #174 (`comment-only-red.txt`).

**Gates, run fresh on HEAD a27a2e9ca** (`eval1/gates-static.txt`, `eval1/jest-full.txt`):
- `npm run lint` (zero warnings) exit 0.
- `npm run format:check` exit 0.
- `npm run typecheck` exit 0.
- `npm --prefix frontend run build` exit 0.
- `npm test` under `nice -n 19` with `HELIO_JEST_MAX_WORKERS=3`: root 44 suites / 433 tests, frontend 506 suites / 5454 tests, all pass, exit 0. MemAvailable was about 50 GB.

**Code-quality checklist:**
- **CONTRIBUTING [mechanical]:** no inline FQNs, and every source file is within the ~250 budget.
- **DRY:** the two handler modules share no duplicated logic.
- **Naming:** the `build*` handler builders are honestly named because they contain no hook primitives, per design D1.
- **Type safety:** there are no `any` or escape hatches. The `Pick<ReturnType<typeof …>>` args types keep the modules typed against the source hook.
- **Dead code:** none, and no TODO/FIXME.
- **Abstraction:** no over-abstraction.
- **Behaviour:** the diff moves code only, and the proofs above confirm it.

### Phase 3: UI Review — PASS

**Method.** I started the servers with `start-servers.sh` and `assert-phase.sh servers`, which reported PASS on ports 6913/9820. I then compared SPLIT_BASE and the branch on the same servers:
- For base, I checked out the 11 SPLIT_BASE versions of the modified frontend files in place. `vite` confirmed it was serving base modules: grep for `useStepCardEditorState` / `usePipelineShapeInstantiation` / `usePipelineDraftCreate` found 0 matches.
- I restored the branch with `git checkout HEAD -- <files>` afterwards. `git status` is clean, and `git diff HEAD` is empty.

**Browser.** I started with the Playwright MCP browser. Partway through the base-dark pass, another session navigated that shared browser to `localhost:6888`. Because of that, every compared capture comes from a private headless `playwright-core` script, `eval1/app/capture.mjs`, run with identical steps on base and on the branch.

**Scenario, run in light and dark on base and on the branch.** The test pipeline has nine step kinds: select, filter, rename, cast, fillnull, sort, window, stringops and limit. The script:
1. expanded all 9 cards;
2. burst-edited Limit three times;
3. edited a Filter value;
4. edited fillnull with a forced 422 on its PATCH (route-fulfilled);
5. added a "+ lane"/Branch step (Limit rows);
6. created an AI draft (Generate text), checking that a partial config does not POST and that completing the input field POSTs once;
7. instantiated a Top N shape on a fresh pipeline.

**Results:**
- **Wire payloads are identical on base and branch** (`cap/base-summary.json` vs `cap/head-summary.json`). The only differences are the ids of the freshly created per-run pipelines and steps.
  - The debounce works: 0 PATCHes before the window closes, then exactly one `{"count":750}`.
  - The Filter PATCH carries `value:"2"`.
  - The fillnull 422 shows "HEL-1481 eval forced validation error" inline in the card.
  - The lane POST is `limit` with `attachAsTail`.
  - The draft POSTs nothing until it is complete, then sends one `generatetext` POST.
  - The shape creates `sort` then `limit`.
- **DOM:** the normalized `<main>` DOM is IDENTICAL for all 8 base/branch pairs (`cap/compare.txt`).
- **Pixels:**
  - Main area, light and dark: the differences are limited to a few pixels on checkbox ticks, select chevrons and icon edges (largest region 9x7 px). That is consistent with transition/anti-aliasing timing; the DOM is identical, and I zoomed in and checked by eye.
  - Sidebar: the differences come only from the pipeline list containing that run's newly created pipeline names.
  - Shape pass: the remaining differences are the breadcrumb and footer pipeline name.
  - Supplementary MCP captures from before the hijack (`app/shots/mcp-compare.txt`): light lane-draft is pixel-identical; light expanded and after-edits differ by 8 px in the header avatar.
- **Console:** the errors are the same on both sides. They are the expected 404 on `/api/pipelines/:id/schedule` (no schedule set) and the forced 422. There are no page errors.
- **Breakpoints** on the branch at 1440/1100/768/375, all 9 cards expanded: no horizontal overflow and no page errors (`cap/breakpoints.json`, `cap/head-bp-*.png`).
- **Accessibility:** the controls I exercised have accessible names, for example "Input field to generate from", "Instruction for the model" and "Branch this step…". The DOM is identical to base, so there is no accessibility regression.

**Throwaway data**
- A fresh dev user was created: `36428420-198b-4a8b-932b-92e30c2ba326`, `hel1481-eval1-1791698490413@example.test`. Every created id is recorded in `eval1/app/ids.txt`.
- At cleanup the database held 1 user, 1 source, 9 pipelines and 23 steps from this run. The remaining ids listed in `ids.txt` were steps already deleted through the API during the per-run resets.
- Cleanup used a guarded exact-id SQL transaction (`eval1/app/cleanup.sql`, `cleanup-transcript.txt`). A re-read after COMMIT finds 0 rows.
- Servers were stopped by recorded PID (`eval1/server-pids.txt`). Ports 6913 and 9820 are now closed.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- **Follow-up candidates: stale comments already present on base**, left in moved code by design. None of these is a defect introduced by this PR.
  - The host header in `useStepCardState.ts:1-9` says "eight per-op-kind editor states" and "eight typed change handlers"; there are 26.
  - `useStepCardPersist.ts:34` says "any of the 20 change handlers".
  - The `anchorHasTail` references in `usePipelineShapeInstantiation.ts:53/92/133`.
- **Long comment lines in the D7 commit.** Several pointer rewrites run past the surrounding ~100-column wrap, because Prettier does not re-wrap comments. Examples are `usePipelineStepCreation.ts:41` (about 150 columns) and `usePipelineOutputSheets.ts:68`. A follow-up could re-wrap them; the token proof would still pass.
- **Test file size.** `useStepCardState.characterization.test.ts` is 1204 lines, well over the ~400-line "propose a split" threshold. The design approved a single file. Consider noting this in the PR description, or splitting it by group later.
- **Environment notes, not code issues:**
  - `start-servers.sh` ran `sbt run` with `SBT_OPTS=-J-Xmx3g` set. The forked run JVM carried `-Xmx3g`, but the sbt launcher JVM did not pick up the flag; its RSS was 0.8 GB.
  - The shared Playwright MCP browser was hijacked by a concurrent session on `localhost:6888`, which is a known hazard.
  - I moved my own MCP autosave files out of the main checkout's ignored `.playwright-mcp/` into `eval1/app/mcp-autosave/`. The other session's files were left in place.
