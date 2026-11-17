## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD e0443c24d0c02b41cdda105a410cea0b6bdf2b33 (branch feature/draft-outputs-and-shapes/HEL-1733). The change dir is
untracked, and every claim below was checked against the live source. Owner rulings Q1 (`inline-confirm-then-save-dialog`)
and Q2 (`one-pr`) are fixed. I do not judge one PR infeasible: every defect below is a specification defect, not a size
defect.

### Round-2 change requests, re-verified against code

- **CR-A (D15): the window is closed, but the deferred stale flip adds a new defect (CR-3 below).** The restore stays at
  steps-ready (`usePipelineDraft.ts:59-74`, unchanged firing condition), so a step edit made before Outputs load can no
  longer be overwritten. The failed-list behavior is now defined: Output ops are kept, the writer uses the kept
  `outputsBase`, Save is refused only when the overlay holds Output changes, and a steps-only draft still saves.
  `listStatus` "failed" exists (`outputsSlice.ts:292`).
- **CR-B (D3): answered.** I grepped every consumer of `structuralBlockedReason`, `draftBlockReason` and `blockedReason` and
  found nothing that changes behavior and is missing from the table:
  - `PipelineSpine.tsx:155-156, 166-167, 234-235, 256`
  - `SpineOutputs.tsx:53, 96`
  - `useSpineStepActions.tsx:76-77, 179-180, 183`
  - `StepCardFocused.tsx:100-101`
  - `MobilePipelineHeader.tsx:46-47, 52-53`
  - pass-throughs: `PipelineSpineLayout.tsx:77, 224, 266`, `PipelineMobileLayout.tsx:69, 209`, `MobileStepSheet.tsx:97`

  Two pass-through sites are not listed: `usePipelineDraftPresentation.ts:117` and the `stepCardTypes.ts:36` type. Neither
  changes behavior. The temp-step guards stay (Branch, Duplicate), and they now also cover "Add output", the picker and the
  aggregate tail. `attachLane` (`draftOps.ts:152-154`) already refuses a temp parent.
- **CR-C (D5): partly answered, and it introduces a new typing defect (CR-1 below).** The transport schema is dropped
  explicitly: `useDraftPreviewTransport.ts:52` keeps only the count, as stated. A root now uses
  `analyzeResult.sourceSchemas`, and `sourceSchemaForRoot` exists at `usePipelineAnalyzeLookups.ts:81-91`. The spec was
  not updated to match (CR-2 below).
- **CR-D (D1): answered.** With a single root the target is `roots[0].id`. With several roots the "Pipeline source" option
  (`OutputEditorSheet.tsx:252-254`) is disabled in a draft, and Save is blocked until a step is picked. The spec has a
  matching scenario. This agrees with the immediate path's 400 (`OutputRootResolution.scala:25-35`, verified in round 2).
- **Non-blocking notes from round 2:**
  - `baseOutputsRef` in every updater: folded into D1.
  - `keptOutputsBaseRef` and `rebase(newBase, newBaseOutputs)`: folded into D15.
  - `useDisplayedOutputNodeIds` reading `draftOutputs`: folded into D10.
  - A8 wording: folded into D13.

### Other checks (with evidence)

- **D8 aggregate tail as a lane op.** The immediate path calls `createPipelineStep(..., parentStepId, true)`
  (`usePipelineStepStructure.ts:110-117`), which is `attachAsTail`. The draft `attachLane` is documented as
  `attachTailInternalAction` (`draftOps.ts:151`). They are equivalent.
- **D12** is unchanged since round 2, which verified it. `planOutputs` still passes `JsObject.empty`
  (`DraftDiff.scala:295-296`).
- **D10.** `usePipelineDraftPresentation.ts:30` (`needBase: page.allOutputs.length > 0`) can stay on the saved list,
  because `walkBase = hasDraft || needBase` (`usePipelineDraftFrames.ts:106`) and draft Outputs exist only in a draft.

### Verdict: REFUTE

### Change Requests

