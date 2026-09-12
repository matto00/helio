# HEL-1118: StaticSource scaladoc describes a retired DataType read path — it generated a false premise in the v0.8 spec

## Description

The scaladoc on `StaticSource` in `backend/src/main/scala/com/helio/domain/model/DataSource.scala` (around lines 140-144) said the protocol layer materializes the `{columns, rows}` blob "on demand from the DataType row (or the stored config blob for the legacy in-process / Spark engines that read it directly)." Both halves were wrong: the DataType/snapshot concept was retired by the pipelines-and-outputs remodel (HEL-904/HEL-909), and the config blob is not a legacy fallback — it is the only path.

## Driver re-scope (verified against main, 2026-09-11/12, ticket comments)

1. **The exact quoted defect is already gone.** HEL-1073 renamed `StaticSource` -> `DatasetSource`; HEL-1074 (merged since this ticket was filed) rewrote the scaladoc entirely to describe the `dataset_schema`+`dataset_rows` path. Confirmed during Setup premise validation — the literal sentence quoted in the ticket no longer exists anywhere in the file. State this plainly rather than re-fixing it.
2. **Still worth checking, verified during premise validation:** `DataSource.scala:16` ("...rather than a linked DataType row (the pre-HEL-904 shape)") is accurate — explicitly historical framing, not live. `:44` ("...independent of any DataType. Defaults empty so every pre-existing call site keeps compiling until the data-migration step (tasks.md §2.9) backfills it.") needs a live-behavior check: is the inferredSchema backfill for `dataset` sources actually done yet?
3. **The sweep is a TRIAGE, not a rewrite.** Grep `DataType\b|type registry|snapshot.?row` across `backend/src/main` (comments and identifiers both match; ~225 raw hits across ~77 files at premise-validation time). Classify every hit into: accurate-historical (correctly describes a past removal — leave alone), unrelated-identifier (string coincidentally matches, e.g. `@param dataType`, `DataTypeService`-shape references — leave alone), genuinely-stale (describes a retired mechanism as if still live — fix or delete), uncertain (needs a call — escalate if the uncertain/genuinely-stale set is large). Do not mass-edit comments that correctly describe a past removal. Two known-suspect candidates to check first: `DashboardAuthoringService.scala:261` ("One per-DataType capability fetch"), `PanelServiceHelpers.scala:192` ("the DataType-binding resolvers").
4. **One `"static"` sender remains:** `helio-mcp/src/helioApi.ts:456` still sends `type: "static"`. Switch it to `"dataset"`. Leave `helioApi.ts:93`'s `CSV_LIKE_TYPES` alone (deliberate read-side alias, own HEL-1073 comment).

## Acceptance Criteria

- The `StaticSource`/`DatasetSource` scaladoc matches verified current behaviour (confirmed already true, or corrected if not).
- The sweep's findings are listed even where nothing needed changing, classified into accurate-historical / unrelated-identifier / genuinely-stale / uncertain, with counts, so a future reader knows the check was done. Recorded in the change dir and in the PR body.
- Every genuinely-stale comment found is corrected or removed.
- `helio-mcp/src/helioApi.ts:456` sends `"dataset"` instead of `"static"`.
- No unrelated comments describing a past removal are edited.
- Escalate to the driver if the genuinely-stale/uncertain set turns out large enough to be its own piece of work.
