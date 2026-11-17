## Context

See proposal.md (Why). Ground truth on main a6499da12: `hooks/usePipelineDetailPage.ts` 562 lines (composer of ~20 hooks plus
the HEL-1684 draft routing block, lines 344-413, and a ~105-line return object consumed by `PipelineDetailPage`,
`PipelineSpineLayout`, `PipelineMobileLayout`, `PipelineDetailDialogs`, `PipelineSpine`); `hooks/usePipelineDraftSave.ts`
433 lines (save/cascade/reload/undo plus pure helpers). Nearly every sub-hook the page composes carries `useEffect` or
`useLayoutEffect` (fingerprint, lookups, source samples, clear-run-on-leave, watchdog, debounced analyze, run history,
page load), so effect ORDER is behaviour. Existing nets: jest (`usePipelineDetailPage.identity/analyze/sourceSamples`,
`usePipelineDraftSave.dropped`, `PipelineDetailPage.test`/`closedDialogs`), e2e `e2e/hel1631-draft-mode`,
`hel1684-draft-structural`, `hel1685-draft-polish`, `hel1705-live-output-refresh`.

Narrow-desktop disclosure layout (`PipelineSpineLayout.css`): `.spine-body__main` is a flex column (editor, then
`.step-preview` with `flex: 1; min-height: 0; overflow: hidden`); in disclosure the editor is `flex-shrink: 0;
max-height: max(45%, 290px)` and the open Output row is `max-height: min(30vh, 200px)`. At 900x600 editor 290px + Output
200px leave less than the preview header, so `.step-preview` collapses below its own title.

## Goals / Non-Goals

**Goals:** files at the ~250-line soft budget; identical behaviour and return shapes; seams HEL-1733/1734 can extend;
preview header never clipped on short narrow-desktop windows, held by a guard that fails first.
**Non-Goals:** fixing bugs found on the way (file follow-ups), changing the Output cap, renaming returned keys,
touching HEL-1675's files (`PipelineSpineHeader.css`, `useNow`, `useTopModalDialog`).

## Decisions

### D1. Effect order is preserved; effect-free calls may move
Only the relative order of effect-bearing calls matters (`useEffect`/`useLayoutEffect`, including those inside sub-hooks
and inside `useLatestCallback`). A new hook may wrap a contiguous run of today's calls. Effect-free calls (`useState`,
`useRef`, `useMemo`, `useCallback`, `useAppSelector`, `useParams`) MAY move past
effect-bearing ones (e.g. the UiState `useState`s moving past `useRunHistory`/`usePipelineRunStream`). The relative order
of every effect-bearing call stays exactly as on main. `useNavigate` and `useSearchParams` are effect-bearing
(react-router-dom 7 runs a layout effect inside each) and never move relative to other effect-bearing calls. Alternative (regroup by topic regardless of order) rejected: it
silently reorders analyze/sample/run-history effects.

### D2. `usePipelineDetailPage` becomes page wiring over six extracted hooks
Line numbers are main a6499da12.
- `usePipelineDraftRouting.ts` (draft-op application, ~90 lines): lines 344-413. Inputs: `draft`, `roots`, `draftSteps`
  and the immediate handlers (`handleTempStepConfigChange`, `handleRemoveSavedStep`, `handleToggleTempStepEnabled`,
  `handleAddStepNow`, `handleInsertStepNow`, `handleAddLaneStepNow`, `handleDuplicateStepNow`, `handleReorderStepsNow`);
  returns the eight routed handlers. The single place a page action decides "draft op vs. immediate write": HEL-1733
  (Output actions) and HEL-1734 (root actions) add their routing here. `useLatestCallback`/`useCallback` identities
  unchanged.
- `usePipelineDetailStepActions.ts` (~110): the contiguous lines 288-413 (structure, mutations, root/toggle, then
  `usePipelineDraftRouting`); returns exactly the 15 keys the page returns from that block.
- `usePipelineDetailAnalyze.ts` (~110): the contiguous lines 190-256 (fingerprint, lane graph, root source ids + source
  samples, defer watchdog, debounced analyze, clear-run-on-leave, analyze lookups). Lane graph and samples ride along
  because they sit inside that run (D1). Takes the `usePipelineEditorState` result as one object (no 30-line destructure).
- `usePipelineDetailUiState.ts` (~45): `outputName`, `editingOutputName`, `shareOpen`, `scheduleOpen`,
  `outputNamePipelineId`, `isConfirmingCancel` and the render-time outputName sync (lines 156-159). Effect-free (D1).
  Not spread into the return (its result has internal-only keys); its returned keys are listed explicitly.
