## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD e0443c24d0c02b41cdda105a410cea0b6bdf2b33 (branch feature/draft-outputs-and-shapes/HEL-1733). The change dir
is untracked, so every claim below comes from reading the live source. Owner rulings Q1 (`inline-confirm-then-save-dialog`)
and Q2 (`one-pr`) are taken as fixed. I have not judged the one-PR scope infeasible. The design is large, but the defects
below are design defects, not size defects.

### What I verified (with evidence)

- **Server Output planning** (`backend/.../draft/DraftDiff.scala:254-302`). Outputs resolve by `id` or `clientId`, and
  the node by `nodeStepId`, `nodeStepClientId` or `rootId` (`resolveNode`). A kind change or a node move is a 400. An
  Output named by `nodeStepId` on a removed step is a 400 (`resolveNode`: "is a step the draft removes"), so the client
  must omit those Outputs, and D9 does. Removed Outputs are `explicit ++ cascaded`. **The D12 defect is real:** the update
  branch (line 295) and the create branch (line 296) both call `validateConfig(kind, config, JsObject.empty)`.
- **Merge semantics** (`OutputConfigValidation.scala:58-76, 202-227`). `mergeConfig = existing.fields ++ patch.fields`
  keeps `JsNull` values. The tolerance rule (`tolerated`) accepts a re-sent stored value or a null. Immediate
  `OutputService.update` (lines 203-240) validates `(patch, existingConfig, policy)` and, under `RestorePriorStored`
  only, writes `LegacyOutputFormat.normaliseRestored(merged)`. Reads never normalise Output config (grep), so
  `Output.config` on the client is the raw stored config. D4's `{...current, ...patch}` therefore equals the server
  merge, including across successive edits, provided the sheet's baseline `output.config` is the draft config.
- **D12 restore policy.** Restore mode is `DraftSaveMode.Restore` (`DraftSaveTransaction.scala:24-27, 84`).
  `cascadeGate` (lines 115-135) refuses a restore that would delete panels or alert rules, and `DraftRestore.scala:16-45`
  refuses an undo whose save cascade-removed panels or alert rules. D6's undo statement is accurate.
- **Cascade dialog and confirm copy exist as the design describes.** `PipelineDraftDialogs.tsx:24,43,53,57,62` ("This save
  removes other things", "Output: {name}", "... bound to those Outputs", "... on those Outputs", "Remove and save").
  `OutputEditorFooter.tsx:42` holds the "Confirm delete (removes from N dashboards)" text.
- **The block reason is as described.** `usePipelineDetailPage.ts:156` sets
  `draftBlockReason: draft.hasDraft ? DRAFT_BLOCK_REASON : null`. It reaches `SpineOutputs.tsx:53,96`,
  `PipelineSpine.tsx:233` and `MobilePipelineHeader.tsx:46-53`.
- **Draft op model** (`state/draftOps.ts`, `state/pipelineDraft.ts`). Checked `applyOp`, `replayOps`, `pruneOverlay`
  (the `noStructureChange ? [] : keptOps` branch), `withOp`, `isOverlayEmpty` and `rebaseOverlay`. `pruneOverlay` drops
  config and enabled entries whose step is gone unless `keepOps` is set.
- **Kept draft** (`state/keptDraft.ts`, `hooks/usePipelineDraft.ts:56-101`). The restore fires at
  `ready = stepsInitialized && !stepsLoading && !stepsFailed` (`usePipelineDetailPage.ts:55`), which is steps only. The
  stale check compares `kept.base` with `baseSignature(baseSteps)`. The dropped-op effect at lines 96-101 prunes and
  counts whenever `replayed.dropped > 0`.
- **Outputs load separately.** `allOutputs` is selected in `usePipelineOutputSheets.ts:35`, which runs AFTER
  `usePipelineDraft` (`usePipelineDetailPage.ts:51` vs `:108`).
- **Save body** (`hooks/draftSaveRequest.ts:61-95`). A `dropped > 0` replay sends nothing (`{kind: "dropped"}`).
  `toDraftOutputs` emits the saved Outputs.
- **Sheet** (`OutputEditorSheet.tsx`). `buildEditConfig` diffs against `output.config`. `withHistoryPayloads` is gated
  on `historyPayloadsAvailable`. Create mode has a local **Step picker** (`setNodeStepId`, lines 330-341) over `steps`,
  which `PipelineDetailDialogs.tsx:33` passes as `page.steps`, i.e. the draft steps. Capabilities come from
  `fetchNodeCapabilities` keyed on the sheet-local `nodeStepId`.
- **Capabilities port.** `PipelineNodeReads.buildNodeCapabilities` (`PipelineNodeReads.scala:232-246`) is a private
  method of the `private[pipelines] final class PipelineNodeReads`. `OutputBindingSpec.evaluate` and the slot
  eligibilities (`OutputBindingSpec.scala`) amount to about 30 lines of logic: Numeric is integer/float, Orderable is
  timestamp/integer/float, Any is everything, and unknown types are dropped via `DataFieldType.fromString`. A TS port is
  clearly feasible. Precedent for a Scala test reading a frontend fixture exists (`OutputSummaryReducerSeamSpec.scala`,
  `ProductEventRegistrySpec.scala`).
- **Client schema inference** (`state/draftEvaluation.ts:144-164`). `schemaFromFrame` infers only
  string/integer/float/boolean. A type comes from `known` only by name, and `frameSchema` (`evaluatePipeline.ts:67`)
  derives columns from rows, so an empty frame has no columns.
- **Shapes** (`usePipelineShapeInstantiation.ts`). The first step goes under the anchor; each later step is placed under
  the step its `parentStepId` names, mapped to a real id. **The server never returns shape Outputs:**
  `PipelineShapeProtocol.scala:84-92`, `ExpandPipelineShapeResponse.fromDomain(...)` → `outputs = None` "for EVERY shape
  today". Expansion clientIds are `s"step-$idx"` (line 75), the exact pattern `isTempStepId` (`/^step-\d+$/`,
  `stepNarrowing.ts:408`) treats as a temp step. A no-parent create appends after the trunk's last step
  (`PipelineService.resolveRootTrunkAnchor`, `position = None`), so D8's `{append: roots[0].id}` claim holds.
