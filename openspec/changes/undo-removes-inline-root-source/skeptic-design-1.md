## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: the change dir (ticket.md, proposal.md, design.md, tasks.md, specs/patch-set-undo/spec.md) against worktree HEAD
02dc11abdc28577c8071a61d1e7295eacbdfee1c (= origin/main; the change dir is still untracked). Owner rulings (answer.json:
Q1=B, Q2=keep-source-legacy, Q3=wire-field-and-toast) are taken as given and not re-litigated.

### What I verified (with evidence)

1. **spray-json Option read/write (orchestrator point 1): CONFIRMED.** spray-json is 1.3.6 (coursier sources jar).
   `ProductFormats.scala:54-56` reads a field as `None` when the reader `isInstanceOf[OptionFormat[_]]` and the
   field is absent. `:46` omits the field on write when the writer is an `OptionFormat` and the value is `None`. A
   journal row or outcome with `inlineSources = None` therefore serializes byte-identically to today, with fields in
   declaration order and the new one last. `NullOptions` is mixed in nowhere in `backend/src` (it appears only in
   comments that say it is deliberately absent). `PatchSetApplicationRepository` (:85) and `PatchSetUndoProtocol` both
   extend `DefaultJsonProtocol` only.
2. **Position pairing (point 2): reliable, same as rollback.** `PatchSetApplyForward.scala:86-88` journals
   `resultingState` = the `PipelineSummaryResponse` returned by `pipelineService.create`. `PipelineCreateWrites.createRootSources`
   (:173-187) resolves roots sequentially in request order. `PipelineRepository` writes `position = index`
   (:348, :422), and summaries are position-sorted (:117/:153/:170, doc on `PipelineRootSummaryResponse`). Equal counts
   cannot coexist with a dedupe or reorder. The design's `None` on a count mismatch falls back conservatively to
   legacy behaviour, which satisfies C3.
3. **Reference coverage of `DataSourceService.delete` (point 3).** `delete` (DataSourceService.scala:649-660) 409s
   on `findReferences`. That runs on the privileged pool and covers pipeline roots, join/lookup/union secondaries,
   upsert targets and form panels, with hidden referencers counted (DataSourceReferenceRepository.scala:45-95).
   I found no source-level sharing: `ResourceType` is Dashboard|Panel only (model.scala:113-116). Other FKs to
   `data_sources` are `dataset_rows` (CASCADE, V106), legacy `pipelines.source_data_source_id` and `data_types.source_id`;
   none is a "reference" in the product sense. The inline kinds are sql, rest_api and **static → Dataset**
   (PipelineCreateWrites.scala:126-134; csv is rejected). One consequence follows: rows appended to an inline
   *dataset* source after the apply (via API/PAT, with no form panel bound) are cascade-deleted on undo. That is exactly the
   option-C concern the owner declined, so it is accepted, but it belongs in Risks (see notes).
4. **Kept status honesty (point 4).** `status: "restored"` means "the created resource was deleted"
   (PatchSetUndoProtocol doc; schema description), and the pipeline was deleted, so keeping it is defensible
   *provided* the per-source report is truthful. The design is not yet tight enough to guarantee that (CR1).
5. **Frontend invalidation claim (point 5): NOT grounded as written.** D5 says "Reuse the slice's existing
   post-undo cache-invalidation mechanism; do not add a new one". The only mechanism is `invalidateAffectedState`
   (frontend/src/features/patchSets/state/patchSetsSlice.ts:162, called from `undoPatchSet` at :265). It handles
   `panel`/`dashboard` only, and its header comment (:75-81) states that `dataSource`/`pipeline` invalidation is left
   as a follow-on. Nothing in the patch-set feature touches `sourcesSlice` today. Refreshing sources necessarily adds a
   new branch, e.g. `dispatch(fetchSources())` (sourcesSlice.ts:63, no `condition` guard, so a re-dispatch always
   refetches). See CR2.
