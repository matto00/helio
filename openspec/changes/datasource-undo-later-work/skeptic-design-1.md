## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD ebfeb6af76fdb594e072e46458d660c423a1db63 (planning artifacts untracked in the change dir).
Owner rulings (rows appended, apply-era row edits, schema edits refuse; deletes do not block; HEL-1720 naming rule) are
taken as given and not re-opened.

### What I verified (with evidence)

- **Phase 2 really does a partial undo today: CONFIRMED.** `PatchSetUndoService.undo` runs `checkAll`, then
  `restoreAll` walks `edits.reverse` (PatchSetUndoService.scala:109). The `("dataSource","create")` arm (:126) calls
  `DataSourceService.delete`, which refuses on `findReferences` non-empty (DataSourceService.scala:643-645). Every
  edit with a higher index has been restored before that refusal, so the result is 200 with outcome `failed` and the
  rest `notAttempted`. Phase 1's `checkDataSource` (PatchSetUndoConflictCheck.scala:176-187) compares only the name.
- **Cascade loss: CONFIRMED.** V106: `dataset_rows.data_source_id ... REFERENCES data_sources(id) ON DELETE CASCADE`.
- **A same-set reference to the created source cannot exist: design D6 and two spec scenarios rely on one.**
  - Every edit is resolved before any edit is applied (PatchSetApplyService.scala:90-95 resolve, then `applyResolved`).
  - The source id is a server-generated UUID made inside `createStatic` (DataSourceService.scala:178,
    `DataSourceId(UUID.randomUUID()...)`). `StaticDataSourceRequest` has no id field.
  - Resolving a pipeline create root calls `findByIdOwned(sourceId)` and returns 404 when the source is missing
    (PatchSetPipelineResolvers.scala:120-124). Step creates check "secondary ownership"
    (PatchSetPipelineStepResolvers.scala:20,137). Form panel creates run `FormBindingValidator.rejectForCreate`
    (PatchSetPanelResolvers.scala:175).
  - `PatchSetRefs` (`$ref:`) only names earlier `output` creates (PatchSetRefs.scala:6-10, 44-51, 67-79). There is
    no ref for a source.
  - So no pipeline, step or form panel in the same set can reference the source that set creates. The same-set
    excusal is dead code, and the step-granularity question is moot.
- **Wiring trap in `checkAll`.** `guarded` returns `own` early unless `PatchSetUndoBoundPanels.guards(edit)`
  (PatchSetUndoConflictCheck.scala:56-57), and that set is `output/pipelineStep/pipeline/dashboard`
  (PatchSetUndoBoundPanels.scala:26-27). The HEL-1795 call sits inside the `else` branch (:62). If the new check is
  placed "next to the HEL-1795 call" as D1 says, it never runs for a dataSource create.
- **Row write seq and timestamps (DataSourceRepository.scala):**
  - Append: `seq = maxExistingSeq + 1 + idx`, `created_at = updated_at = updatedAt` (:633-635). The max is taken over
    the rows that exist now, so once the top-seq row is deleted the next append reuses a seq at or below the
    journaled `maxSeq`.
  - PATCH (`patchRow`, :773-815): sets `data` and `updated_at` only, keeps `seq` and `created_at`. Then
    `recomputeAfterMutation` bumps `data_sources.updated_at` (:862-875).
  - DELETE (`deleteRow`, :822-855): deletes the row, then also runs `recomputeAfterMutation`, which bumps
    `data_sources.updated_at`.
  - PUT (`replaceRows`, :719-753): new ids, `seq` from 0, `created_at = updated_at = now`. It rewrites
    `dataset_schema`.
  - Schema PATCH (`updateDatasetSchema` -> `persistMigrationAction`, :985-1083): deletes every row and reinserts it
    with a new id, `seq` from 0 and `created_at = updated_at = updatedAt`. It writes `dataset_schema` and bumps
    `data_sources.updated_at`.
- **appliedAt ordering.** `appliedAt = Instant.now()` is taken in `journalSuccess`, after the whole apply loop
  (PatchSetApplyService.scala:261-268). `createStatic` stamps rows with its own earlier `Instant.now()`
  (DataSourceService.scala:177-184). So apply-era rows are at or before `appliedAt` (same JVM clock), but an append
  during the rest of the apply also falls at or before it.