- **Aggregate tail** (`usePipelineStepStructure.ts:104-148`). Creates the step with `attachAsTail = true`, which is the
  lane primitive (`attachLane` in `draftOps.ts`). D8 matches.
- **Post-save mapping.** No clientId map comes back (`types/draftSave.ts:64-73`). The HEL-1684 precedent is
  `state/draftSelection.ts savedStepForDraftStep`.
- **HEL-1704 D1** (archive design.md:26-33). Only effect-bearing call order in the page hook matters, and
  `useLatestCallback` is effect-bearing. A new `useState` is effect-free, and new routed handlers appended after existing
  ones do not reorder anything. **D5's wiring does not violate D1:** the frames object is memoised
  (`usePipelineDraftFrames.ts:163-190`), so a holder written only on frames-identity change cannot loop.

### Verdict: REFUTE

### Change Requests

1. **D2/D1: `pruneOverlay` would erase Output ops.** `pruneOverlay` (`pipelineDraft.ts`) sets `ops = []` whenever the
   replayed steps' `structureKey` equals the base. With Output ops in the same `ops` array, a draft holding only a step
   config edit plus a new `outputCreate` on a saved step has no structure change, so the create is silently wiped (and
   `hasDraft` may then flip). Also specify how `applyOp`/`replayOps`/`withOp` treat `outputCreate`/`outputDelete` (a
   step no-op, never `null`), and that `isOverlayEmpty` includes `outputEdits`. State the rule: the no-structure-change
   reset drops only step ops, and Output ops are pruned only by the D2 Output rules. Add a unit test for "config edit +
   Output create keeps the create".

2. **D1: `replayOutputs` cannot apply its own "at that point of the log" rule.** As signed,
   `replayOutputs(baseOutputs, replayedSteps, ops, outputEdits)` receives only the FINAL steps. From final steps it
   cannot tell "the node was deleted later in the log" (a cascade, not counted) from "the node never existed when the
   op ran" (a rebase where a saved step vanished on the server, which must be counted). Treating the second as a cascade
   lets Save drop the created Output silently, which breaks the HEL-1684 D1a "a dropping replay sends nothing"
   invariant. Specify an interleaved replay: step and Output ops replayed together, or `replayOps` exposing the step-id
   set before each op. Add a test for "rebase where the outputCreate's saved node is gone → counted".
   Also state that `pruneOverlay` removes an `outputEdits` entry whose Output is gone because of the draft's own
   `outputDelete` or a step cascade (unless `keepOps`). Otherwise edit-then-delete of a saved Output leaves a counted
   entry, `dropped > 0`, and Save & run refuses (`draftSaveRequest.ts:86`).

3. **D11/D1: base-Outputs readiness is unaddressed.** The draft restores at steps-ready (`usePipelineDetailPage.ts:55`),
   while `allOutputs` is selected later in the hook (`usePipelineOutputSheets.ts:35`, after `usePipelineDraft` at
   `:51`) and loads independently. Replaying with an unloaded (empty) Output list makes every saved-Output
   `outputDelete`/`outputEdits` "absent". The dropped-op effect (`usePipelineDraft.ts:96-101`) then permanently prunes
   them and shows a false "dropped" notice, and the D11 Output-aware stale check flags a fresh restore as stale. Specify:
   - where `usePipelineDraft` gets `baseOutputs` (an effect-free selector may move up under HEL-1704 D1);
   - that the restore, the stale comparison and the dropped/prune effect wait for `outputsLoaded`;
   - a unit test for "restore with Outputs not yet loaded loses nothing".