6. **Kept-reason leakage (point 6): OK.** `referenceConflict` (DataSourceService.scala:~703-718) builds `reason` from
   `SourceReferences.describe`, which names only visible referencers and counts hidden ones. The race path passes an
   identity-free hidden count. The source's own id/name belong to the caller. D4's fixed sentence for generic
   failures excludes exception text. The design is sound here, provided CR1 does not reintroduce `e.err.message` of a
   non-conflict error (today's `deleteCallCreated` logs that message, which is fine in logs but not on the wire).
7. **Undo walk order.** `PatchSetUndoService` reverse-walks (`restoreAll`, :67-100) and stops on the first failure
   (`notAttempted`). Later edits in the same patch set that might reference the inline source (step creates on the
   new pipeline) are undone before the pipeline-create arm runs. The arm is at :118 as cited. `restoreCreateUndo` is
   at :143.
8. **Schema/types:** `schemas/patch-sets/patch-set-undo-response.schema.json` has `additionalProperties: false` on
   `EditUndoOutcome`. An un-updated schema would therefore reject the new field, and task 2.4 plus test 4.7 correctly
   cover it. The frontend (patchSet.ts:97) and helio-mcp (types.ts:1227) types exist as cited. No OpenAPI file
   carries `EditUndoOutcome`.
9. **Coverage:** every ticket AC is covered. The decision is recorded (answer.json), the implementation has red-first
   tests (C1, 4.9), and prod orphans are a non-goal (HEL-1495). No placeholders or TODOs.

### Verdict: REFUTE

These three revisions are narrow and should take one round. The core design (D1 journaling, D2 classified delete, D3
undo arm, legacy fallback) is sound.

### Change Requests

1. **Pin the wire and toast mapping for every `InlineSourceDeleteResult` so a failure is never shown as "still in use"
   (design.md D2/D4/D5).** D2 has four results (`Removed`, `KeptReferenced`, `AlreadyGone`, `Failed`), but D4's wire
   enum has three (`removed|kept|alreadyGone`). The `Failed` mapping and the null-cleanup case are only implied
   ("a generic failure gives a fixed sentence"). D5's example toast line `Kept data source "X": still in use.`
   can be read as hardcoded copy. Under that reading, a `Failed` or no-cleanup-wired source is told to the user as
   "still in use", which is false. Make three things explicit:
   - (a) `Failed` maps to `result: "kept"`, and the null-cleanup case does too, each with a named fixed `reason`
     sentence quoted in the design (e.g. "It could not be removed; delete it from Data sources.").
   - (b) The toast line renders the outcome's `reason`, or uses distinct copy for referenced vs could-not-remove.
     It never uses a single hardcoded "still in use".
   - (c) Name the fallback label when `name` is `None`.

   Add a test row to 4.6/4.8 for the `Failed` → `kept` + fixed-reason path, and assert that no exception text
   appears.
2. **Replace D5's "reuse the existing invalidation, do not add a new one" with the real mechanism.** As written,
   the instruction contradicts the code: `invalidateAffectedState` (patchSetsSlice.ts:162) has no data-source path, and
   its own comment (:75-81) defers that path. State concretely that the executor should extend `invalidateAffectedState`
   (or the `undoPatchSet` thunk at :256-266) to `dispatch(fetchSources())` (sourcesSlice.ts:63) when any outcome's
   `inlineSources` contains `removed`. Then update task 3.2 and the 4.8 jest assertion to that exact dispatch. Otherwise an
   implementer following "do not add a new one" literally has no compliant way to refresh the list.
3. **Pin the wire shape when the journal has `Some(Vector.empty)` (a new-format pipeline create with only `sourceId`
   roots).** D1 journals `Some(empty)`, but D4 only says the field is "omitted when `None`". It does not say whether the
   outcome is then `inlineSources: []` or omitted. The spec scenario "A pre-existing root source is never deleted ...
   not listed in the outcome" holds under both readings, so neither the test (4.3/4.7) nor the schema (`minItems`?)
   pins it. Choose one (recommendation: omit when the journaled vector is empty, so the field's presence always means
   "inline sources were involved"). Then state the choice in D4, the spec scenario and test 4.7.

### Non-blocking notes

- Declare `implicit val journaledInlineSourceFormat` **before** `journaledEditFormat` in
  `object PatchSetApplicationRepository`. Otherwise a forward reference initializes it as `null`, and the NPE appears
  only at runtime. The same applies to `InlineSourceUndoOutcome`'s format in `PatchSetUndoProtocol`.
- Add the dataset-rows consequence (point 3 above) to Risks: an inline static root is a Dataset, and rows written to
  it after the apply with nothing bound are removed on undo. The owner chose B over C, so this needs documenting, not
  changing.
- `Failed` can be reported when the source row was in fact deleted, e.g. a throw after `dataSourceRepo.delete`
  commits. That error is in the conservative direction (the source is reported kept but is gone) and is acceptable,
  but the classifier test should not assert the opposite.
- A Connector-delete failure after `Removed` is log-only (D2). That is consistent with HEL-1475. The connectors slice
  is also not refreshed on undo, which is acceptable since the connector list is not part of the ticket.
- Toast copy with several kept sources: check that the shared Toast renders multi-line messages acceptably, or join the
  lines into one sentence. Follow DESIGN.md's toast pattern, and consider a non-success variant when anything was kept.
- helio-mcp: types-only is enough for the AC. If the MCP undo tool formats outcome text for the agent, surfacing kept
  sources there would be consistent with Q3, but it is optional.
