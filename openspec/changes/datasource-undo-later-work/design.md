## Context

Premise evidence: `.concertino/runs/HEL-1796/evidence/premise-validation.md` (main checkout). Precedents: HEL-1795, HEL-1720, HEL-1792.
- A patch-set `dataSource` create is `dataset`-only (`PatchSetDataSourceResolvers.resolveDataSourceCreate`). It is
  applied by `DataSourceService.createStatic` (`PatchSetApplyForward`), which inserts the source plus its `dataset_rows`.
- The undo's `delete` refuses on any `findReferences` hit, but only in Phase 2, after the reverse walk has already
  undone the later edits: a 200 and a partial undo. With no references it cascades `dataset_rows` (V106), so every
  row and edit made since the apply is lost. Phase 1 (`checkDataSource`) checks only the name.
- Owner rulings 2026-11-20 via driver: appended rows, apply-era row edits and schema edits each refuse (409, nothing
  changes, counts only). Row deletes do not block.
- Mirror HEL-1795 `PatchSetUndoLaterChildren` (an optional journal field with an `appliedAt` fallback and a Phase-2
  re-check) and HEL-1792 `PatchSetUndoBoundPanels.nameList`.

## Goals / Non-Goals

**Goals:** Phase-1 409 for every kind of later work above; nothing restored on refusal; counts only for rows and
schema; HEL-1720 naming rule for references; Phase-2 re-check; REST, MCP and web toast unchanged.

**Non-Goals:** splitting `PatchSetUndoService` (HEL-1797); row-write routes and form submit (HEL-1800); an atomic
check-and-delete transaction; changing HEL-1493 option B for a referenced inline source.

## Decisions

**D1. New object `PatchSetUndoDatasetLaterWork`** (a sibling of `PatchSetUndoLaterChildren`), exposing one predicate
function used by both phases. **Wiring:** Phase 1 runs it from `PatchSetUndoConflictCheck.checkOne`'s
`("dataSource", "update" | "create")` arm, for `create` only. Its blockers are appended to that arm's existing name
check. It must not go next to the HEL-1795 call: `guarded` returns early unless `PatchSetUndoBoundPanels.guards(edit)`,
and that excludes `dataSource`, so code placed there is dead. Phase 2 runs the same predicate as a re-check inside
`restoreOne`'s dataSource create arm, before `dataSourceService.delete`. That is the only change to
`PatchSetUndoService` (a few lines).

**D2. Journal what the create made.** Add `createdDataset: Option[JournaledCreatedDataset] = None` to `JournaledEdit`
(jsonFormat10; declare the format before `journaledEditFormat`, as the existing comment requires). It is set only for
a `dataSource` create:
`JournaledCreatedDataset(rowsStampedAt: Option[Instant], declaredSchema: Option[JsValue])`.
- `rowsStampedAt` (called `T` below) is the stored `data_sources.created_at` of the created source. It is read back
  from the database right after `createStatic` returns, and never taken from the in-memory `Instant`, so the D3
  comparisons run against values as stored, at microsecond precision. `createStatic` stamps the source and all of its
  rows with one `Instant.now()`, and nothing updates `data_sources.created_at` afterwards. So an append that lands
  between the commit and the read-back cannot move `T`, and that append is still caught (`created_at > T`).
  `max(dataset_rows.created_at)` is rejected for exactly that race.
  `T` is always present, including for a zero-row create: then every later row is `created_at > T`, so it counts as
  appended. `createdDataset` is `None` only when the read-back fails, and then the D4 fallback applies.
- `declaredSchema` is the `dataset_schema` it wrote.
Both are read right after `createStatic` returns, in `PatchSetApplyService` alongside `createdChildren`, on the
applier's RLS context. If the read fails, the field is `None` and the undo uses the fallback (D4). It must never fail
the apply. An absent field reads as `None`.