1. **CR-1 (D5): `known` gives the wrong types for any node whose own config, or an ancestor's, the draft changed. The
   server does not catch the result.**
   - D5 types every node with `schemaFromFrame(rows, known)`. For a SAVED node, `known` is that node's saved analyze
     output schema. For a draft-NEW node, it is the union of the saved schemas of its nearest saved ancestor and the root,
     matched by name.
   - The frame cannot correct a type. `schemaFromFrame` (`draftEvaluation.ts:144-165`) infers only
     string/integer/float/boolean, and a `known` type wins for any name it lists.
   - The client cast evaluator returns a timestamp as a string: `castTimestamp` returns `text` or `formatInstant(...)`
     (`evaluator/steps/cast.ts:40-45`).

   So:
   - (a) A draft that inserts a cast `date -> timestamp` (or edits a saved cast to add it) types `date` as `string`, from
     the ancestor's saved schema or from inference. A timeline's time slot is not offered, although the server offers it
     for the same pipeline once saved.
   - (b) A draft that edits a SAVED cast to remove `date -> timestamp` keeps `timestamp` from the saved schema. The sheet
     then offers `date` as Orderable when it is now a string.
   - (c) A saved, unedited step below a draft-edited cast inherits (b) through its own saved schema.
   - The same applies to a draft rename (a renamed timestamp falls back to the inferred `string`), and to compute's
     declared `type` and datebucket.

   This is not cosmetic. The server never checks column types on an Output write: `OutputConfigValidation.scala:176-181`
   says type eligibility "is a capabilities-time concern ... not a create/update-time one". The draft sheet's port is
   therefore the only guard. Case (b) saves an Output whose binding the immediate path would have refused. Case (a)
   blocks a binding the immediate path allows, and that is the main shape-building workflow (cast, then a timeline).

   Required:
   - Define `known` by draft-change status, not by saved-versus-new. Use a node's saved schema only when neither it nor
     any ancestor is changed by the draft (config edit, enabled toggle, insert, delete, reorder above it). Otherwise,
     start from the nearest unchanged ancestor's saved schema, or the root's `sourceSchemas`, and apply config-declared
     types along the draft path. At minimum that means cast (`castsOf`, `stepNarrowing.ts:503`), rename (`renamesOf`,
     carrying the type to the new name), compute's declared `type`, and datebucket's output.
   - Alternatively, state a different rule that is equally exact, for example plumbing the transport schema where the
     transport evaluated the node, plus the rule above for client-evaluated nodes.
   - If any type-changing op is left out, state it as a known limitation in the design and the spec. Do not leave it
     implied by "the server's where the server knows them".
   - Add jest cases for (a), (b) and (c), and one for a rename.

2. **CR-2 (spec vs D5): the spec still promises the transport's types.** `specs/pipeline-draft-mode-ui/spec.md`,
   "Draft-aware Output editor", says "the column types SHALL be the server's where the server knows them (the saved
   pipeline's schema, or the draft-preview transport's)". D5 says "the transport's step-line `schema` is NOT used".
   Reconcile the spec text with whatever rule CR-1 settles. The spec is what the evaluator will hold the code to.

3. **CR-3 (D15): the deferred stale flip races the existing drop/prune effect, and "counted and pruned as usual"
   contradicts the stale path.**
   - In the first render with `outputsStatus === "loaded"`, the replay memo starts applying Output ops, so `droppedNow`
     can become > 0. For example, a kept `outputDelete` or `outputEdits` entry names an Output deleted on the server
     meanwhile. That is exactly the case where `outputsBase` also differs.
   - In that same commit, the existing drop effect (`usePipelineDraft.ts:97-102`) checks `staleRestoredRef.current`. If it
     runs before the new "when Outputs load" compare effect, which it does when the new effect is appended later, it counts
     the drop and prunes with `keepOps` false. Then the stale flag flips.
   - The result: the draft is silently re-based on its Output part, the "Reload the saved pipeline" count is wrong, and
     the property in the comment at `usePipelineDraft.ts:50-54` ("It is never re-based silently") is broken.
   - D15's last bullet says "Then the full replay runs and its Output drops are counted and pruned as usual". For a draft
     that just turned stale, the usual behavior is to skip counting and pruning (`:98`). The design text says the
     opposite.

   Required:
   - Specify that the Output-base compare is decided before any Output-op drop is counted. Either the drop effect itself
     performs the compare (or is gated on a "compared" ref), or the compare effect is declared before the drop effect and
     sets `staleRestoredRef` synchronously.
   - Make the compare one-shot per restore, so a later `fetchOutputs` refetch (for example
     `usePipelineStepStructure.ts:132`) never re-judges it.
   - On a stale flip, keep the Output ops for Reload to count.
   - Add a unit test: the kept `outputsBase` differs AND a kept `outputDelete` names a server-deleted Output. Expect
     stale, the op retained, `droppedCount` 0, and after Reload a count of 1.

4. **CR-4 (tasks vs D15): task 4.2 says the opposite of D15.** `tasks.md` 4.2 says "restore/stale/prune wait for
   `outputsLoaded`; unit test 'restore with Outputs not yet loaded loses nothing'". D15 says "Restore stays at steps-ready
   (unchanged effect, unchanged firing condition)", and names three different tests.
   - The executor works from tasks.md. As written, 4.2 re-introduces round 2's CR-A window.
   - Rewrite 4.2 to D15: the restore stays at steps-ready, the Output part waits, the compare is ordered per CR-3, and the
     failed-list behavior is as specified. List D15's three tests plus CR-3's test.

### Non-blocking notes

- **D15/D3: scope the loading gate to a draft.** "The routed Output actions, the shape action and the aggregate tail are
  disabled with 'Outputs are still loading'" should apply only while `hasDraft`. With no draft, "+ Output" and the shape
  button are enabled while the list loads today, and changing that is a stated non-goal.
- **D3 shape-button row is circular.** It says "disabled when the computed anchor is a temp step (the anchor helper skips
  temp ids ...)". Reword it as "anchor = last non-temp step of root 0's trunk over `draftSteps`; disabled only when root
  0's trunk has steps and all are temp". With no steps at all, it appends to `roots[0]`.
- **D3 table: add the two missing pass-through sites.** Add `usePipelineDraftPresentation.ts:117` for completeness.
- **D15: say what `draftOutputs` is while the list is "loading" after a Back.** Redux still holds the previous visit's
  list (`listStatus` stays "succeeded" until the refetch's `pending`), so the D15 loaded/compare logic must key off this
  page's own fetch, not the first "succeeded" it observes.

Verdict category: spec-divergence.
