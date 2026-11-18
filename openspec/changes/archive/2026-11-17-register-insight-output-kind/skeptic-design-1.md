## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/{insight-output-kind,outputs-model}/spec.md against the
tree at 96ed5156bcbab59e32d2536186eef692ce00a5c3 (change dir untracked; no code changes yet).

### What I verified (with evidence)

- **Ticket AC.** Fetched HEL-1740 from Linear. The AC in ticket.md matches the live description. The live description
  has no `model` key, so leaving `model` out does not contradict any AC. I could not read the 23:30 driver comment
  (no comment tool here), so the claim that the comment exists is unverified, but nothing depends on it.
- **Migration number.** The highest migration on the tree is `V137__lock_pipelines_for_definition_writes.sql`, so
  V138 is free. The outputs kind CHECK is inline and auto-named at `V94__outputs_model.sql:211`. V108 is a precedent
  for widening a *panel* kind CHECK (`panels_kind_check`), and it is a valid pattern to follow.
- **OutputKind.** `model.scala:606-642` is a sealed trait with hand-written `fromString`/`asString`. The `fromString`
  error message also lists the valid values literally (`model.scala:637`).
- **Scala build flags.** Scala 2.13.15 is in use and `build.sbt` sets no `scalacOptions`. A non-exhaustive match is
  therefore only a warning, not an error. See note N1.
- **Output-kind enumeration sites.** I grepped for `"timeline"`/`'timeline'` and `markdown` across backend/main,
  frontend/src, schemas and helio-mcp/src.
  - Backend: KnownKeys `OutputConfigValidation.scala:22-29`, `OutputBindingSpec.All` (:111),
    `OutputPanelDefaultSize.Sizes` (`PanelPacker.scala:143-150`), `AssistantProposalToolSchemas.scala:292`.
  - JSON schema `enum`s, five files: outputs/{create-output-request,output},
    pipelines/{create-pipeline-transactional-output-request,draft-save-request,draft-save-response}.
    `node-capabilities-response` lists kinds in description prose only.
  - helio-mcp: four sites, all input schemas or types: `outputs.ts:55`, `pipelines.ts:152`,
    `pipelineProposal.ts:89`, `types.ts:1106`. None is a response parser, so leaving `insight` out of them breaks no
    read path. Deferring them to L8 as pinned exclusions is sound against the AC.
  - Frontend: `types/output.ts:14`, `nodeCapabilities.ts:42` plus the parity fixture, `OutputPanelContent.tsx`
    (an if/else chain), `LiveOutputRender.tsx:128`, `OutputPreviewPane.tsx:171`, the outputEditor files
    (`OutputEditorSheet.tsx:50` picker list, `OutputKindConfigCard`, `OutputKindFields`, `useOutputKindState`,
    `outputConfigTypes`, `OutputSheetPreviewCard`, `buildOutputConfig`, `configPatch`, `outputSheetDraft`) and
    `crossFilterRows.ts`.
  - `OutputPicker.tsx:32` and `mobilePanelHeights.ts:87` match the grep but use *panel* kinds, not Output kinds.
  - The design's "executor MUST re-enumerate" mandate covers the extra outputEditor files and the HEL-1733 draft files.
- **Every Output write path.** I traced every caller of `OutputRepository.insertInternal`/`insertInternalAction`/
  `updateOwned` and `PipelineDraftWrites.insertOutputs`/`updateOutputs`. There are six paths:
  1. `OutputService.create` :155 and `update` :229, which `PatchSetApplyForward:105,112` also reaches.
  2. `PipelineCreateTransaction:195`.
  3. `DraftSaveTransaction:159` via `DraftDiff:287-299`.
  4. `PatchSetApplyRollback:186` (`OutputConfigWritePolicy.RestorePriorStored`).
  5. `DraftRestore` (draft undo, `allowExplicitIds`, which maps to RestorePriorStored at `DraftDiff:287`).
  6. `PatchSetUndoService.restoreBoundOutputs:335`. This is a raw insert that deliberately skips
     `OutputConfigValidation` ("restoring stored state must never be refused").

  I found no raw-SQL Output writes and no pipeline-duplicate path.
