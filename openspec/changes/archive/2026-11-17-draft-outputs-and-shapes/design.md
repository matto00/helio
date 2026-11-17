## Context

See proposal.md (Why) and `premise-validation.md` (persisted evidence). Ground truth on main e0443c24d:

- Draft model: `DraftOverlay {version: 2, ops, configs, enabled}` (`state/pipelineDraft.ts`), ops in `state/draftOps.ts`
  (`delete | insert | lane | duplicate | reorder`), replayed over the saved steps on every render with per-op validation
  (`replayOps`, HEL-1684 D1). Kept per tab as `{version: 2, overlay, base}` (`state/keptDraft.ts`).
- Routing: `hooks/usePipelineDraftRouting.ts` is the single place an action becomes a draft op or an immediate write
  (HEL-1704 D2); actions route into the draft iff `draft.hasDraft` (HEL-1684 D3).
- Save body: `hooks/draftSaveRequest.ts` `buildDraftSaveRequest` replays the overlay over the freshly read definition and
  emits `toDraftOutputs(definition.outputs, finalSteps, roots[0]?.id)` (the saved Outputs, minus those on removed steps).
- Block: `usePipelineDetailPage.ts:156` `draftBlockReason = hasDraft ? DRAFT_BLOCK_REASON : null` feeds
  `structuralBlockedReason` (roots, shapes, "+ Output", Output card open, step menu "Add output") and
  `MobilePipelineHeader.tsx:46-53` ("Add source", "Add Outputs from a shape").
- Output editor sheet (`ui/outputEditor/OutputEditorSheet.tsx`), rendered by `PipelineDetailDialogs` as a sibling of the
  layout: create = `createOutput`, edit = `updateOutput` with a config PATCH (`buildConfigPatch`, HEL-1389; nulls clear;
  `historyPayloads` only when changed), delete = two-click `Confirm delete (removes from N dashboards)` then
  `deleteOutput`. Its columns/eligibility come from `GET /api/pipelines/:id/capabilities?stepId` (server
  `PipelineNodeReads.buildNodeCapabilities` over `projectedSchemaAtNode` of the SAVED definition; 404 for an unknown
  step), its preview from `useOutputPreview` (saved) / `useUnsavedStepPreview` (create).
- Server: `DraftDiff.planOutputs` accepts Outputs by `id` or `clientId`, node by `nodeStepId`, `nodeStepClientId` or
  `rootId`; refuses a kind change or a node/root move (400); an edit writes the whole `name`/`config`
  (`PipelineDraftWrites.updateOutputs`). Removed Outputs and Outputs on removed steps go through
  `OutputRepository.deleteOutputsCoreAction` (panels deleted, alert rules FK-cascade, V94:391) after the cascade gate
  (`DraftSaveTransaction.cascadeGate`, 422 listing steps/Outputs/panels/alert rules). Today's immediate
  `OutputService.delete` calls the same core. Undo (`DraftRestore`) recreates removed Outputs under their ids and refuses
  (409) when the save removed panels/alert rules or a created Output has since been bound.
- Defect: `planOutputs` validates an edit as `OutputService.validateConfig(kind, wholeConfig, JsObject.empty)`, while
  `OutputService.update` validates the patch against the stored config (`OutputConfigValidation` tolerance rule). An
  Output whose stored config carries a legacy key (V94 renames/dead styling) therefore 400s on any draft edit, even a
  rename.
- Shapes: `usePipelineShapeInstantiation` creates the expansion's steps as a chain of splice inserts (first under the
  anchor, each next under the previous) and then its Outputs on them. Aggregate tail
  (`usePipelineStepStructure.handleAddOutputViaAggregateTail`) creates an `aggregate` step with `attachAsTail = true`
  (the "+ lane" primitive) and then an Output on it.

## Goals / Non-Goals

**Goals:** each Output action, shapes and the aggregate tail yield in the draft exactly what their immediate version
yields on the server; Save & run applies them atomically; Discard drops them; kept-draft restore, stale base and undo
keep working; one PR (owner ruling `one-pr`).
**Non-Goals:** roots (HEL-1734); any no-draft behavior change; moving an Output to another node or changing its kind;
migrations.

## Decisions

### D1. Overlay v3: Output ops in the same log, Output edits in a map
`DraftOverlay = {version: 3, ops, configs, enabled, outputEdits}`. New ops in the same ordered `ops` array (so replay order
settles "an Output created on a step a later op deletes"):
- `outputCreate {clientId, node, kind, name, config}`, `node` = `{step: stepId|clientId}` or `{root: rootId}`.
  **Root rule (skeptic round 2, CR-D):** the sheet's "Pipeline source" target (no step) records `{root: roots[0].id}`
  ONLY when the pipeline has exactly one root, which is what the server does for the immediate create
  (`OutputRootResolution.scala:25-35`). With several roots the immediate create with no step is a 400; in a draft that
  option is disabled in the sheet's picker with the hint "Pick a step: this pipeline has several sources", and the sheet's
  Save stays disabled until a step is picked, never a silent `roots[0]`. A step target is never a temp id (D3).
