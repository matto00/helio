## Context

See proposal.md. Paths are relative to `frontend/src/features/pipelines/`.

**Base.** HEL-1478 (unmerged at planning time, branch `task/split-pipeline-detail-hooks/HEL-1478`) edits
`hooks/usePipelineStepStructure.ts` (+3 lines: `setPendingDraftIds` param/destructure/forward). It touches neither
`hooks/useStepCardState.ts` nor any of its importers (`ui/StepCard.tsx`, `ui/StepOpEditor.tsx`, `ui/stepConfigs/*`).
Execution therefore starts only after HEL-1478 has merged to origin/main; the branch is then re-synced and the
**split base** `SPLIT_BASE` = that origin/main SHA is recorded in `workflow-state.md`. Every byte/hook/deps proof below
compares against `SPLIT_BASE`, and every line number below is from origin/main `dae4bc451` and must be re-read
against `SPLIT_BASE` by the executor (the executor records the exact ranges).

**`useStepCardState` today (602 lines, dae4bc451).** One hook called by `ui/StepCard.tsx` (a `React.memo` component)
and by tests (`hooks/useStepCardState.test.ts`, `ui/stepConfigs/JoinConfig.seam.test.tsx`); `ui/StepOpEditor.tsx`
types a prop as `ReturnType<typeof useStepCardState>`. Regions:
- L11–70 imports; L72–79 `STEP_CONFIG_PERSIST_DEBOUNCE_MS`; L81–145 `export interface StepCardStateHandlers`.
- L147–151 signature `(step, onConfigChange): StepCardStateHandlers`.
- L152–242 editor state: `prevConfig`/`prevOpTypeId` + 26 per-op `useState`s, `saveError`/`saveErrorIsValidation`
  `useState`s (L209–212), then the during-render resync block (L213–242).
- L244–260 `debounceRef`, `requestTokenRef`, unmount-cleanup `useEffect(…, [])`.
- L262–325 `persist` (plain function, recreated per render).
- L327–510 twenty-three per-op change handlers (26 in total with the three after `emitOrPersist`) (plain functions); L512–524 `emitOrPersist`; L526–544 three more
  handlers that call `emitOrPersist`.
- L546–601 the return object (54 keys).

It has **no** `useCallback`/`useMemo` and no `eslint-disable`; its only deps array is the cleanup effect's `[]`.
Every handler is a fresh closure per render on base, and no build-time React Compiler runs (vite has no compiler
plugin), so there is no memoized-identity contract to preserve here — only the primitive hook sequence, the closures'
captured bindings (same render), and the return shape.

Primitive hook sequence on base: `useState` x28 (2 prev + 26 editors), `useState` x2 (saveError pair), `useRef` x2,
`useEffect` x1.

**`usePipelineStepStructure` (271 on dae4bc451, ~274 after HEL-1478).** Primitive sequence: `useCallback`
(syncStepsFromServer), `usePipelineStepCreation(…)` (nested), `useCallback` (handleAddOutputViaAggregateTail),
`useCallback` (handleInstantiateShape, L148–256 with its leading comment). `handleInstantiateShape`'s identity is
already pinned by `hooks/usePipelineDetailPage.identity.test.tsx` (`STEP_INDEPENDENT_KEYS`).

Proof precedent: HEL-1465 (`openspec/changes/archive/2026-10-10-split-stepcard-pipeline-hook/`, design D3) and HEL-1399
(`.concertino/runs/HEL-1399/evidence/d3.py`, `d3b.py`).

## Goals / Non-Goals

**Goals:** `useStepCardState.ts` and every new module ≤ ~250 lines; `usePipelineStepStructure.ts` < ~250; identical
primitive hook sequence, captured bindings, return shape (key set and key order), DOM and wire payloads.

