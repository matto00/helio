## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD cfb6041bf2443e6796dd28a677b89bf19a5135c1. The planning artifacts are untracked in the change dir. I judged
the current ticket.md, proposal.md, design.md, specs/pipeline-draft-mode-ui/spec.md and tasks.md against the live code.

### What I verified (with evidence)
- **D1 `showsDraftGrid` matches the grid's real render path.** In `StepPreviewTable.tsx`, the body branches are
  `!step.enabled` (:195), then `isCreating || isDraft` (:197), then `draftActive` (:199). Inside the last branch the grid
  renders only when `draftFrame !== null && view?.status !== "notPreviewed"` (:219). D1's boolean is exactly that
  conjunction. The grid and the chips both read it, which removes the drift that round 1 found.
  - A step the draft created (`isDraftClientId`, but not `isTempStepId`) still reaches the grid branch, and D1 does not
    exclude it either, so the two stay consistent.
  - A draft-disabled step has a non-null frame (`draftStepView.ts:98-101`). `step.enabled` excludes it, and a D5 test plus a
    D5 mutation cover that case.
- **D1 reuses the HEL-1732 names expression, not a new one.** It reuses `orderColumns(frameSchema(draftFrame),
  draft.columnOrder ?? [])` (:164). `draftColumns` becomes a map over `draftFields`. One list feeds both the grid and the
  chips.
- **D2 is now one ordered rule, and it names the right sources.**
  - Rule 1 decodes the renames with `handlerFor("rename").decode`, which folds in `scalaMapKeyOrder` order
    (`rowOps.ts:27-34`). This is the same source `draftColumnOrder.ts:49-57` uses, and it is explicitly NOT the
    insertion-order `stepNarrowing.renamesOf`.
  - Origin tracking goes through a new exported `renameOrigins` built on `foldRenames` (`rowOps.ts:58-76`). That function
    already carries `origin` and applies the collision rule (the survivor takes the `from` value), so the helper and the
    evaluator cannot diverge.
  - Rule 1 coming before rule 2 is correct for a rename onto an existing name: the saved type under that name belongs to the
    overwritten column.
- **D2 rule 3 is request-free and already on the draft path.** `schemaFromFrame` (`draftEvaluation.ts:144-164`) is memoized
  per frame in a WeakMap and is used by `usePipelineDraftFrames.inputSchemaOf` (:234-244). Every draft column now gets a
  type, so the round-1 descendant gap (rename, then filter) is closed. The spec states this, and D5 adds a test for it.
- **D3/D4: no prop widening and no request.** `OutputSchemaDisclosure` already takes `SchemaField[]`. All inputs (`draft.view`,
  `draft.columnOrder`, `analyzeSchema`, `analyzeOutputSchema`, `step.config`) are existing props, and no hook, effect or
  service is added. The jest tests assert no `httpClient` call, and the e2e guards are named in task 3.2.
- **AC coverage.**
  - AC1 (a red test on main): D5's rename test, with the red run committed (task 1.1).
  - AC2 (the same order and types as the grid): one shared list, plus the large-schema test.
  - AC3 (no request): D4 and task 3.2.
  - No scope drift. The server NDJSON order stays a non-goal, as the ticket directs.
  - No contract change is needed (frontend only).
- **No open product question.** Keeping the saved chips when no draft grid is shown is the only judgment call, and it
  preserves today's behavior where there is nothing to match. It is stated in the spec, so it needs no escalation.
- **Each round-1 change request is resolved in the artifacts.**
  - CR1: `showsDraftGrid`, the disabled-step test and its mutation.
  - CR2(a/b/c): the ordered rule, the decode source, and `renameOrigins`, with the insertion-vs-fold-order unit test in
    task 2.1.
  - CR3: rule 3, a spec sentence and a descendant test.

### Verdict: CONFIRM

### Non-blocking notes
- **Name the input of `renameOrigins`.** Rule 1 should fold over the saved INPUT names (`analyzeSchema.map(f => f.name)`),
  not the ordered output `names`. `foldRenames` maps input to output, not the reverse. The design implies this but does not
  say it.
- **Header render guard.** Today the chips render only when `analyzeOutputSchema.length > 0` (:286). Under `showsDraftGrid`
  the guard and the threshold check must use the displayed list's length. Otherwise a draft-created step with no saved
  analyze shows a grid but no chips, and the threshold counts the wrong list.
- **The disabled-step test needs a step whose saved output differs from its input**, for example a disabled rename step.
  Otherwise the pass-through columns equal the saved output, and the "gated on `draftActive` alone" mutation stays green.
- **Rule 3 type vocabulary.** It infers only `string`/`integer`/`float`/`boolean`. Saved analyze can report other types
  (`types/draftPreview.ts:58` lists `double`; `nodeCapabilities.ts:53` normalizes `number`/`double` and handles
  `timestamp`). A descendant's renamed date column will therefore caption as `string`. This is better than no caption, but
  it should be disclosed with the Risks entry on saved types.
- **Memoization.** Memoize `draftFields` separately from `flash.changed`, so a flash update does not rebuild the chip list.