- `outputDelete {outputId}` (`outputId` = a saved Output id or an `outputCreate` clientId).
`outputEdits: Record<outputId|clientId, {name, config}>` holds the WHOLE resulting name and config (D4), like `configs`
for steps. Output clientIds use the same `draft-` prefix and minting as step clientIds (`newClientId`).
**One interleaved replay (skeptic round 1, CR2).** `replayOps` is extended, not paralleled: it walks the single `ops`
array once, carrying BOTH the current `Step[]` and the current `Output[]` (seeded with the base Outputs), so every op is
judged against the state at its own point in the log:
- A step op (`delete | insert | lane | duplicate | reorder`) applies to the steps exactly as today (`applyOp`, unchanged
  signature); after it, every current Output (saved or created) whose node step is no longer present is removed and
  recorded in a `cascadedOutputIds` set, NOT counted. That is the server's cascade of a deleted step
  (`planOutputs`' `cascaded`), the HEL-1631 rule (`outputsOnRemovedSteps`), now applied in order.
- `outputCreate` applies to the Outputs; its node must exist in the steps at that point (a `{step}` node) or be a
  pipeline root (`{root}`); otherwise the op is dropped and counted (a rebase where the saved node vanished on the
  server), as are later ops naming its clientId (HEL-1684 D1 dependent-drop rule).
- `outputDelete` removes the Output if present at that point; if absent and not in `cascadedOutputIds` it is dropped and
  counted; if absent because a step cascade already removed it, it is a no-op and not counted.
- `applyOp` returns the steps unchanged (never `null`) for an Output op; `withOp` appends Output ops like step ops.
- `pruneOverlay(base, baseOutputs, overlay, keepOps, outputsLoaded)`: every `setOverlay` updater (`withConfig`,
  `withEnabled`, `withOp`, the new Output actions) passes `baseOutputsRef.current` and the loaded flag (D15).
After the log, `outputEdits` apply to the final Outputs: an entry whose Output is present applies; an entry whose Output
is in `cascadedOutputIds` or was removed by an `outputDelete` of the draft is ignored and NOT counted; any other absent
id is counted. The pure helpers live in a new `state/draftOutputs.ts` (Output op appliers, `applyOutputEdits`),
called by `replayOps`. `replayOverlay(base, baseOutputs, overlay)` returns `{steps, outputs, droppedOps, droppedEntries,
dropped}`.
A created Output is rendered as an `Output` with `id = clientId`, its `nodeStepId` set to the step id or clientId (or
`rootId` for a root node), `name = name.trim() || "Untitled output"` (the immediate create's default), `panelCount: 0`,
and no `historyPayloadsAvailable`.
Unit tests: "rebase where an outputCreate's saved node is gone -> counted and Save sends nothing"; "Output created on a
step a later delete removes -> removed, not counted"; "edit then delete of a saved Output -> dropped 0".
Rejected: a separate `created/edited/deleted` Output structure outside the op log (loses ordering against step deletes);
a second replay over the final steps only (cannot tell a later cascade from a rebase).

### D2. Canonical "no draft"
`hasDraft` stays `!isOverlayEmpty(overlay)` with every write canonicalised; `isOverlayEmpty` also requires `outputEdits`
empty. `pruneOverlay` (skeptic round 1, CR1) changes as follows:
- The existing "no structure change" reset (`structureKey(replayed.steps) === structureKey(base)` -> `ops = []`) drops
  only STEP ops; Output ops are kept and pruned only by the Output rules below. Unit test: "a step config edit plus an
  `outputCreate` on a saved step keeps the create (and `hasDraft`)".
- Output rules (skipped when `keepOps`, the stale-restored case, so "Reload the saved pipeline" still counts them):
  drop Output ops the interleaved replay dropped; drop an `outputCreate` together with the `outputDelete` of its clientId
  and its `outputEdits` entry (create-then-delete leaves nothing, as the immediate create-then-delete does); drop an
  `outputCreate` whose Output the step cascade removed, with its entry; drop an `outputEdits` entry whose Output the
  draft deleted or cascaded; drop an `outputEdits` entry equal to the Output's pre-edit name+config (for a created
  Output: equal to its create op's name+config, in which case the entry is dropped and the op kept).
- Nothing left -> `EMPTY_OVERLAY` = `{version: 3, ops: [], configs: {}, enabled: {}, outputEdits: {}}`.
Unit tests: edit-back, create-then-delete, edit-then-delete, each ending in the state the rule names.

### D3. Routing: Output actions, shapes and the aggregate tail draft only while a draft exists
`usePipelineDraftRouting` gains five routed handlers, each falling back to today's immediate handler when
`!draft.hasDraft` (HEL-1684 D3): `handleCreateOutput`, `handleUpdateOutput`, `handleDeleteOutput`,
`handleInstantiateShape`, `handleAddOutputViaAggregateTail`. The sheet stops dispatching `createOutput`/`updateOutput`/
`deleteOutput` itself: it calls these page handlers (`handleCreateOutput`, `handleUpdateOutput`, `handleDeleteOutput`; the
immediate path moved verbatim out of the sheet into `hooks/useOutputImmediateActions.ts`, same thunks, same post-create
`previewOutput`). Implemented: the page always passes them as the sheet's `actions` prop; a sheet rendered without it (the unit tests
that exercise the sheet alone) falls back to the same hook, so the decision lives in `usePipelineDraftRouting` for the app.
**Block reasons (skeptic round 2, CR-B).** `draftBlockReason` (`hasDraft ? DRAFT_BLOCK_REASON : null`) and the
`structuralBlockedReason` prop it becomes keep their value; what changes is which consumer applies it. Every consumer on
main, and its rule after this change:

| consumer | control | in a draft, after this change |
|---|---|---|
| `PipelineSpine.tsx:155-156` (`SpineSourceCard` canRemove/removeBlockedReason) | remove source | blocked (unchanged; HEL-1734) |
| `PipelineSpine.tsx:166-167` | "+ Add source" | blocked (unchanged) |
| `MobilePipelineHeader.tsx:46-47` | "Add source" | blocked (unchanged) |
| `PipelineSpine.tsx:234-235` | "Add Outputs from a shape" | enabled; anchor = last non-temp step of root 0's trunk over `draftSteps`; disabled only when root 0's trunk has steps and all are temp; with no steps it appends to `roots[0]` |
| `MobilePipelineHeader.tsx:52-53` | "Add Outputs from a shape" | same as desktop |
| `PipelineSpine.tsx:256` -> `SpineOutputs.tsx:53,96` | Output card open, "+ Output" | enabled |
| `useSpineStepActions.tsx:179-180` | "Branch from here" | unchanged: blocked iff `isTempStepId(step.id)` (HEL-1684 D1a) |
| `useSpineStepActions.tsx:183` | "Add output" | blocked iff `isTempStepId(step.id)` (was: always) |
| `StepCardFocused.tsx:100-101` | Duplicate | unchanged: blocked iff the step is a temp draft (HEL-1684 D1a) |
| `PipelineSpineLayout.tsx:77,224,266`, `PipelineMobileLayout.tsx:69,209`, `MobileStepSheet.tsx:97`, `usePipelineDraftPresentation.ts:117` | pass-through only | unchanged |

So the temp-step guards stay, and the new temp-step rules are: in a draft the sheet's Step picker omits temp (`step-N`)
steps, the aggregate tail on a temp node is disabled with the reason, and the routed handlers refuse an Output target or
parent that is a temp id (defence in depth; never recorded). The routed Output, shape and aggregate-tail handlers are also
disabled while Outputs are not loaded (D15). No root routing is added (HEL-1734). Unit tests: the consumer table above
(one assertion per row, draft and no-draft), and "routed outputCreate on step-N records nothing".

### D4. Output edit in a draft records the WHOLE resulting config
The server writes the draft's whole config (`updateOutputs`), while the immediate edit sends a shallow PATCH merged
server-side (`OutputConfigValidation.mergeConfig = existing ++ patch`). So the draft edit records
`config = {...currentConfig, ...patch}` where `patch` is exactly what the sheet sends today (`withHistoryPayloads(
buildEditConfig())`, nulls kept as `null` values, identical to the server merge) and `currentConfig` is the Output's
draft config (base config, or its earlier draft edit, or its `outputCreate` config). `name` is `name.trim()` (the
immediate edit sends it trimmed). Editing a created Output rewrites its `outputEdits[clientId]` (never its op). Unit test:
for a fixture set of stored configs and sheet patches, `draftMerge(stored, patch)` equals the Scala `mergeConfig` result
recorded in the D7 parity fixture.

### D5. The editor sheet in a draft reads the draft
While a draft exists the sheet's node data comes from the draft, never from saved-definition endpoints:
- **Columns and capabilities:** a new pure `state/nodeCapabilities.ts` ports `PipelineNodeReads.buildNodeCapabilities`
  and `OutputBindingSpec.evaluate` (the slot rules are about 30 lines: Numeric = integer/float, Orderable =
  timestamp/integer/float, Any = all; unknown type strings dropped and synonyms normalised as `DataFieldType.fromString`
  does) to TS over a `SchemaField[]`. `fetchNodeCapabilities` is not dispatched for a draft-NEW node.
- **Typed schema per node (skeptic rounds 1-3, CR5, CR-C, CR-1): the server's own projection, never inference.** The
  server never checks column types on an Output write (`OutputConfigValidation.scala:176-181`: type eligibility is a
  capabilities-time concern), so the sheet's capabilities are the only type guard and must be exact. Rule:
  - **Which source (skeptic round 4, simpler exact rule).** With no draft: today's server capabilities, unchanged.
    While a draft exists: the ROOT node ("Pipeline source") uses today's saved capabilities (a root is never changed by
    a draft; roots are not draftable, HEL-1734), and EVERY step node, changed or not, uses the server's projection of
    the DRAFT definition. No "is this node changed" computation exists, so it cannot be wrong (lanes included).
  - **The projection:** the existing `POST /api/pipelines/analyze-proposal` (`PipelineProposalAnalyze`, the same
    `PipelineAnalyzeService.analyzeNodes` the saved projection uses). Request: `{pipelineName: <the page's pipeline
    name>, roots: [{sourceId: root.dataSourceId, clientId: root.id}], steps: [...], outputs: []}` (`pipelineName` is
    required by the reader, `PipelineProposalProtocol.scala:249-252`); one step entry per replayed draft step, temp
    (`step-N`) steps excluded: `{clientId: <saved id or draft clientId>, type, config, parentStepId: <parent's id or
    clientId, absent for a parentless step; a real step whose local parent is a temp step is re-pointed to that temp step's
    own nearest non-temp ancestor, or made parentless under its root>, rootClientId: <rootId, for a parentless step>, enabled}`, sending `enabled`
    for EVERY step and never filtering disabled ones (the proposal makes a disabled node transparent,
    `PipelineAnalyzeService.scala:317-321`). Lane references in configs already name those ids. The node's
    `outputSchema` (response steps carry the clientId as `id`) feeds the TS `buildNodeCapabilities` port (D7).
  - **A sheet node disabled in the draft:** the response omits disabled steps (`PipelineProposalAnalyze.scala:82-83`);
    since a disabled node is transparent, its schema is its nearest ENABLED ancestor's `outputSchema`, or, with no
    enabled ancestor, its root's `sourceSchemas` entry from the same response. Jest case.
  - **Timing:** requested when the sheet opens on a step node, when its picker target changes, and when the draft
    changes while it is open (coalesced, at most one in flight, the latest wins); never while no sheet is open. It counts
    against the general `/api` limiter (120 per window): at most one per sheet interaction, recorded in Measured notes.
    While in flight the field pickers show the frame's column names with Save disabled ("Checking column types...").
  - **Projection unavailable** (the request fails, including a 500 from a step config that does not decode
    (`PipelineServiceSupport.scala:120-140`), or a 404 for an editor grantee who does not own the root source: verified
    in skeptic-design-4.md, `findByIdOwned`; on main the editor's saved capabilities are already empty there, so this is
    no worse; or the node has no derivable schema): column names come from the draft frame, and the sheet's Save is disabled for any kind with
    a type-restricted slot (Numeric or Orderable) with "Column types could not be checked; Save & run the draft first",
    while kinds whose slots accept Any stay savable. Never a silent unchecked binding.
  This is a READ that names no stored draft-only resource (D5a allows it). Jest cases (mocked endpoint): (a) a draft cast
  `date -> timestamp` above the node offers `date` for a timeline time slot; (b) a draft removing a saved cast no longer
  offers it; (c) an unedited saved step below an edited cast uses the projection, not its saved capabilities; (d) a draft
  rename carries the type; (e) projection failure (404 and 500) disables a chart Save and allows a markdown Save; (f) a
  sheet node disabled in the draft takes its nearest enabled ancestor's schema; (g) the request carries `pipelineName`,
  every step's `enabled`, and no temp step. An e2e (desktop) runs
  a type-sensitive version of (a) against the real backend. As written, (a) would pass vacuously: the time-slot picker lists every
  column (`outputConfigTypes.ts` `columnOptions`), and only the chart numeric slots (histogram field, heatmap value) read
  `eligibleColumns`. The e2e therefore inserts a draft `cast` of a text column to `float` and asserts the histogram field offers that
  column only after the cast (it is red on main: "Add output" is disabled in a draft). Jest holds (a)-(g) and the picker wiring.
