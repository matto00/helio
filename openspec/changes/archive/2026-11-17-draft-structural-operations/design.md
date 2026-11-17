## Context
See proposal.md for why. On main (46ab3251e):
- Draft = `DraftOverlay {configs, enabled, deleted}` keyed by saved ids (`state/pipelineDraft.ts`), held by
  `usePipelineDraft` on the page hook. Kept per tab as `{overlay, base}` (`state/keptDraft.ts`); a differing `base`
  restores as `staleRestored`.
- Every structural control reads `draftBlockReason` (`usePipelineDetailPage.ts:420`) via `structuralBlockedReason`.
- With no draft, insert/add (`handleInsertStep`), "+ lane" (`usePipelineLaneStepCreation`), duplicate
  (`handleDuplicateStep`) and reorder (`handleReorderSteps` via `useLaneReorder`) write immediately. Server primitives:
  insert = splice (the new step becomes the anchor's sole child; former children move under it, positions kept);
  "+ lane" = attach at max sibling position + 1 (min 1); duplicate = splice of a copy after the original; reorder =
  trunk permutation. AI kinds stay local temp steps until complete.
- `POST /api/pipelines/:id/draft/save` (`DraftDiff.scala`) takes the final tree with `clientId`/`parentClientId` for
  new steps; the response has no clientId→id map.

## Goals / Non-Goals

**Goals:** each action yields, in the draft, the tree its immediate version yields on the server.
**Non-Goals:** roots, shapes, Outputs (incl. "Add output", aggregate-tail Output): they stay blocked. No backend change.

## Decisions

### D1. The overlay becomes an ordered op log
`DraftOverlay = {version: 2, ops: DraftOp[], configs, enabled}`. `configs`/`enabled` are keyed by a saved id OR a
`clientId`. `ops` are replayed in order over the saved steps:
`delete {stepId}` | `insert {clientId, kind, config, anchor}` (anchor = `{after: stepId|clientId}` or
`{head: rootId}`, or `{append: rootId}`) | `lane {clientId, kind, config, parent}` |
`duplicate {clientId, of, kind, config, enabled}` | `reorder {rootId, trunk: (stepId|clientId)[]}`. Each op is a pure
function over `Step[]`, unit-tested against the server primitive it mirrors (citing the Scala line), the same way
HEL-1631 tested `deleteStep`: insert/head/duplicate mirror `spliceInsertReportingInternal`; append mirrors the splice
under `PipelineService.resolveRootTrunkAnchor(…, None)`'s `trunk.lastOption`, so it also moves the last trunk step's
tails under the new step; lane mirrors `attachTailInternalAction`; reorder mirrors `reorderTrunkAction`. `duplicate`
captures the source's kind, draft config and enabled flag in the op itself when it is recorded, so later edits to the
original never change the clone.

**Deleting a new step mirrors the server too** (one rule for every step, the same as the immediate add-then-delete):
the first child by position is promoted into its slot, and every other child and its subtree is removed. So deleting a
just-inserted step restores the base only when the anchor had at most its trunk continuation. If the anchor also had
tails, those saved tails are removed by the delete, the draft still exists, and Save & run asks for cascade confirmation
naming them, as it does for any saved step a draft removes. Rejected: treating delete of a new step as "undo its op".
That would make the same click behave differently in and out of a draft, and it gets ambiguous once later ops anchor on
the new step.

**Every replay validates every op** (not only on Reload). The base can change while an op log exists: an immediate
write started before the draft opened lands after it, or a pending AI temp step's deferred create completes
(`createDraftIfComplete`). An op whose referenced ids are absent is dropped, together with every later op that
references its clientId. A `reorder` whose recorded id set is not exactly the live trunk set of that root at replay is
dropped whole, never partially applied, because a partial relink would leave one parent with two position-0 children.
`applyOverlay` returns `{steps, dropped}`. `usePipelineDraft` prunes dropped ops from the stored overlay and surfaces the
count through the same notice D8 uses ("N draft changes could not be applied"). Unit test: a base that gains a trunk
step under an existing reorder op drops that op, and the tree stays valid (one position-0 child per parent).
Ownership: `usePipelineDraft` computes the render-time `dropped` from the replay and prunes the stored overlay in one
effect, exposing `droppedNotice`; `usePipelineDraftSave` owns the notice (`setNotice`) and shows that count. While
`staleRestored`, the stored overlay is NOT pruned, so "Reload the saved pipeline" (`rebase`) still reports every op it
drops. Rejected: the old overlay plus `created[]` and a positions map (a second ordering model).

### D1a. Temp (`step-N`) steps in a draft
A not-yet-created AI temp step can sit in the page steps while a draft is open (`buildLaneGraph` sweeps it into root
0's trunk lane), but it never exists in a saved base, so no op may depend on it.
- One function, `liveTrunkIds(steps, rootId)` in `state/pipelineDraft.ts`, computes a root's trunk from parent links
  with temp ids excluded. Both D10 (recording a reorder) and D1 (validating it at render and at save) use it, so a
  recorded trunk never holds a temp id, the same as the immediate `handleReorderSteps` today.
- Insert anchors in a draft are resolved over `draftSteps` (not `stepsRef`) by `computeInsertAnchor`, which skips temp
  ids. A clientId counts as a valid anchor.
- "+ lane" and duplicate on a temp step are disabled during a draft, with the reason "Save or discard your draft first"
  (the temp step's own deferred create is unchanged).
- `post()` replays the overlay over the freshly read saved steps; if that replay reports `dropped > 0` it sends no
  request and shows the D8 notice. It never sends a reduced tree.
Unit tests: a draft reorder over a trunk lane holding a parentless temp step is recorded without it and survives replay
over a base with no temp steps; an insert at a gap after a temp step anchors on the nearest non-temp step; `post()` with
a dropping replay sends nothing.

### D2. Canonical "no draft"
`hasDraft` is true iff the final tree (`normalizeStepForCompare` over every step, new steps included) differs from the
base. When an op leaves the tree equal to the base and no config or enabled entry remains (for example, a step added
after a leaf and then deleted, or Move down followed by Move up), the overlay resets to `EMPTY_OVERLAY`. Config/enabled
pruning is unchanged for saved ids. For a new step, `configs[clientId]` equal to the op's own config is pruned.

### D3. Routing: draft only while a draft exists
`usePipelineDetailPage` routes each of the five actions into the draft iff `draft.hasDraft`. Otherwise the action keeps
today's immediate path unchanged. This mirrors how HEL-1631 routes saved-step vs temp-step edits
(`usePipelineDetailPage.ts:342-365`). `draftBlockReason` is split: step actions get `null`, while roots, shapes and Outputs
keep `DRAFT_BLOCK_REASON`. An AI kind added inside a draft becomes a draft-new step (not a temp step): it is
`notPreviewed` like any AI step, and an incomplete config is refused by the save's existing 400, mapped to that step.
Rejected: making every structural action a draft entry even with no draft open. That changes the no-draft behavior the
ticket does not ask to change, and would break a large set of existing immediate-path e2e specs.

### D4. Client ids
`clientId = "draft-" + random base36`, ≤ 64 chars (draft-preview id cap); not a temp id, so it is evaluated. Per-step
preview/PATCH/analyze are already suspended in a draft; any per-step fetch must also skip `isDraftClientId` ids (tested).

### D5. Save body
`toDraftSteps` emits `clientId` instead of `id` for a new step, and `parentClientId` when the parent is new. Positions
come from the final tree. `stepNamedBy` (the 400→step mapping) also resolves a clientId for `DraftDiff` errors. A
lane-cycle 400 from `DraftSaveTransaction.laneGate` names a server-minted id of a rolled-back row and cannot be mapped,
so it shows the generic save error (accepted). Cascade confirmation is unchanged: only removals of saved steps or
Outputs need it.

### D6. Selection after Save & run
No clientId map comes back, so a selected new step is resolved in `saved.definition.steps` by walking parent links
from a saved ancestor (the root, for a head insert) and matching `(position, type)` among siblings; else the nearest
saved ancestor, else the root's first step. `?step=` (`useStepDeepLink`) follows the selection; a kept-draft restore with
`?step=draft-…` resolves to the restored step. Undo (`DraftRestore` re-applies the prior definition): a selection that
no longer exists falls back the same way.

### D7. Kept draft v2 and old-format restore
Write `{version: 2, overlay, base}`. Read: version 2 is validated op by op: every op must carry all of its fields (for
`duplicate` that is `clientId`, `of`, `kind`, `config` and `enabled`), and an unknown op kind or a missing field rejects
the whole kept draft, as an unparseable one does today. A kept draft with no `version` and `{configs, enabled, deleted}` is the v1
format: it is restored as `ops = deleted.map(delete)`. The `base` and stale semantics are unchanged.

### D8. Rebase ("Reload the saved pipeline") and dropped ops
The same replay validation as D1 applies. Replay keeps an op only if every id it references exists in the new base or was produced by a kept earlier op. A dropped
op drops every later op that references its clientId, and their config/enabled entries. `dropped` counts dropped ops plus
dropped config/enabled entries, so the existing notice wording still applies.

### D9. Frames and transport
New steps are evaluated (`toStepDefinitions` maps every non-temp step) and absent from the base walk, so the spine
shows only their draft count. ClientIds flow through `draftPreviewRequest` (incl. HEL-1705 `rowsStepIds`) unchanged
(unit test).

### D10. Reorder in a draft
`useLaneReorder` is unchanged. `handleReorderSteps` gets a draft branch that records `reorder {rootId, trunk}`: the
order from `reorderLane`'s result, filtered to `liveTrunkIds` (D1a). Drag is desktop only (as today). The phone uses Move up/down in the step sheet's "Step actions"
menu (`PipelineMobileLayout.tsx:89`).

### D11. e2e (fails first)
New `e2e/hel1684-draft-structural.spec.ts`. Per action (add, insert, duplicate, "+ lane", Move up/down, drag), with a
draft already open: the action is enabled, no `/api/pipeline-steps*` or `/api/pipelines/:id/steps*` write is sent, the
spine shows the new structure with draft counts, then Save & run sends exactly one `draft/save` whose body carries the
clientId(s), and after reload the saved structure equals the pre-save draft. One Discard variant per action restores the
saved pipeline with no request. Desktop and a 375px phone describe; the phone describe runs `colorScheme: "dark"`, the
desktop one light, and one desktop dark plus one phone light smoke cover the remaining pairs. Kept-draft restore with a
new step, v1-format restore (seeded sessionStorage), stale-base with a new step. Undo after saving an insert + Move
down restores the pre-draft structure, selection on a surviving step. Delete of a new step inserted after a step with a tail: the cascade confirmation names
the tail. Phone Move up/down is driven through the sheet's "Step actions" menu. Waits only on real readiness
signals (aria-current, a loaded card's count), never skeleton-matchable selectors. Red run: the spec run against main's
code fails on the disabled controls; that transcript is kept as evidence. `hel1631-draft-mode.spec.ts:527` is updated to
assert roots, shapes and Outputs are still blocked.

## Risks / Trade-offs
- [Emulation drift] → per-op unit tests citing the Scala, plus the e2e "saved == pre-save draft" assertion.
- [A v2 kept draft opened by an older build] → fails validation (no `deleted`), reads as absent; lost, never misapplied.
- [Large op logs] → bounded by one tab's actions; replay O(ops × steps) is negligible next to the evaluator.

## Planner Notes
- Self-approved: D3 (draft only while a draft exists), D6 fallback, D11 light/dark distribution, D1a's block on a temp
  step. Each is reversible and listed in the PR body. PR body also notes: duplicating a saved step whose stored config is
  incomplete works immediately (`duplicateStep` skips `requiredConfigProblems`) but a draft Save of it gets a 400.
- "Only draft change is …" scenarios are reached by opening the draft with another edit and reverting that edit.
- Owner ruling `split-as-proposed` (HEL-1684, chat): roots → HEL-1734, Outputs and shapes → HEL-1733.