4. **D11: v2/v1 kept drafts would always restore as stale.** Their `base` is the steps-only `baseSignature`. If the v3
   `base` "gains the base Outputs' signature" and the restore compares it to a combined signature, every v2 kept draft
   mismatches and opens stale. The spec's "Step-structure-format kept draft" scenario then only passes because it never
   asserts not-stale. Specify the shape: for example a separate `outputsBase` field in v3, compared only when present,
   with v1/v2 compared on steps only. Add a "not stale" assertion to the v2 unit test and to the seeded-sessionStorage
   e2e.

5. **D5/D7: the draft schema loses column types the server keeps.** `schemaFromFrame` infers only
   string/integer/float/boolean, so a `timestamp` column becomes `string`. The design says the draft view schema feeds
   the TS port, and gives a root node `schemaFromFrame` of the root sample. As written:
   - a timeline `time` slot (Orderable), and the chart time-axis typing (`toChartFieldTypes`), differ from what the
     server computes for the same node. This holds even for the ROOT and for SAVED nodes, which the immediate path shows
     correctly today, so it is a regression;
   - an empty frame (for example a filter that removes every sample row) yields no columns at all.

   "Eligibility equals the server for the same columns" is then true of the port but false for the user. Specify the
   `known` types for each node class (saved node: its saved capabilities/analyze schema; root: the source schema;
   draft-new: types carried by name from the nearest saved ancestor) and the empty-frame fallback. Add a jest case with
   a timestamp column at a root and at a draft-new node.

6. **D5: the create-mode Step picker is not wired.** The sheet keeps `nodeStepId` locally and lets the user change it
   (`OutputEditorSheet.tsx:330-341`, options = draft steps). D5's holder `{frames, nodeStepId}` and the addition to
   `outputNodeStepIds` are both written by the layout from `page.outputSheet`. The layout cannot see a picker change, so
   after a change the preview has no rows for the new node (it is not in `rowsStepIds`) and the columns come from the
   wrong node. Specify that the picked node is lifted to page state (or that the sheet reports it through a page
   setter), so the layout adds it to `outputNodeStepIds` and the sheet reads that node. Add a test that changes the
   picker to a draft-new step.

7. **Spec and design contradict each other on capabilities and preview requests.** The spec ("Output actions inside a
   draft") says an Output action in a draft "SHALL send no request to any Output, step, capabilities or preview
   endpoint". D5's fallback sends `GET /capabilities` for a saved node with no draft schema, and the History view of a
   saved Output reads stored history. Reconcile: scope the spec to WRITE requests plus the draft-new-node read
   prohibition, or remove the fallback.

8. **D8 and the spec rest on a false premise about shape Outputs, and leave the clientId mapping ambiguous.**
   `PipelineShapeProtocol.scala:84-92` returns `outputs = None` for every shape. The ticket's and proposal's "a shape
   adds several steps plus Outputs" is false on this backend (premise-validation.md missed it), and the spec scenario
   "applies a shape with two steps and one Output" cannot be reached through the real `/expand`. Revise:
   - (a) The spec scenario must match what the real backend does (steps only). Cover the `outputCreate` path for
     expansion Outputs with a unit test, and optionally a route-stubbed e2e labelled as stubbed. Never claim it in an
     unstubbed e2e.
   - (b) D8 must say explicitly that each expansion step gets a freshly minted `draft-` clientId (`newClientId`) and that
     the expansion's own `step-N` clientIds are only map keys. Used as op ids or anchors, they match `isTempStepId`, and
     `spliceAfter` then refuses them (returns `null`).

9. **D13 does not show the C2 matrix.** C2 binds "every draftable action ... desktop+phone, light+dark". D13 lists seven
   actions, then "Desktop and a 375px phone describe" plus two theme smokes, without saying whether every action runs in
   BOTH describes. State it: each of the seven actions runs in the desktop (light) and the phone (dark) describe, or name
   any action not reachable on phone and why. For each action, name the red assertion on main (for example "control
   disabled with 'Save or discard your draft first'"). Also add the root-bound Output create, which the spec requires
   ("or on a root") but D13 does not cover, or drop it from the spec.

### Non-blocking notes

- **D12.** With `RestorePriorStored`, `OutputService.update` also writes `normaliseRestored(merged)`; the D12 plan
  validates but does not normalise. That is probably moot for journals captured after V117/V118, but say so, since D12
  claims to act "as patch-set rollback does". Also note that `validateConfig(kind, config, cur.config)` judges
  `cur ++ config`, while `updateOutputs` writes `config` whole. That is harmless while D4 never drops keys; record the
  assumption.
- **D7.** `buildNodeCapabilities` is an instance method of a class with constructor dependencies. Moving it (pure) to a
  companion object is simpler than widening its visibility. Include `DataFieldType.fromString` synonyms (`number`,
  `double`, `long`) and an unknown type string in the fixture, because the port must drop or normalise them as the
  server does. "202 Scala lines" overstates the port; the logic is about 30 lines.
- **D10.** Resolve a created Output's node after save with `savedStepForDraftStep` (`state/draftSelection.ts`). A bare
  `(node, kind, name)` cannot match a node that was a clientId.
- **D1.** State the created Output's name default (`name.trim() || "Untitled output"`, as the immediate create does).

Verdict category: design-judgment.