**D3. Detection with the journal** is based on `created_at`, never `seq`. Append uses `max(seq)+1` over live rows, so it
reuses seqs after a delete, and replace and schema migration renumber from 0.
- `appended = created_at > T`
- `edited = created_at <= T AND updated_at > T`
- `schemaEdited = parsed live dataset_schema != declaredSchema`
- A deleted row is just absent and blocks nothing.
- "Delete the last apply-era row, then append one" counts as appended.

**D4. Fallback for journal rows with no `createdDataset`** (written before this change, or whose D2 read-back failed):
- `appended = created_at > appliedAt`
- `edited = created_at <= appliedAt AND updated_at > appliedAt`
- `changed = data_sources.updated_at > appliedAt`, reported as "the data source was changed after the patch set was
  applied".

`appliedAt` is stamped in `journalSuccess` after the whole apply loop, so apply-era rows fall at or before it. Every
row write, row delete included (`recomputeAfterMutation`), bumps `data_sources.updated_at`. So on old journals a lone
row delete refuses. That over-refusal is accepted and safe, because a refusal changes nothing. The fallback would miss
an append made during the apply itself, which is possible only when a caller lists the committed source through
`GET /api/data-sources` before the apply returns. That is an accepted residual for old journals only. The journaled
path catches such a row, because its `created_at` is later than `T`.

**D5. Reads.** `DataSourceRepository.datasetLaterWork(sourceId, threshold)` returns counts, live schema and
`sourceUpdatedAt` on the privileged pool (no RLS hiding), never row data; row-write methods untouched (HEL-1800).

**D6. References move to Phase 1, with no excusal.** Phase 1 calls `dataSourceRepo.findReferences(id, user)`, and any
hit refuses. No same-set excusal is needed, because a patch set cannot reference a source it creates in the same set:
every edit is resolved before any is applied, the source id is a server UUID made in `createStatic`, and the
pipeline-root, step-secondary and form-binding resolvers all require the source to already exist
(PatchSetPipelineResolvers, PatchSetPipelineStepResolvers, PatchSetPanelResolvers). `PatchSetRefs` only names earlier
`output` creates. The guard inside `delete` stays as the Phase-2 backstop.

**Wording:** the refusal is NOT built with `SourceReferences.describe`, which prints ids and has no cap. `describe`
stays unchanged for the direct-delete 409. The message is built from `findReferences`' result with
`PatchSetUndoBoundPanels.nameList`, so it shares the HEL-1792 `NameCap` and count structure:
- a visible pipeline is shown as `pipeline "<name>"`;
- a visible form panel is shown as `"<title>" on dashboard "<name>"`;
- overflow past `NameCap` is counted;
- `hiddenPipelineCount`/`hiddenPanelCount` become "N pipeline(s) you cannot see" and "N panel(s) you cannot see".

No pipeline, panel, dashboard or source id appears.

**D7. Messages.** Each message is prefixed `edit N (dataSource create)`, and they join into the existing `Conflict`
string. No id or value ever appears, and no other user's name.
- If `schemaEdited`: `the dataset schema was edited after the patch set was applied, which rewrote its rows; undoing
  would delete them`. No row counts are given here, because the migration rewrote every row and a count would be
  false.
- Otherwise, `N row(s) were added or replaced after the patch set was applied and would be deleted`. "Replaced" is
  included because `replaceRows` gives every row a fresh `created_at`.
- `N row(s) created by the patch set were edited after it was applied and the edits would be lost`.
- For old journals, the D4 `changed` phrase.
- `the data source is now used by <nameList parts>; remove those uses before undoing`, per D6. This is reference
  wording, not "deleted".

The Phase-2 re-check failure is a fixed count-only phrase, logged at ERROR, like `addedDuringUndo`. If the backstop
inside `delete` refuses after the re-check (a reference landed in the window), its `describe` text is never shown or
logged. The arm maps any `DataSourceDeleteError` carrying a conflict to the fixed phrase `the data source gained a
use during the undo; nothing further was undone`, so the `failed` outcome and its log line hold no id.