- **Preview:** the sheet's preview pane renders the draft rows of its node from the same source the Live Output column
  uses (`liveOutputSource` over the frames), never `useOutputPreview`/`useUnsavedStepPreview` in a draft.
- **Wiring, picker included (CR6).** The sheet's target node becomes page state: `usePipelineOutputSheets` gains
  `sheetNodeStepId` (initialised from `outputSheet.output?.nodeStepId ?? outputSheet.createTargetStepId`) and a stable
  `setSheetNodeStepId`; the sheet's create-mode Step picker calls it instead of only its local `setNodeStepId` (the local
  state stays for the immediate path's existing behavior, kept in sync). The active layout adds `page.sheetNodeStepId` to
  its `outputNodeStepIds` while a sheet is open (so the HEL-1705 `rowsStepIds` request carries the picked node) and writes
  a page-level `sheetDraftNode` holder `{frames, nodeStepId}` in a layout effect only while a sheet is open and only on
  frames/node identity change; `PipelineDetailDialogs` passes it to the sheet. The new `useState`s are effect-free; the
  new layout effect is appended after the layout's existing effects (HEL-1704 D1). The frames object is memoised
  (`usePipelineDraftFrames.ts:163-190`), so the holder cannot loop. Jest test: change the picker to a draft-new step ->
  the layout's requested ids include it and the sheet's columns are that step's.