- `JournaledEdit` is `jsonFormat9` with formats that must be declared first (PatchSetApplicationRepository.scala:
  120-147), so D2's jsonFormat10 and ordering note are correct. `dataSourceRepo.findReferences` exists
  (DataSourceRepository.scala:297) and is privileged and visibility-aware. `SourceReferences.describe` names only
  visible resources and counts the rest, which matches HEL-1720.

### Verdict: REFUTE

### Change Requests

1. **Remove the same-set reference excusal (D6), and rewrite the two spec scenarios that need it.** Ground truth: a
   patch set cannot create a pipeline, step or form panel that references a source the same set creates (see
   evidence above). Required:
   - D6 becomes: Phase 1 calls `dataSourceRepo.findReferences(id, user)`; any hit refuses, worded via `describe`.
     Drop the step-granularity finder, and say in one sentence why no excusal is needed, citing the resolvers.
   - The spec bullet "References held by resources the same patch set created are excused" is removed.
   - Scenario "A later pipeline using the source refuses the whole undo before anything is restored": the set's own
     pipeline cannot be "on it". Restate it so the set has other edits that a partial undo would touch, for example a
     dashboard and panel create, or a pipeline on a different source. A later pipeline from another user or another
     set roots on or joins the new source. THEN the result is a 409 and the set's other resources remain. That is the
     red that proves today's partial undo.
   - Scenario "References the patch set itself created do not block" cannot be built. Replace it with "no later work
     -> undo succeeds and removes the source and its rows".
   - Update D8's red list to match.
2. **D1/task 3.3: name the exact wiring point.** The new Phase-1 check must run for `("dataSource","create")` outside
   `guarded`'s `!PatchSetUndoBoundPanels.guards(edit)` early return (PatchSetUndoConflictCheck.scala:56-57). One
   option is to add it to that function's guard predicate, or to `checkOne`'s dataSource arm. Placing it next to the
   HEL-1795 call (:62) makes it dead code. Add a red test that would catch dead wiring. The first scenario already
   does this if it runs through the real `undo`.
3. **D3: base detection on `created_at`, not `seq`.** Append computes `max(existing seq) + 1`, so a delete followed by
   an append reuses a seq at or below `maxSeq`. Replace and schema migration renumber from 0. Under D3 as written,
   such a row is classified "edited", and the "also treat created_at as appended" clause, if added, counts it twice.
   Required predicates, with `T = rowsUpdatedThrough` (the apply rows' single stamp):
   - appended = `created_at > T`
   - edited = `created_at <= T AND updated_at > T`
   - with zero apply rows, any row is appended.

   Drop `maxSeq` from the journal, or keep it only if a stated case needs it. Replace the "maxSeq off by one" mutation
   with mutations on the `created_at` and `updated_at` comparisons. Add a red for "delete the last apply-era row, then
   append one" (it must refuse, counted as added).
4. **D7: make the counts true after a schema edit or replace.** `persistMigrationAction` and `replaceRows` rewrite
   every row with a fresh `created_at`. After a schema-only edit, the guard as designed would report "N row(s) were
   added" when nothing was added. Specify the wording for this case. For example: when the declared schema differs,
   or the apply-era rows no longer exist with their apply `created_at`, report "the dataset schema was edited" or
   "the rows were replaced" in place of an added count. Add a test asserting the schema-edit message does not claim
   added rows.
5. **D4 fallback and spec "A deleted row does not block": state the scope.** `deleteRow` bumps
   `data_sources.updated_at` (`recomputeAfterMutation`), so under D4's schema fallback a lone row delete refuses for
   journal rows with no `createdDataset`. That over-refusal is safe, but the spec scenario as written is then false for
   old journals. Scope the scenario to applies journaled with `createdDataset`, and say in D4 that a row delete trips
   the fallback. Also note that `appliedAt` is stamped after the whole apply loop
   (PatchSetApplyService.scala:261), so the fallback misses an append made during the apply itself. This is an
   accepted residual, but say so.

### Non-blocking notes

- D2 reads the journal on the applier's RLS context, and D5 reads on the privileged pool. Both are fine. The D5 read
  must take the `T` threshold and schema as parameters and return counts plus the live `dataset_schema` text only.
- D7: messages for the four kinds join into the one `Conflict` string, as HEL-1795 does. Keep "would delete them"
  only for rows: a reference blocks the delete, it does not get deleted.
- The Phase-2 re-check should reuse the same predicate function as Phase 1, so the two cannot drift.
- Comparing the schema as parsed JSON is right: the journal stores what `createStatic` wrote, and only
  `replaceRows` and `persistMigrationAction` write `dataset_schema`.