- `usePipelineStepsSeed.ts` (~45): the contiguous lines 160-188 (render-time seeding from Redux, `onStepsSettled`,
  `usePipelinePageLoad`).
- `usePipelineDetailSaveWiring.ts` (~70): the contiguous lines 415-454 (`usePipelineRunAndSaveActions`, the
  `outputsLoaded` selector, `usePipelineDraftSave`).
`usePipelineEditorState`'s and `usePipelineOwnPipeline`'s results are held as objects in the composer instead of being
destructured. The composer builds its return by spreading a sub-hook result ONLY when that result's keys are exactly
keys the page returns today; the key-set guard (D5) enforces this.
Projection (skeptic round 1 measured 351 lines left after removing the moved ranges): -40 run/save block, -28 editor
destructure, -18 seeding, -40 return compaction via exact spreads (step actions, output sheets, analyze), +60 for the new calls -> about 285.
Budget: every new file <= 250. The composer target is <= 250; it MAY land up to 300 because it is the composer whose
return is the page's ~100-key contract consumed by `PipelineDetailPage`, `PipelineSpineLayout`, `PipelineMobileLayout`,
`PipelineDetailDialogs` and `PipelineSpine`, and reshaping that contract is out of scope (AC2). The executor records the
measured final count and this reason under "Measured sizes" at the end of this file; above 300 it stops and reports.
Alternative (one `usePipelineDetailState` mega-hook) rejected: moves the size, not the seams.

### D3. `usePipelineDraftSave` splits into orchestration, adopt, undo, settle and pure helpers
- `draftSaveRequest.ts` (pure, ~110): `buildDraftSaveRequest({summary, persistedSteps, baseOutputs, overlay, roots,
  confirm})` returning `{kind:"unreadable"} | {kind:"stale"} | {kind:"dropped", count} | {kind:"ready", request}` (lines
  285-320; HEL-1733 extends the Outputs part here); `noticeForSaveError(err, {steps, outputs, draftSteps})` returning
  `{cascade: DraftCascadePrompt} | {notice: DraftNotice}` (the catch-branch mapping, lines 334-355); and
  `runRefusedMessage`, `stepNamedBy` moved verbatim. `DraftNotice`/`DraftCascadePrompt` types move here.
- `usePipelineDraftAdopt.ts` (~45): `renderKeys` + `adoptDefinition`. In: `dispatch`, `stepsRef`, `setSteps`.
- `usePipelineDraftUndo.ts` (~90): `savedToastRef`, `dismissSavedToast`, `undoneRef`, `undo`, `requestUndo`,
  `confirmUndoWithDraft`. In: `id`, `dispatch`, `draft`, `pushToast`, `mountedRef`, `setNotice`, `adoptDefinition`.
  Out: `savedToastRef`, `dismissSavedToast`, `requestUndo`, `confirmUndoWithDraft`.
- `usePipelineDraftSettle.ts` (~85): `useSearchParams`, `stepParamRef` and `settleSaved` (contiguous lines 198-269). In:
  `draft`, `dispatch`, `pushToast`, `adoptDefinition`, `dismissSavedToast`, `savedToastRef`, `requestUndo`,
  `setCascade`, `setNotice`, `setSseActive`, `refreshRunHistoryAfterRun`, `refreshVisibleOutputPreviews`, `onRunNow`.