- **Draft save ids.** New draft Outputs get server ids (`DraftDiff` `newId()`), so `reads.outputs` can only name
  surviving stored ids. Unchanged Outputs short-circuit before validation (`DraftDiff:297`).
- **Transactional create ids.** New Outputs have no client-visible ids, so an empty id set rejecting any
  `reads.outputs` is coherent.
- **Summary reducer.** `OutputSummaryReducer.summarize` (`domain/history/OutputSummaryReducer.scala:49-58`) already
  writes null `metric` unless the kind is Metric and null `series` unless it is Chart, so the design's claim is
  correct.
- **LegacyOutputConfigKeys.** It is not a per-kind map. It maps 14 legacy V117 keys to the kinds they belong to
  (`LegacyOutputConfigKeys.scala:23-44`), and `LegacyOutputConfigKeysParitySpec` runs V117's real SQL against it.
- **KeysDoc.** `OutputConfigValidation.KeysDoc` is built from `KnownKeys` (:39-50) and embedded in:
  - `AssistantProposalToolSchemas.scala:297` and `:461`
  - `RefinementEditShape.scala:268`

  `AssistantProposalToolSchemasSpec:273` and `RefinementEditShapeSpec:388` assert that every KnownKeys key appears in
  those docs.
- **Rows fetch.** Output-panel rows are fetched by `usePanelData` (`features/panels/hooks/usePanelData.ts`), which is
  called from PanelCardBody, PanelCard, MobilePanelStack, usePanelDetailData and pullRefreshRegistry. It fetches
  before the Output kind is known. No kind, markdown included, skips that fetch today. `OutputPanelContent` gets
  `rawRows` as props.
- **outputs-model spec delta.** The MODIFIED requirement header matches `openspec/specs/outputs-model/spec.md:18`
  exactly. The original's single scenario is kept.
- **No placeholders.** None of the change files contain TODO or TBD. The ranges are concrete: maxChars 80..1200
  (default 400), maxSentences 1..6, prompt up to 2000 characters, windows up to 4, reads up to 8.

### Verdict: REFUTE

The plan is close: the kind registration, migration, AC coverage and the L5/L8 exclusions are sound. But four
concrete defects would send the executor the wrong way or leave a write-path contract undefined.

### Change Requests

1. **D8 and task 1.6 wrongly treat `LegacyOutputConfigKeys` as a per-kind enumeration site.**
   - D8 requires "every Scala per-kind map (KnownKeys, binding specs, default sizes, legacy keys) has exactly the
     canonical key set". `LegacyOutputConfigKeys` is a legacy-key → kind map that mirrors V117. It never had every
     kind (Table appears only via `KeptOnKinds`; Markdown never appears), and its parity spec runs V117's SQL.
   - Remove it from the D8 total-map list and from task 1.6.
   - State that insight needs no legacy entry, because `normalise` is a no-op for a kind with no legacy keys.
   - Make D8 name the maps that are actually total: `KnownKeys`, `OutputPanelDefaultSize.Sizes` (a missing kind is a
     `NoSuchElementException` at `forKind`) and `OutputBindingSpec.All`.

2. **D4 is undefined on the restore paths and under the tolerance rule.**
   - D4 says the reads check "runs on EVERY write path that persists an insight config". Read literally, that
     includes three restore paths:
     - `PatchSetApplyRollback:186` (RestorePriorStored)
     - draft undo (`DraftRestore` → `DraftDiff:287`, RestorePriorStored)
     - `PatchSetUndoService.restoreBoundOutputs:335`, which is deliberately unvalidated

     All three must never be refused. An insight's reads legitimately dangle after any `DELETE /api/outputs/:id`,
     and D4 itself accepts dangling ids.
   - D3's claim that "the tolerance rule applies unchanged since no insight row predates this change" does not hold
     for `reads`. Dangling reads appear after this change.
   - As written, a `PATCH {prompt}` on an insight whose `reads.outputs` dangles is ambiguous. If the check judges the
     merged config, the PATCH is a 400 naming a key the caller never sent, and with no editor UI until L5 the user
     cannot fix it.
   - Revise D4 to say:
     - (a) The check is skipped under `RestorePriorStored` and on the raw undo restore.
     - (b) It judges `reads` only when the write introduces or changes `reads`, following the existing tolerance
       rule, and keeps `DraftDiff`'s unchanged-Output short-circuit.
   - List all six write paths above in D4.
   - Add tests to 3.2:
     - A PATCH of another key on a dangling-reads insight succeeds.
     - A patch-set rollback of an insight config edit is not refused.