**Non-Goals:** any behaviour/DOM/copy change; editing comments inside moved regions (including the stale "eight
per-op-kind" header and the stale `anchorHasTail` references in `handleInstantiateShape`'s comments, — recorded as follow-up candidates; the L209–210
"`StepCardStateHandlers` above" comment is NOT edited in the split commits but IS fixed in D7's comment-only commit); touching `StepCard.tsx`, `StepOpEditor.tsx` or `usePipelineDetailPage.ts`; editing HEL-1478's
worktree.

## Decisions

### D1 — `useStepCardState` seams (verbatim moves, host keeps name/signature/return shape)

All new files in `hooks/`:
- **M1 `stepCardStateTypes.ts`**: `StepCardStateHandlers` (L81–145) moved verbatim with its doc comments, plus the
  type-only imports it needs. `useStepCardState.ts` re-exports it (`export type { StepCardStateHandlers } from
  "./stepCardStateTypes";`) so the module's export surface is unchanged.
- **M2 `useStepCardEditorState.ts`**: the **contiguous** region L152–242 moved verbatim (the editor `useState`s, the
  saveError pair, and the during-render resync block — kept together so the resync block keeps its exact position
  after the saveError `useState`s). Takes `step`; returns every value and setter later code reads (the 26 editor
  values, their setters, `saveError`, `saveErrorIsValidation`, `setSaveError`, `setSaveErrorIsValidation`).
- **M3 `useStepCardPersist.ts`**: `STEP_CONFIG_PERSIST_DEBOUNCE_MS` (L72–79) + L244–325 (refs, cleanup effect,
  `persist`) + `emitOrPersist` (L512–524), verbatim. Params: `step`, `onConfigChange`, `setSaveError`,
  `setSaveErrorIsValidation` (the latter two are `useState` setters from M2, stable by React contract; they are read
  only inside the `setTimeout`/promise callbacks, exactly as before). Returns `{ persist, emitOrPersist }`.
  `emitOrPersist` is a plain function declaration (no hook), so moving it out of the handler run changes nothing about
  ordering; it is still created in the same render as the handlers that call it.
- **M4a `useStepCardFieldHandlers.ts`** and **M4b `useStepCardOpHandlers.ts`**: the handler bodies L327–510 and
  L526–544 split into two contiguous runs at a function boundary the executor picks so each file is ≤ ~250 (proposed:
  M4a = `onFieldToggle` … `onWindowChange`, M4b = `onUnpivotChange` … `onUpsertSourceChange` + the three
  `emitOrPersist` callers). Each takes the values/setters and `persist`/`emitOrPersist` it reads as one params object
  and returns its handlers. **They call no hook primitives** (they are `use*`-named only for consistency; the executor
  may instead name them as plain `build*` functions — either way the primitive sequence is unaffected and the choice is
  stated).
- **Host `useStepCardState.ts`**: header comment (L1–9, verbatim), imports, re-export, signature (L147–151 verbatim),
  then in order: M2 call, M3 call, M4a call, M4b call, return. The return object's **key set and key order are
  identical to base** (pinned by the characterization test); it is the **verbatim L546–601 object** over destructured bindings
  (skeptic-design-1 note), so the byte-move check covers it directly.

Captured bindings: all handlers/persist are created in the same render from the same `step`/`onConfigChange`/state
values as before (values are passed as the same per-render bindings, setters as the same stable functions), and refs
stay inside M3 as ref objects, so every read happens at the same time as before.

### D2 — `usePipelineStepStructure` trim (verbatim move)

**M5 `hooks/usePipelineShapeInstantiation.ts`**: the `handleInstantiateShape` leading comment + `useCallback` (L148–256
on dae4bc451) moved verbatim, called **in place** (same position, after `handleAddOutputViaAggregateTail`) as
`const handleInstantiateShape = usePipelineShapeInstantiation({ id, roots, setSteps, setStepsInitialized, pushToast });`.
Its deps array `[id, pushToast, roots, setSteps, setStepsInitialized]` is **unchanged** (all five are already in it).
Imports no longer used by the host move with it. Result: host ≈ 170 lines, M5 ≈ 135.

Alternative rejected: trimming the verbose comments. They are history the ticket calls "mostly verbatim"; rewriting
them is not mechanically provable and is out of scope (Non-Goals).

### D3 — Lint and suppressions

No new `eslint-disable` anywhere (C1). Neither file carries a suppression today, so the HEL-1465 D2b masking hazard
(a hooks suppression hiding `react-hooks/*` errors on the whole function) is not expected — but if moving code
surfaces ANY new lint error (e.g. a React Compiler rule on a new module), the executor STOPS and escalates with
options rather than adapting code. Deps arrays: the only arrays involved (`[]` in M3, M5's array) are unchanged; if
the linter demands an addition, only a provably-stable value (ref object, `useState` setter, `dispatch`) traced to its
base declaration is allowed, anything else is a stop-and-escalate.

### D4 — Characterization test (committed GREEN on `SPLIT_BASE` first, its own commit, before any split commit)

New file `hooks/useStepCardState.characterization.test.ts` (existing test files are NOT edited), via `renderHook`
with `updatePipelineStep` mocked and fake timers:
1. **Return shape**: `Object.keys(result.current)` equals the pinned 54-key list in base order.
2. **Per-handler wire payload + error capture**: a table over all 26 `on*Change`/`onFieldToggle` handlers — call each
   with a fixture, advance `STEP_CONFIG_PERSIST_DEBOUNCE_MS` (400), assert the exact `updatePipelineStep(stepId,
   payload)` call (including omitted/undefined keys for date-bucket, window, string-ops, convert-format) and that, on
   a 422 rejection, `saveError`/`saveErrorIsValidation` populate for exactly pivot/window/fillnull/upsertsource and
   stay `null`/`false` for the rest.
3. **emitOrPersist**: for a temp id (`step-1`), convertformat/analyzeWithAi/generateText call `onConfigChange`
   synchronously with the payload and never PATCH; other handlers never PATCH and never call `onConfigChange`.
4. **During-render resync** (skeptic-design-1 CR1): a **26-row table, one row per op kind**. Each row renders a
   step of that op kind with config A, then `rerender`s with a new `step.config` object B (same opType) where that
   op's narrowing helper output differs between A and B, and asserts the returned value equals the helper's output for
   B. Separately, one opType-change row (`opType.id` changes with an unchanged config object, e.g. filter -> limit)
   asserts resync fires on the opType condition alone: the PREVIOUS op's value returns to its helper default (the
   filter value resets) — not merely that the new op's value equals its default (skeptic-design-2 note 1). Because every helper returns its default unless the step's op matches its own, a
   single-fixture variant only exercises 2-3 setters; the table exercises all 26.
5. **Accumulating handlers read current state** (skeptic-design-1 CR2): `onFieldToggle`, `onRenameChange` and
   `onCastChange` are the only handlers that read state (`selectedFields`/`renames`/`casts`). For each: call it twice
   with a re-render between (via `act`), then assert the accumulated returned value and the single debounced PATCH
   payload contain both edits (e.g. toggle field `a` then `b` -> `{fields:[...base,"a","b"]}`; a delete via empty
   string removes the key).
6. **Local state echo**: after each handler call the corresponding returned value reflects the new config
   immediately (before the debounce).
Each group is shown RED under a targeted mutation on base, reverted, green — with transcripts. Required red runs at
minimum: group 1 swap two return keys; group 2 flip one handler's `captureErrors`; group 3 make `onConvertFormatChange`
call `persist`; group 4 delete **at least two resync setters whose op kinds are not any other group's fixture op**
(e.g. `setCasts` and `setUpsertSourceConfig`), each separately; group 4b drop `|| prevOpTypeId !== step.opType.id` from the resync condition (opType row
red); group 5 make one accumulating handler read a stale
value (e.g. capture `selectedFields` from the initial render via a module-level/ref snapshot, or reset `next` to the
base list) so the second call loses the first edit.

The existing `hooks/useStepCardState.test.ts` (debounce collapse, second-window PATCH, unmount cleanup, stale-token
drop, unsupported-op skip, temp-id guard, saveError capture/clear/staleness) is cited as the existing guard for M3
(persist) and runs unmodified on the branch. `usePipelineShapeInstantiation` needs no new test: the existing identity test already pins
`handleInstantiateShape`, plus its behaviour tests in the page suite; the executor records which existing tests cover it
and shows the identity test red under a non-stable-dep mutation that is new on every render (e.g. an inline `{}`
added to `handleInstantiateShape`'s deps — `roots.length` would stay green), reverted.

### D5 — Proof (per split commit)

- **Byte-move** (HEL-1399 `d3.py` pattern): sha256 of each base region == branch region after removing only
  whitelisted new lines (imports, export/re-export lines, params destructuring header, return object, function
  signature). Red run: one-char edit in a moved region -> DIFFERENT, reverted -> IDENTICAL.
- `git diff --color-moved=zebra` saved; every non-moved added line listed and justified.
- **Hook sequence** (HEL-1399 `d3b.py` pattern): comment-stripped primitive sequence of base `useStepCardState` and
  base `usePipelineStepStructure` equals the branch's with sub-hooks inlined at call sites; red run by swapping two hook
  lines.
- **Deps check**: every deps array in moved code equals base (expected: no additions at all); red run by adding
  `step` to M3's `[]` -> FAIL.
- **Tests import-only**: `git diff SPLIT_BASE..` over `*.test.*` in split commits is empty or import-only.
- **Gates**: frontend lint (zero warnings), typecheck, format:check, full jest (`HELIO_JEST_MAX_WORKERS` default 3).
- **Running app before/after** (`SPLIT_BASE` vs branch, light and dark): a throwaway dev user's pipeline with
  select/rename/filter/window/fillnull/pivot/upsertsource/convertformat steps; expand cards, edit a value (debounced
  PATCH observed in the network log), provoke a fillnull/upsertsource 422 to show the save error, and instantiate a
  shape via the shape picker. Screenshots + editor-region DOM snapshot diffed. All evidence under
  `/home/matt/Development/helio/.concertino/runs/HEL-1481/evidence/`; throwaway user ids recorded and deleted by
  exact id.

### D6 — `usePipelineStepCreation` split (fold-in, ticket item 3; verbatim moves, called in place)

Base = SPLIT_BASE a29a7e5ce (405 lines). Primitive sequence: `useRef` (creatingDraftIdsRef), `useState`
(draftCreateErrors), `useState` (creatingStepIds), `useCallback` (markCreating), `useRef` x2 (pendingParentRef,
userRemovedTempIdsRef), `useCallback` x8 (markTempRemoved, applyCreated, syncPendingDraftIds, clearDraftCreateError,
handleInsertStep, handleAddStep, handleAddLaneStep, createDraftIfComplete).

The last two callbacks form the contiguous tail L227–393; each moves verbatim (with its leading comment) into its own
sub-hook, called **in place, consecutively**, at the position the callback occupied:
- **M6 `hooks/usePipelineLaneStepCreation.ts`**: `handleAddLaneStep` (L227–318). Params: `id`, `pushToast`,
  `markCreating`, `applyCreated`, `stepsRef`, `setSteps`, `setStepsInitialized`, `pendingDraftMetaRef`,
  `syncPendingDraftIds` — exactly its existing deps, which already list every outer binding it reads, so its deps
  array is **unchanged**.
- **M7 `hooks/usePipelineDraftCreate.ts`**: `createDraftIfComplete` (L320–393). Params: its existing deps (`id`,
  `stepsRef`, `applyCreated`, `pendingDraftMetaRef`, `draftFallbackMetaRef`, `syncPendingDraftIds`) plus
  `creatingDraftIdsRef` (host `useRef`, L66) and `setDraftCreateErrors` (host `useState` setter, L70). Those two
  become params, so the linter will require them in deps: they are the **only** permitted additions (provably stable,
  each traced to its base declaration). Anything else the linter demands is stop-and-escalate.
- `PendingDraftMeta` stays exported from `usePipelineStepCreation.ts` (importers unchanged); new modules import it
  type-only from there.
- Host ≈ 265 lines (from 405; below the ~400 threshold the ticket cites). Return object unchanged.
- **Characterization**: the existing `hooks/usePipelineDetailPage.identity.test.tsx` already pins `handleAddLaneStep`
  directly and `createDraftIfComplete` transitively (it is in `handleStepConfigChange`'s deps in
  `usePipelineStepMutations.ts`, and `handleStepConfigChange` is pinned). It is green on SPLIT_BASE (committed by
  HEL-1478), so no new test is needed. The executor shows it red under a per-render-new dep (inline `{}`) added to
  `createDraftIfComplete` and, separately, to `handleAddLaneStep`, each reverted. The executor also records which
  existing tests exercise draft create behaviour (temp-id create once, in-flight edit flush, error restore).
- Proof: same as D5 (byte-move, hook sequence with sub-hooks inlined, deps = base + exactly the two stable names,
  red runs, tests untouched). Prettier re-wraps M7's deps array onto multiple lines, so the byte-move whitelist includes
  those deps lines; the separate deps check proves base + exactly the two names (skeptic-design-3 note 5). Its own commit, after the D2 trim commit.

### D7 — Cross-file comment pointers (fold-in, ticket item 4; comment-only commit, LAST)

One commit that changes comment text only (no code token changes; proof: the diff contains only lines whose
non-whitespace content starts with `//`, `*` or `/*`, plus a TypeScript-AST-equal check, i.e. `tsc` emit or a
comment-stripped diff of each touched file equal to its parent). Sites, re-read at SPLIT_BASE:
- `usePipelineOutputSheets.ts:66-67` ("like the derived-state block above" -> name `usePipelineDetailPage.ts`);
- `usePipelineDebouncedAnalyze.ts:97` ("see `pendingSinceRef`'s comment above" -> name the host file);
- `usePipelineOutputSheets.ts:26` (`EMPTY_ANALYZE_COLUMNS` pattern "above" -> name its file);
- `usePipelineRunAndSaveActions.ts:46` and `:50` (`onTerminal` "below, in `usePipelineRunEvents`'s options" / "the SSE
  `onTerminal` handler below" -> name where it lives).
Also in scope, same class: cross-file "above"/"below" pointers made wrong by THIS PR's own moves (e.g. M2's
"`StepCardStateHandlers` above" which now lives in `stepCardStateTypes.ts`); the executor greps every moved comment
for `above`/`below` and lists each site and its resolution. Pointers that were already stale for other reasons
(the "eight per-op-kind" header, "20 change handlers", `anchorHasTail`) stay as follow-up candidates. Known answers for that grep (skeptic-design-3 note 2; the executor confirms and may find more):
`useStepCardEditorState.ts:116`, `stepCardStateTypes.ts:55`, `stepCardOpHandlers.ts:71`, the "`handleInsertStep` above"
comment that moves into M6 with `handleAddLaneStep`, and possibly the `usePipelineStepCreation.ts` L39–40 "every
mutation below" comment. Also: `usePipelineOutputSheets.ts:25` names `EMPTY_OUTPUTS`, which lives in
`ui/LaneColumn.tsx:24` (fix in the same edit), and `ui/PipelineRiverView.tsx:40` carries the same class of stale
cross-file pointer from an earlier PR — **included** in this D7 commit (decision recorded). Wording targets the actual
location; no other edits.

## Risks / Trade-offs

- [Moved code captures a different binding] → same-render params, setters stable, refs stay in M3; characterization
  test (D4) pins every handler's payload, error capture, temp-id path and resync.
- [Hook order drifts] → M2 is one contiguous region; hook-sequence script with red run.
- [A move surfaces a hidden lint error] → stop and escalate (D3), never a new suppression.
- [HEL-1478 changes shape before merge] → Execution waits for its merge; premise re-verified against `SPLIT_BASE`.

## Migration Plan

None. Rollback = revert.

## Open Questions

None blocking.