- `usePipelineDraftSave.ts` keeps `SaveArgs` (17 lines), state, the mounted and dropped effects (same order, both before every moved call),
  `post`, cascade, `reload`, the return object, and re-exports `DraftNotice`, `DraftCascadePrompt`, `PipelineDraftSave`
  so no import moves. `post` keeps every side effect in its current order (in-flight ref, `setSaving`, `setNotice(null)`,
  notices from the builder's result, `draftSaveRunPending`, `setSseActive(true)`, the `posted` flag, `finally`).
Projection: 276 (skeptic's measure after the round-1 moves) - 72 settle - 15 error mapping + about 45 for the new calls,
the result switch and re-exports -> about 235. Budget: every file in D3 <= 250, no exception.

### D4. The step preview keeps its title row; the editor gives way by a few pixels at 600px tall
Measured on main a6499da12 (dev server, filter editor selected, Output section open; identical in light and dark),
coordinates in px from the viewport top:
| case | main column | editor (scrollH/clientH) | first condition row bottom | preview box | title |
| main 900x700 | 93-500 | 109-376 (267/267) | 330 | 388-484 | 397-415 visible |
| main 900x600 | 93-420 | 109-376 (267/267) | 330 | 388-404 | 397-415 CLIPPED |
| editor shrinkable + preview min-height = whole header (64px), 900x600 | 93-420 | 109-328 (267/219) | 330 | 340-404 | visible; first row CLIPPED by 2px |
| editor shrinkable + preview min-height = title row (35px), 900x600 | 93-420 | 109-357 (267/248) | 330 | 369-404 | 378-396 visible; first row inside |
| same, 900x700 | identical to main 900x700 (nothing moves) |
"Usable editor" = HEL-1685 addendum G's criterion: the first condition row lies fully inside the editor's box. Decision:
in the disclosure layout only, `.step-preview` gets `min-height` = the title row: top border + header top padding +
title line box + header bottom padding: `calc(1px + 2 * var(--space-2) + 1lh)` on `.step-preview` (the title's
line-height is `normal`, not a token; `.step-preview` has the same font and `line-height: normal`, so `1lh` is the title's
18px line box; never a hard-coded 18px; measured 35px), and the editor becomes
shrinkable (`flex-shrink: 1; min-height: 0`; same `max-height`, still `overflow-y: auto`). The preview's `flex: 1`
basis is 0, so the editor shrinks only once the preview reaches that minimum: at 900x700 and above nothing moves; at
900x600 the editor gives 19px and scrolls inside itself while its first condition row stays fully visible. Header
content that wraps below the title row (schema chips, count) is clipped by the preview's existing `overflow: hidden`
at those heights; the guarantee is the title row only (on main the whole header is clipped at 900x600, so this is
strictly better; the PR body says so). Both the title and the addendum G criterion hold, so the ticket's
owner question is not raised. The executor re-measures; if the shipped CSS cannot hold both at 900x600, it stops and
returns ESCALATION with the owner question rather than choosing a policy.
Comment at `PipelineSpineLayout.css:64` is rewritten to state the real rule: the editor is capped at 45% of the column
and scrolls inside itself (raised to a 290px floor in the disclosure layout below).

### D5. Guards
- e2e `e2e/hel1704-narrow-preview-title.spec.ts`, 900x600 and 900x700, light and dark, Output section open, filter step
  selected: asserts `.step-preview__title`'s box lies inside `.step-preview`'s and `.spine-body__main`'s boxes, AND the
  first `.pipeline-detail-page__filter-condition-row` lies inside `.spine-body__editor`'s box, and the document does not
  scroll. Expected red on main: the 900x600 title assertions (both themes). 900x700 is expected green on main and is a
  no-regression check, not a red-first case. The red run is recorded in `evidence.md`. `e2e/hel1685-draft-polish.spec.ts`
  (addendum G, 900x800/700) stays in the before/after nets unchanged.
- jest: a key-set guard on `usePipelineDetailPage`'s and `usePipelineDraftSave`'s returned keys (recorded on main before
  the split), labelled a guard with a recorded mutation (drop one key -> red). Unit tests of `buildDraftSaveRequest` (all
  four kinds) and `noticeForSaveError` (stale, cascade, error), labelled characterization guards with recorded mutations.

## Risks / Trade-offs

- [Effect reorder slips in] -> D1, identity tests, e2e nets run before and after; reviewers diff call order.
- [Spread returns leak extra keys] -> key-set guard (D5).
- [min-height makes the column overflow] -> editor shrinks first; e2e checks the title is inside `.spine-body__main`.
- [Collision with HEL-1675] -> its files are out of scope; rebase if `PipelineSpineLayout.css` moves.

## Planner Notes

- Self-approved: D4. Measured (table above): pinning the min-height to the title row keeps both the title and addendum
  G's first-row criterion at 900x600, so the ticket's owner question does not arise. The 19px inner scroll of the filter
  editor at 900x600 only is the cost; hel1685's addendum G guard (800/700) is unaffected.
- Line counts in the ticket are stale (515/380 -> 562/433, HEL-1684); scope unchanged.

## Measured sizes

`wc -l` after the split (main a6499da12: `usePipelineDetailPage.ts` 562, `usePipelineDraftSave.ts` 433):

| file | lines |
| --- | --- |
| `usePipelineDetailPage.ts` (composer) | 212 |
| `usePipelineDetailAnalyze.ts` | 117 |
| `usePipelineDetailStepActions.ts` | 126 |
| `usePipelineDraftRouting.ts` | 130 |
| `usePipelineDetailUiState.ts` | 40 |
| `usePipelineStepsSeed.ts` | 72 |
| `usePipelineDetailSaveWiring.ts` | 95 |
| `usePipelineDraftSave.ts` | 234 |
| `draftSaveRequest.ts` | 122 |
| `usePipelineDraftAdopt.ts` | 46 |
| `usePipelineDraftUndo.ts` | 92 |
| `usePipelineDraftSettle.ts` | 130 |

Every file is under 250; the composer needed no exception (the sub-hook results are held as objects and spread, so it landed well under the 285 projection).