- **D5a. Requests in a draft (CR7).** In a draft the Output actions send no WRITE request (no `/api/outputs*` POST/PATCH/
  DELETE, no `/api/pipelines/:id/outputs` POST, no step writes) and no READ of a stored resource by a draft-only id (no
  `/capabilities?stepId=draft-*`, no `/api/outputs/draft-*`, no `/preview?outputId=draft-*`). Allowed reads: saved
  capabilities for the root node, `analyze-proposal` for every step node (it stores nothing), a saved Output's History.
  The spec states exactly this.
- **Hint copy in a draft:** the primary button keeps "Save" (it saves the entry into the draft); the sheet shows the line
  "Saved with the draft on Save & run" as its own `role="status"` block at the end of the header group (directly under Name / Step / Kind,
  spaced by the group's `--space-3` gap), so it is read before Save; not in the footer row. The typing hints ("Checking column
  types…", "Column types could not be checked; ...") share the block. Delete keeps the two-click text exactly (owner ruling Q1); the placements
  count is today's `useOutputSavedStatus` (a saved Output only; a created Output has none and shows plain "Delete").
- **Not in a draft:** unchanged (server capabilities, server preview, immediate thunks).
- History: available for a saved Output (read-only, it reads stored history), disabled for a created one ("Available
  after Save & run").

### D6. Output delete: same effect as today, owner-ruled confirm
Owner ruling Q1 `inline-confirm-then-save-dialog`: the sheet's two-click confirm records `outputDelete`; at Save & run
the server's 422 opens the existing cascade dialog listing "Output: <name>", "N panels bound to those Outputs" and
"N alert rules on those Outputs"; "Remove and save" re-sends with `confirmCascade`. At Save the Output, its bound panels
and its alert rules are removed by the same `deleteOutputsCoreAction` today's immediate delete uses. Deleting a CREATED
Output removes its create (D2), no dialog. Undo of a save that removed a bound panel is refused with the existing 409
naming it (unchanged server behavior; PR body states it).

### D7. Capabilities and merge parity fixture (seam test)
`buildNodeCapabilities` is moved, unchanged, from the `PipelineNodeReads` instance to a pure function on its companion
object (the instance method delegates; no behavior change). A Scala test (`NodeCapabilitiesParitySpec`) evaluates it and
`OutputConfigValidation.mergeConfig` over a fixture of input schemas/configs (every `DataFieldType`, the synonyms
`number`, `double`, `long`, an unknown type string, every Output kind's required/optional slots, an unbindable case per
kind, null-clearing patches) and asserts the result equals the checked-in
`frontend/src/features/pipelines/state/__fixtures__/nodeCapabilitiesParity.json` (precedent: `OutputSummaryReducerSeamSpec`
reading a frontend fixture). The jest test asserts the TS port and `draftMerge` over the same file. Drift on either side
reds one suite. Labelled a guard; recorded mutations: change one slot eligibility in the TS port -> jest red; change one
expected value in the fixture -> Scala red.

### D8. Shapes and the aggregate tail in a draft
- **Premise correction (skeptic round 1, CR8).** On this backend `/expand` returns NO Outputs for any shape
  (`PipelineShapeProtocol.scala:84-92`, `outputs = None`), so a real shape adds steps only. The ticket/proposal wording
  "steps plus Outputs" is the client's general contract (`ExpandPipelineShapeResponse.outputs?`), which the draft path
  still honours.
- **Shape:** the expansion is still fetched from the server (read-only). In a draft, `handleInstantiateShape` mints a
  FRESH `draft-` clientId (`newClientId`) for every expansion step; the expansion's own `clientId`s (`step-N`, which
  `isTempStepId` matches and `spliceAfter` refuses) are used ONLY as keys of a local `expansionId -> draft clientId` map,
  never as an op id or anchor. It records one `insert` op per expansion step, in order: the first anchored
  `{after: anchorStepId}` (or `{append: roots[0].id}` when the anchor is undefined, the server's no-parent append via
  `resolveRootTrunkAnchor`), each next `{after: map(parentStepId)}`; then one `outputCreate` per expansion Output (if any)
  on `{step: map(nodeStepId)}`, `name = name ?? kind`. All ops are appended in ONE overlay update (one render, one
  kept-draft write), so a shape is never half in the draft. The anchor is computed over the DRAFT steps (last trunk step
  of root 0 over `draftSteps`, temp ids skipped, HEL-1684 D1a) on desktop and phone.
  Tests: a jest unit test drives an expansion WITH Outputs (fixture response) and asserts the ops and the save body
  (`nodeStepClientId` = the minted id); the e2e uses the real `/expand` (steps only), plus one desktop test that stubs
  `/expand` with an Output-bearing response, titled "(stubbed /expand)".
- **Aggregate tail:** in a draft, records `lane {type: "aggregate", config, parent}` plus `outputCreate` on its clientId,
  in one update. The sheet closes as today. A temp (`step-N`) parent keeps it disabled with the block reason (D1a rule).
- The immediate paths are unchanged.
### D9. Save body
`buildDraftSaveRequest` takes the freshly read definition's Outputs as the replay's base Outputs and emits `outputs` from
`replayOverlay(...).outputs`: a saved Output carries `id` and its draft name/config; a created one carries `clientId` and
`nodeStepClientId` when its node is new, else `nodeStepId`, or `rootId` for a root node (a root-bound saved Output keeps
today's `rootId ?? fallbackRootId`). An Output the draft deletes or whose node the draft removes is omitted (the server
cascades; naming it by `nodeStepId` would be a 400, `DraftDiff.resolveNode`). A replay with `dropped > 0` sends nothing
(HEL-1684 D1a). Cascade-dialog names: `noticeForSaveError` resolves Output names from the base Outputs (removed Outputs
are always saved ones). `stepNamedBy` also names a created Output whose clientId appears in a 400 message.

### D10. Spine, Live Output column, selection
- `page.allOutputs` stays the SAVED list (Redux). A new `page.draftOutputs` (replayed, D1) is what the spine's Outputs
  section, the step rows' Output chips, `resolveDisplayedOutput` and the Live Output column read while a draft exists;
  with no draft it is `allOutputs` (same identity). `useDisplayedOutputNodeIds` (desktop `PipelineSpineLayout` and
  `PipelineMobileLayout.tsx:132`) reads `draftOutputs`, so a created Output's node rides `rowsStepIds`.
- A created Output's card meta shows "New · not saved" instead of the panel count; an edited one shows "Edited"; a
  deleted one is not listed. The Live Output column renders a created Output from its node's draft rows like any
  other; per-Output server reads skip clientIds (`useSavedOutputRows`, `useLiveOutputBaseline`, History) with the
  existing "not previewed" handling, never a request with a clientId.
- After Save & run, an explicit Output pick of a created Output is resolved by first mapping its node to the saved step
  with `savedStepForDraftStep` (`state/draftSelection.ts`, the HEL-1684 precedent; a root node is itself), then matching
  `(savedNode, kind, name)` among the saved Outputs created by this save (ids not in the pre-save base); else the pick
  clears (default resolution). Undo adopts Outputs as today (`adoptDefinition` replaces them). Unit test.

### D11. Kept draft v3
Write `{version: 3, overlay, base, outputsBase}`: `base` stays the steps-only `baseSignature` (unchanged format), and the
new `outputsBase` is a signature of the base Outputs (`normalizeOutputForCompare` over them, sorted by id). Read: v3
validated op by op (every `outputCreate`/`outputDelete` field present, `node` well-formed, `outputEdits` values
`{name: string, config: object}`); v2 restores as v3 with `outputEdits: {}` and no `outputsBase`; v1 as today. An unknown
op kind or a missing field rejects the whole kept draft. Stale on restore = `base` differs, OR `outputsBase` is present
and differs; a v1/v2 kept draft is compared on steps only (CR4), and its unit test and the seeded-sessionStorage e2e
assert it restores NOT stale. Rebase ("Reload the saved pipeline") applies D1's validation and counts.

### D15. Base-Outputs readiness (skeptic rounds 1-2, CR3, CR-A)
The draft never judges Output ops against Outputs that have not loaded, and the restore timing does not change.
- `usePipelineDraft` takes `baseOutputs: Output[]` and `outputsStatus: "loading" | "loaded" | "failed"` as inputs:
  `allOutputs` and the outputs list status are read through effect-free `useAppSelector` calls moved up above
  `usePipelineDraft` in the composer (allowed by HEL-1704 D1: effect-free calls may move; no effect-bearing call is
  reordered). A `baseOutputsRef` mirrors `baseStepsRef` for the `setOverlay` updaters.
- **Restore stays at steps-ready** (unchanged effect, unchanged firing condition), so no window exists in which a step
  edit can be overwritten, and the writer starts exactly as today. The restore sets the whole overlay (step and Output
  ops). Its steps-stale check runs then, as today.
- **Output part waits.** While `outputsStatus !== "loaded"`: the replay applies step ops only and carries Output ops
  through untouched (not applied, not dropped, not counted); `pruneOverlay` (called with `baseOutputsRef`) leaves Output
  ops and `outputEdits` untouched; the dropped/prune effect counts only step drops; `draftOutputs` is the saved list
  Redux holds (possibly the previous visit's; not judged); WHILE A DRAFT EXISTS the routed Output actions, the shape
  action and the aggregate tail are disabled with "Outputs are still loading" (or, when failed, "Outputs could not be
  loaded"). With no draft open nothing changes (immediate paths, today's behavior).
- **"Loaded" means THIS page's own fetch (CR-3 note).** After a Back, Redux still holds the previous visit's list with
  `listStatus` "succeeded" until the refetch's `pending`. So `outputsStatus` is page-local: `usePipelinePageLoad`'s
  `fetchOutputs` dispatch for this mount records its own completion (fulfilled -> "loaded", rejected -> "failed") in a
  page-hook state; until then it is "loading" whatever Redux says. A later refetch (e.g.
  `usePipelineStepStructure.ts:132`) never sets it back to "loading".
- **Output-base judgement happens before any Output drop is counted, once per restore (CR-3; trigger per skeptic round
  4).** It lives INSIDE the existing drop/prune effect (`usePipelineDraft.ts:97-102`), placed BEFORE its
  `droppedNow === 0` early return, and that effect's dependencies gain `outputsStatus` and `restoredTick` (a counter state
  the restore effect increments only when it restores a kept draft, so the nothing-kept path adds no render). So it runs once BOTH the restore has run for this
  pipeline AND `outputsStatus === "loaded"`, in whichever order they arrive (Outputs may finish before steps:
  `usePipelinePageLoad.ts:64-72` dispatches both together). On that run, if the restored draft's Output base has not been
  judged (`outputsBaseJudgedRef === false`), the effect first sets the ref to true and, when the kept `outputsBase` is present and
  differs from the loaded Outputs' signature (it compares against `keptOutputsBaseRef.current`, below), sets `staleRestoredRef.current = true` (synchronously) and
  `setStaleRestored(true)`; only after that does it reach the existing
  `staleRestoredRef.current` check, which then skips counting and pruning. A stale flip therefore keeps every Output op for
  "Reload the saved pipeline" to count; a non-stale judgement counts and prunes Output drops as the existing path does.
  The judgement is one-shot per restore (`outputsBaseJudgedRef` resets only when a new restore runs).
- **The kept `outputsBase` is never lost or overwritten before it is judged (skeptic round 5, CR-1).** Mirroring
  `keptBaseRef` exactly: the restore effect sets `keptOutputsBaseRef.current = kept.outputsBase ?? null` synchronously,
  next to `keptBaseRef`. The writer writes `outputsBase = keptOutputsBaseRef.current ?? (outputsStatus === "loaded" ?
  outputsSignature(baseOutputs) : <omitted>)`, the same shape as `keptBaseRef.current ?? baseSignature(...)`. The
  judgement compares against `keptOutputsBaseRef.current`. When the judgement finds it EQUAL (not stale), the ref is
  cleared, so later writes track the current base like `base` does for a non-stale draft; when it differs, the ref is
  kept (stale), exactly like `keptBaseRef`. `rebase` and `discard` clear it, as they clear `keptBaseRef`. Because the
  writer effect runs before the judgement in the same commit (`usePipelineDraft.ts:75` vs `:97`), this ordering is what
  keeps the original value on disk.
- **Failed Outputs list:** the draft's step part works as today; Output ops are kept and written to the kept draft
  unchanged (`outputsBase` written from `keptOutputsBaseRef`, else omitted, never from an empty or unloaded list); Save & run is refused while the overlay holds any Output op or edit and Outputs are not loaded (notice
  "Outputs could not be loaded; reload to save this draft"); a draft with no Output change saves as today.
- `rebase(newBase, newBaseOutputs)` takes the new base Outputs too.
Unit tests: (1) "a step edit made between steps-ready and outputs-ready survives, and a kept outputDelete/outputEdits
applies once Outputs load with droppedCount 0, not stale"; (2) "kept outputsBase differs from the loaded Outputs -> stale";
(3) "Outputs list failed -> Output ops kept, Save refused, a steps-only draft still saves; the sessionStorage entry still
holds the ORIGINAL kept outputsBase, and a reload with a successful fetch whose Outputs differ restores stale"; (4) "kept outputsBase differs
AND a kept outputDelete names a server-deleted Output -> stale, the op retained, droppedCount 0, and after Reload a count
of 1"; (5) "a Back with Redux still holding the previous list does not judge before this page's fetch completes";
(6) "a later fetchOutputs refetch does not re-judge"; (7) "Outputs load BEFORE steps-ready, the kept outputsBase
differs, no Output op drops -> stale, the sessionStorage entry still holds the ORIGINAL outputsBase after the restore, and
a second restore from it is stale"; (8) "same order, equal outputsBase -> not stale, judged once".

### D12. Backend: validate a draft Output edit against the stored config
In `DraftDiff.planOutputs`, the update branch validates `OutputService.validateConfig(kind, config, cur.config, policy)`
where `policy = RestorePriorStored` when `allowExplicitIds` (undo restoring a journaled definition, as patch-set rollback
does) else `ValidateWrite`; the create branch keeps `JsObject.empty` for a public request and uses `RestorePriorStored`
under restore (undo recreating a removed Output carrying legacy keys). Note: `validateConfig` judges the whole draft
config against the stored one (the client always sends the full merged config, D4, and never drops a stored key), while
`updateOutputs` writes it whole; and unlike `OutputService.update` under `RestorePriorStored`, the restore does NOT apply
`LegacyOutputFormat.normaliseRestored`: undo writes back exactly the journaled stored config (the undo contract, a
verbatim restore). Tests in `DraftDiffSpec` (pure, no DB), red on main first: (a) a draft that renames an Output whose
stored config has a legacy key (`metricLabel`) plans an update, not a 400; (b) a draft that ADDS a new unknown key to that
Output is still a 400 naming the key; (c) a restore that recreates a removed Output with a legacy key plans a create. A
DB-backed route test re-checks (a) through `POST /api/pipelines/:id/draft/save`.

### D13. e2e (fails first; owner constraint C2)
New `e2e/hel1733-draft-outputs-shapes.spec.ts`. Eight actions, each opened with a draft already open (a step config
edit), and EACH run in BOTH the desktop describe (1280px, `colorScheme: "light"`) and the phone describe (375px,
`colorScheme: "dark"`); plus one desktop-dark and one phone-light smoke (create on a saved step) so every action is
covered on both layouts and both themes appear on both. The red assertion each hits on main:

| # | action | desktop entry / phone entry | red on main |
|---|---|---|---|
| A1 | create Output on a saved step | step menu "Add output" / step sheet "Step actions" > "Add output" | item disabled, "Save or discard your draft first" |
| A2 | create Output on the root (source) | "+ Output" with no step / phone Outputs "+ Output" | button disabled with that title |
| A3 | create Output on a draft-new step (inserted in the draft) | step menu on the new step / step sheet | item disabled |
| A4 | edit an Output (rename + chart type) | Output card open / phone Output card | card button disabled |
| A5 | delete an Output bound to a panel | card open -> two-click Delete / same | card button disabled |
| A6 | delete an Output created in the draft | A1 then Delete / same | (depends on A1) red at A1's disabled control |
| A7 | shape (real `/expand`, steps only) | "Add Outputs from a shape" / header menu item | button / menu item disabled |
| A8 | aggregate tail | step menu "Add output" -> sheet footer "Add as tail with aggregate" / step sheet "Step actions" > "Add output" -> same footer | "Add output" item disabled |

Per action: the control is enabled; no write to `/api/outputs*`, `/api/pipelines/:id/outputs`, `/api/pipeline-steps*`
or `/api/pipelines/:id/steps*`, and no read naming a `draft-` id (D5a); the spine (or phone Outputs list) and the Live
Output column show the draft Output; Save & run sends exactly one `draft/save` whose body carries it (`clientId` /
`nodeStepClientId` / `rootId` as applicable); after reload the saved Outputs equal the pre-save draft. A5: the sheet shows
"Confirm delete (removes from 1 dashboard)", then the cascade dialog lists "Output: <name>" and "1 panel bound to those
Outputs", "Remove and save", and the panel is gone from its dashboard. A6: no cascade dialog. One Discard variant per
action (desktop) restores the saved pipeline with no request. Also (desktop): the draft-aware sheet on a draft-new filter
step lists the draft columns and shows draft rows with no request naming its draft id (one `analyze-proposal` read), and a draft cast to timestamp above it offers that column for a timeline time slot (D5 case a, real backend); the picker changed to a
draft-new step (D5 wiring); kept draft with a created Output (restore after Back); v2-format kept draft (seeded
sessionStorage) restores NOT stale; stale base with an Output edit; undo after saving an Output create + edit restores
the prior Outputs; one "(stubbed /expand)" shape test with an Output. Waits only on real readiness signals
(`aria-current`, a loaded card's count, the sheet's populated field picker), never skeleton-matchable selectors. The red
run against main's code is kept as evidence. `hel1631-draft-mode.spec.ts` and `hel1684-draft-structural.spec.ts`
blocked-set assertions are updated to: only add/remove source blocked. Dev-DB residue (users, pipelines, dashboards) is
removed by the harness's guarded cleanup by exact id.

### D14. Visual
New UI is copy and existing components only (card meta text, a footer hint, existing badges/tokens per DESIGN.md);
checked in the running app in light and dark on desktop and phone (constraint C12 of the driver brief).
## Risks / Trade-offs
- [Capabilities port drift] -> D7 shared fixture asserted by both suites.
- [Merge semantic drift (PATCH vs whole config)] -> D4 merge mirrors `mergeConfig`; covered by the same fixture.
- [Sheet wiring re-renders] -> the frames holder is written only while the sheet is open and on frames identity change.
- [Size: one PR] (owner ruling) -> if the design gate or the budget shows it is not feasible, escalate with evidence; never
  split unilaterally (C4).
- [A v3 kept draft opened by an older build] -> fails validation (unknown op kind), reads as absent; lost, never
  misapplied.

## Planner Notes
- Owner rulings (HEL-1733, chat, recorded via `concertino answer`): Q1 `inline-confirm-then-save-dialog`, Q2 `one-pr`.
- Self-approved, listed in the PR body: D3 (draft only while a draft exists), D5 fallbacks and footer hint, D10 card
  meta copy and post-save pick resolution, D12 restore policy, D8 single-update shape.
- No Flyway migration.
- Design gate: CONFIRM at round 6 (owner-granted extra round, `extend-design-gate`). Round-6 notes for the executor:
  pass the page-local `outputsStatus` (D15) to `buildDraftSaveRequest`'s `baseOutputs` gating too, so one source of
  truth decides "loaded"; the PR body states that a step-only kept draft now restores stale after a concurrent Output
  change (spec: "steps or Outputs"), costing one "Reload the saved pipeline" click.