**D8. Red first.** The spec runs on `helio_app_test` and asserts `rolbypassrls = false`, through the real
`PatchSetUndoService.undo` so that dead wiring is caught. Red tests are committed before the fix (these shipped first, in the first PR head):
editor form submit; owner append; apply-era row edit; schema edit (no "added" claim); replace; delete-last-then-append;
a lone delete succeeds when journaled; no later work on a multi-row create succeeds (guards `T` precision); a later
pipeline rooted on or joining the source, where the set also created a dashboard and panel (409, all of them
survive), proving today's partial undo; a later form panel; no ids in any reference message; an old-journal fallback;
the Phase-2 re-check through a deterministic hook (no sleeps). D9's tests are listed in tasks 6.x.

Mutations: flip each `created_at` and `updated_at` comparison; swap the D6 wording for `describe` (the no-id
assertion must go red); drop the schema compare; drop the references call; move
the wiring into `guarded`'s else branch.

**D9. Inline dataset roots of a patch-set `pipeline` create (fold-in, owner ruling).** Undo of the pipeline create
removes each journaled inline root through `PatchSetUndoInlineSources.cleanup` and then
`InlineSourceCleanup.deleteIfUnreferenced` (HEL-1493), which cascades `dataset_rows` too.
- **Journal:** `JournaledInlineSource` gains `createdDataset: Option[JournaledCreatedDataset] = None` (jsonFormat3,
  declared before use). It holds the same D2 read-back of the stored `data_sources.created_at` plus `dataset_schema`,
  only for dataset-kind inline roots. It never fails the apply. A missing value uses the D4 `appliedAt` fallback.
- **Which sources are judged (both phases, one shared function).** Take each journaled inline source that still
  exists and whose LIVE `source_type` is `dataset`. A non-dataset inline root (rest_api, sql, ...) never blocks, even
  if a refresh moved its `updated_at`. For each one, call `findReferences` and drop the entry for the pipeline being
  undone. Its own steps' secondaries and upsert target drop out with it, because hits are grouped per pipeline. The
  source counts as **referenced** if any remains: visible `pipelines`, `panels`, `hiddenPipelineCount > 0` or
  `hiddenPanelCount > 0`. This matches `DataSourceService.delete`, which keeps a source with only hidden referencers.
  A referenced source is kept by option B and never blocks. Only an unreferenced dataset source is judged by the D3
  predicate, or by the D4 fallback when `createdDataset` is missing. The predicate is refactored to take
  `(sourceId, Option[JournaledCreatedDataset], appliedAt)`, with the dataSource arm's behaviour byte-identical.
- **Old journals.** On old journals the D4 fallback also refuses after a rename of an unreferenced dataset inline
  root. This is the same accepted over-refusal as D4, though a rename never blocked this undo before.
- **Phase 1:** runs from `PatchSetUndoConflictCheck.guarded`, next to the HEL-1795 call (`pipeline` create is in
  `guards`). Any finding refuses the whole undo, using the D7 wording prefixed
  `edit N (pipeline create): its inline data source "<name>"`. The applier owns that source, so its name is readable.
- **Phase 2:** the same shared function, references included, re-runs in `restorePipelineCreateUndo` before the
  pipeline delete. A finding on an unreferenced source fails the edit with the fixed count-only phrase and deletes
  nothing. A referenced source never fails it. The window between the re-check and the cleanup is accepted, as in the
  dataSource arm. The `PatchSetUndoService` change stays a few lines.
- **Apply journaling:** the inline read-back is async, so it uses an accumulator alongside `createdDatasets` and never
  fails the apply.

## Risks / Trade-offs

- Accepted: the re-check-to-delete window (as HEL-1795); "added or replaced" is broad by necessity.
- The fallback may over-refuse old journals after an unrelated touch of `data_sources.updated_at` (safe, stated).
- Planner notes: journal shape, privileged counts and wording self-approved (no wire change); no migration.
