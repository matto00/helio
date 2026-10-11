## Standing Constraints

- [C1] Red first: every new behavioural test is shown failing on the unmodified code (evidence in red-evidence.md).
- [C2] New DB-backed specs start Postgres with `VerifiedEmbeddedPostgres.start`; `[hel1468-guard]` appears in sbt output.
- [C4] Kept-source toast lines must actually render as separate lines (e.g. `white-space: pre-line` or one toast each) and be readable (warning variant / longer duration); verified in the running app, both themes.
- [C5] Journal pairing: an inline root whose summary entry lacks a string dataSourceId is left out of the journal with a warning (as rollback does).
- [C6] UI kept-source text never shows ids or the server remediation sentence; names only visible referencers, hidden ones as counts (SourceDeleteConflictNotice pattern).
- [C3] Never delete a source the apply did not create; legacy journal rows keep today's behaviour (owner Q2).

### Backend

## 1. Journal and pairing

- [x] 1.1 Extract the roots-by-position pairing from `PatchSetApplyRollback.deleteInlineRootSources` into a shared helper; rollback unchanged
- [x] 1.2 Add `JournaledInlineSource` and optional `inlineSources` to `JournaledEdit` (format reads legacy rows)
- [x] 1.3 Fill `inlineSources` in `PatchSetApplyService.journalSuccess` for `PipelineCreate` edits

## 2. Cleanup and undo

- [x] 2.1 Add `InlineSourceDeleteResult` ADT and `InlineSourceCleanup.deleteIfUnreferenced`; `deleteCallCreated` contract unchanged
- [x] 2.2 Replace the `("pipeline","create")` undo arm with `restorePipelineCreateUndo` (design D3)
- [x] 2.3 Add `InlineSourceUndoOutcome` and optional `inlineSources` to `EditUndoOutcome` + `PatchSetUndoProtocol`
- [x] 2.4 Update `schemas/patch-sets/patch-set-undo-response.schema.json` and `helio-mcp/src/types.ts`

### Frontend

## 3. Types and toast

- [x] 3.1 Add `inlineSources` to `EditUndoOutcome` in `features/patchSets/types/patchSet.ts`
- [x] 3.2 Undo toast: one line per kept source using its reason (name fallback per D5)
- [x] 3.3 Extend `invalidateAffectedState`/`undoPatchSet` to dispatch `fetchSources()` when an outcome lists a removed/alreadyGone source

### Tests

## 4. Tests

- [x] 4.1 Undo spec (VerifiedEmbeddedPostgres): inline static root removed on undo; outcome `removed` (red on main)
- [x] 4.2 Referenced-since-apply source kept, undo succeeds, outcome `kept` with reason
- [x] 4.3 `sourceId` root never deleted; mixed inline + existing roots delete only the inline one
- [x] 4.4 Bare-url REST inline root: implicit Auto: Connector removed with its source
- [x] 4.5 Legacy journal row (no `inlineSources`) parses and keeps the source; outcome has no `inlineSources`
- [x] 4.6 `deleteIfUnreferenced` classification tests (removed / kept / alreadyGone / failed); existing rollback specs pass
- [x] 4.6a Undo mapping: Failed and no-helper map to `kept` with the named fixed reasons
- [x] 4.7 Wire: outcome validates against the schema; `inlineSources` omitted when None AND when journal list is empty
- [x] 4.8 Jest: toast kept lines use reason + name fallback, multiple kept; `fetchSources` dispatched on removal, not otherwise
- [x] 4.9 Record red evidence (red-evidence.md) and full gate runs
