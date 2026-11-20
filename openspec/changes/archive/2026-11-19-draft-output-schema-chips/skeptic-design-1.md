## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD cfb6041bf2443e6796dd28a677b89bf19a5135c1 (planning artifacts untracked in the change dir).

### What I verified (with evidence)
- **The grid's draft column source is reused, not re-derived (D1): sound.** `StepPreviewTable.tsx:159-172` derives the grid's
  names as `orderColumns(frameSchema(draftFrame), draft?.columnOrder ?? [])`. `draft.columnOrder` comes from
  `frames.columnOrderOf(stepId)` (`hooks/usePipelineDraftPresentation.ts` `previewDraftFor`), which is HEL-1732's
  `createColumnOrderResolver`. D1 makes the chips and the grid read one `draftFields` list built from that expression. That
  removes the two-derivation bug class.
- **No request (D4): sound.** Every input is already a prop of `StepPreviewTable` (`draft.view.rows`, `draft.columnOrder`,
  `analyzeSchema`, `analyzeOutputSchema`, `step.config`). A pure helper adds no hook, effect or service. The draft-mode guard
  e2e specs are named in task 3.2.
- **Chips render names only.** The inline chips at `StepPreviewTable.tsx:286-297` render `{field.name}`, and
  `OutputSchemaDisclosure` takes `SchemaField[]` (`ui/OutputSchemaDisclosure.tsx:38-44`). So "types" in the AC means the
  shared list's types agree with the grid's header captions, and D2 is in effect the fix for the grid's missing caption. That
  reading is consistent with the ticket.
- **Keeping the saved chips when no draft frame is shown: acceptable, no escalation needed.** It keeps today's behavior where
  the ticket's "match the grid" has nothing to match (status `notPreviewed`, or pending with no frame), and the spec scenario
  states it. A product question the ticket leaves open is not being decided here.
- **`analyzeSchema` is the saved INPUT schema.** `PipelineSpineLayout.tsx:286` passes `page.getAnalyzeSchema(id)`, which is
  the input-side lookup (`usePipelineAnalyzeLookups.ts:134`, with the output mirror at :144). D2's "saved input type of
  `from`" is grounded.
- **The rename fold semantics I checked against D2(b):** `evaluator/steps/rowOps.ts:20-76`. The handler decodes `renames`
  into `[from, to]` pairs in Scala fold order (`scalaMapKeyOrder`). `foldRenames`, which is not exported, keeps each
  surviving column's `origin`. On a collision the survivor carries the `from` column's value. So "type of the `from`" is the
  right rule for a collision, and a chain must resolve to the original origin.
- **The disabled-step view:** `state/draftStepView.ts:98-101` maps node status `disabled` to `{status: "ok", rows: node.rows}`.
  A disabled step's view therefore has a non-null draft frame.
- **A request-free source of draft types exists:** `state/draftEvaluation.ts:144-164` `schemaFromFrame(rows, known)` uses the
  known type by name and otherwise infers integer, float, boolean or string from the frame. It is already used on the draft
  path: `usePipelineDraftFrames.inputSchemaOf` (line 234) feeds the step editor through `inputSchemaFor`.

### Verdict: REFUTE

### Change Requests
1. **The chip condition does not match the grid's render condition, but D1 says it does (design.md D1; spec "No draft frame
   shown").** D1 gives the condition as `draftActive && draftFrame !== null && view.status !== "notPreviewed"` and calls it
   "exactly the condition the draft grid renders under". It is not. The draft grid is rendered only inside the
   `else if (draftActive)` branch (`StepPreviewTable.tsx:197-235`), which comes after `!step.enabled` (:195) and
   `isCreating || isDraft` (:197). A step the draft has turned off has a non-null draft frame (`draftStepView.ts:98-101`, the
   `disabled` node maps to `ok` with rows). Under D1's literal expression the chips for that step switch to the draft
   pass-through columns while the body shows only "This step is off…". That violates the spec's own requirement: "When no
   draft frame is shown … the chips SHALL show the saved analyzed output schema."
   Required revision:
   - State the chip condition as the grid's real condition: `step.enabled && !isCreating && !isDraft && draftActive &&
     draftFrame !== null && view?.status !== "notPreviewed"`. A better option is to compute one boolean, e.g.
     `showsDraftGrid`, that both the grid branch and the chips read, so the two cannot drift.
   - Add a D5/task 1.1 test: a draft that disables the shown step keeps the saved chips.
2. **D2 can be read two ways and points at the wrong helper.**
   - (a) The rule is listed as "(a) saved output type by name; else (b) …", and the next sentence then says a renamed name
     "takes rule (b) first". Restate it as one ordered rule: (1) the name is a target of the shown step's draft rename, so
     use the type of its origin column; (2) the saved output type by name; (3) the fallback (see CR 3).
   - (b) "reuse `renamesOf` … helpers": the `renamesOf` that `StepPreviewTable` imports is `state/stepNarrowing.ts:499`. It
     returns a raw `Record<string,string>` in object-insertion order. The evaluator folds in `scalaMapKeyOrder` order through
     `renameHandler.decode` (`rowOps.ts:27-34`), and for a chain or collision the two orders give different results. Name
     the source explicitly: `handlerFor("rename").decode(step.config).renames` (as `draftColumnOrder.ts:50-58` does).
   - (c) Say how the origin is tracked. `renameKeyOrder` drops `origin`, and `foldRenames` is not exported. Either export a
     fold that returns origins, or fold `{name, origin}` entries over the saved input names in the helper with the same
     collision rules.
   - Make the unit tests in task 2.1 cover a chain whose object-insertion order differs from its Scala fold order.
3. **The justification for leaving descendants of a renamed step untyped is factually wrong (D2 last sentence, Planner
   Notes).** The design says "no request-free source of draft types exists" for a descendant. `schemaFromFrame`
   (`state/draftEvaluation.ts:144`) is request-free, typed and memoized per frame, and the draft path already uses it
   (`usePipelineDraftFrames.inputSchemaOf`).
   The ticket's symptom, "A renamed column also has no type caption", appears just as clearly on the step after a rename
   (rename, then filter: the filter step's grid shows `zone` with no caption). Under D2 that step stays uncaptioned.
   Required revision: either
   - (preferred) use `schemaFromFrame(draftFrame, …)`'s inferred type as the final fallback after rules (1) and (2), so
     every draft column has a type and chips and grid still agree by construction; or
   - keep (c) "no type", replace the false claim with the real reason for not using frame inference, and disclose the
     limit accurately.
   In both cases, add a test or state the descendant behavior explicitly in the spec's requirement text.

### Non-blocking notes
- Rule (b) with a saved-input lookup returns no type when the draft changed an ancestor so that `from` is new. Using the
  draft input schema (`frames.inputSchemaOf`, already computed for the editor) would be stronger, but it needs a new prop.
  The executor can decide; the CR 3 fallback covers the gap anyway.
- A draft cast on the shown step leaves the grid caption showing the saved type (an existing limit, and chips and grid
  still agree). The Risks section covers this only for ancestors; mention the shown step's own cast as well.
- D3: prefer widening `OutputSchemaDisclosure`'s prop to `{name; type?}` only if CR 3 leaves untyped fields possible.
  Otherwise no change is needed.