3. **D6's claim that the proposal surface stays unchanged until L8 is false because of `KeysDoc`.**
   - Adding `KnownKeys(Insight)` automatically puts the insight keys (`preset`, `prompt`, `reads`, `refresh`,
     `maxSentences`, `maxChars`) into `KeysDoc`. `KeysDoc` is embedded in the assistant's proposal tool description
     (`AssistantProposalToolSchemas.scala:297`, `:461`) and in `RefinementEditShape.scala:268`.
   - The assistant would then be told about insight config while the kind enum it may use excludes `insight`.
   - Decide explicitly:
     - (a) Filter Insight out of `KeysDoc` until L8. This needs an exclusion in the drift table and edits to
       `AssistantProposalToolSchemasSpec:273` / `RefinementEditShapeSpec:388`, which assert every KnownKeys key
       appears in those docs.
     - (b) Accept the leak. Then document why, and say that a refinement edit on an existing insight goes through
       `OutputService.update` and is validated.
   - Record the choice in D6.

4. **D7 and task 3.6 ("fetches no rows" / "no rows request") cannot be met as scoped.**
   - Rows are fetched by `usePanelData` in five hosts before the Output kind is known, and markdown Outputs fetch
     rows today. `OutputPanelContent` only receives `rawRows`, so changing it alone cannot stop the request.
   - The ticket AC requires only a "not yet rendered" state and no model call.
   - Either drop the no-rows claim and test from D7 and 3.6, or name the fetch sites and how the kind reaches them
     (and in LiveOutputRender's column). Otherwise the executor either fails 3.6 or makes an unscoped refactor.

5. **Contract update gap in the schemas.**
   - Task 1.7 says "six" schemas. Only five carry a kind `enum`; node-capabilities-response has only description
     prose.
   - More importantly, the schemas' per-kind config documentation was not planned:
     - The "Known top-level `config` keys per kind" prose in create-output-request, update-output-request,
       create-pipeline-transactional-output-request and draft-save-request.
     - The per-key `properties` (each annotated "X kind only").
   - Plan adding the insight keys and their rules (ranges, `reads` shape, `fieldMapping` empty-only) to those
     schemas, since `schemas/` is the contract source of truth.
   - Fix the count to five enums plus the description prose in node-capabilities-response.

### Non-blocking notes

- **N1.** With no `scalacOptions`, D1's option "a match that would be non-exhaustive without Insight" is not a compile
  guard in this build. The real guard is the `OutputKind.all` round-trip spec plus the drift spec: dropping
  `case Insight` from `asString` surfaces as a MatchError when `all` is mapped. Say so in D1, and pin the literal
  valid-values list in `fromString`'s error message (`model.scala:637`) as a site too.
- **N2.** The spec does not cover `null` values. The existing convention clears a key with null (e.g.
  `compare: null`), but the insight spec does not say whether `prompt: null` or `reads: null` are accepted.
- **N3.** `reads.outputs: []` (read nothing?) versus absent (same-node default) is not defined. L4 will have to guess.
  Define it now or note it explicitly as owned by L4.
- **N4.** Nothing in the plan forbids an insight from reading another insight. L4 needs a cycle or self-reference
  rule; consider deciding it here or noting it.
- **N5.** HEL-1733, merged just before this plan, added draft-side Output kind handling (`draftSaveRequest.ts`,
  `useDraftNodeCapabilities.ts`, `analyzeProposalService.ts`, `draftNodeSchema.ts`). The design's re-enumeration
  mandate covers them, but sites.md should list them.
- **N6.** For the migration drift check, prefer reading the live constraint (`pg_get_constraintdef` on the test DB)
  over parsing "the latest migration". If the migration parse is kept, it must fail when V138's syntax (ALTER ... ADD
  CONSTRAINT) is not matched, rather than silently falling back to V94.
