## Context

Submit path today: `PanelRoutes` (`path(PanelIdSegment / "submit")`, JSON branch `entity(as[FormSubmitRequest])`)
-> `PanelService.submitForm` (HEL-1784 admission; owner/editor) -> `DataSourceService.appendFormRow` (runs in the
FORM OWNER's DB context, `DataSourceService.ownerContext`) -> `DataSourceRepository.appendBuiltRowAction`
(`lockSource(id)`, declaration read under the lock, `build`, row-cap check, `insertAppendedRowsAction`). Success:
`audit("data_source.rows.append", ...)` then `triggerAutoRunAwaited(id, writer)` (V146 `triggered_by_user_id`),
`completeSubmit` answers `201` with `FormSubmitResponse.fromDomain(FormSubmitResult(write, writerIsFormOwner))`.
`FormSubmitRequest` rejects any key but `values`. Client: `panelService.submitFormPanel` posts once; callers are
`useCompactCounterSubmit.ts` (optimistic per-click delta, HEL-1169 definite/indeterminate split via
`classifySubmitFailure.isDefiniteRejection`) and `FormPanelView.tsx` (non-counter submit). `dataset_rows` (V106) is
FORCE RLS with `dataset_rows_owner`. Owner rulings Q0-Q5 (2026-11-25) fix every product choice below; prior art for a
client-minted idempotency key: the assistant composer (`MessageComposer.tsx`, HEL-698).

## Goals / Non-Goals

**Goals:** a keyed JSON submit appends at most one row per `(dataset, key)`; a same-submitter same-panel duplicate
replays the original response with no side effects; a lost-ack request is re-sent automatically with its key.

**Non-Goals:** multipart submits, manual re-click dedupe, other dataset write routes, body-mismatch detection (see
proposal.md).

## Decisions

**D1 Wire.** `FormSubmitRequest(values: JsObject, submitKey: Option[UUID])`; the protocol reader accepts `values` and
`submitKey` only (unknown keys still `400`). `submitKey` must be a JSON string that `UUID.fromString` parses AND whose
canonical lower-case form equals the input lower-cased (rejects the short forms `fromString` tolerates), else
`deserializationError` -> `400`, nothing written. `schemas/panels/form-submit-request.schema.json` gains
`submitKey: {type: string, format: uuid}` and its description drops "`values` is the ONLY recognized key". The
protocol `write` emits `submitKey` when present (seam fixture round-trips); the TS `FormSubmitRequest` interface
(`frontend/src/features/panels/types/panel.ts`) gains `submitKey?: string`. The main spec's two requirements that
forbid this (body keys, audit on every success) are MODIFIED in the delta. The multipart branch is untouched (passes `None`).

**D2 Migration (next free V; V149 unless HEL-1707 lands one first).** Additive only, no UPDATE/backfill (FORCE-RLS
v0.7.x incident class, cf. V146 header):
`ALTER TABLE dataset_rows ADD COLUMN submit_key UUID NULL, ADD COLUMN submit_user_id UUID NULL REFERENCES users(id)
ON DELETE SET NULL, ADD COLUMN submit_panel_id TEXT NULL REFERENCES panels(id) ON DELETE SET NULL;`
`CREATE UNIQUE INDEX ux_dataset_rows_submit_key ON dataset_rows (data_source_id, submit_key) WHERE submit_key IS NOT
NULL;` plus `CREATE INDEX ... ON dataset_rows (submit_user_id) WHERE submit_user_id IS NOT NULL` and the same for
`submit_panel_id`, so a user or panel delete's SET NULL is an index lookup, not a scan of the multi-tenant table.
`docs/user-reference-inventory.md` gains `| \`dataset_rows\` | \`submit_user_id\` | SET NULL |` (sorted) and a SET NULL
note; `V119OwnerFkMigrationSpec` compares that table to `pg_constraint` and must stay green. No new table, so no new policy; columns inherit `dataset_rows` grants and `dataset_rows_owner`. SET NULL keeps a
deleted user/panel from deleting rows; a key whose submitter or panel is gone can then only ever answer `409`.

**D3 Repository (as built).** A NEW public `appendBuiltRowKeyed(..., stamp: SubmitKeyStamp)` (`key`, `userId`, `panelId`)
returns `Option[Either[FormRowBuildFailure, KeyedAppend]]`, with `KeyedAppend` = `Appended(ds, row)` | `Replayed(ds, row)` and a
new `FormRowBuildFailure.KeyConflict`. `appendBuiltRow` keeps its old signature and return type (existing callers untouched);
both call the private `appendBuiltRowAction(..., stamp: Option[SubmitKeyStamp], lookupFirst = true)`, whose `lookupFirst` flag
is a test seam only (it lets a spec reach the unique index). Order inside the SAME transaction, after `lockSource(id)` and the source existence read: when
a key is present, select the row with `(data_source_id, submit_key)`; same user AND panel -> `Replayed` (no build,
no cap check, no write); otherwise -> `KeyConflict`; no row -> today's build/cap/insert, then stamp the three
columns on the inserted row (same transaction). `DatasetRowTable`'s `*` projection and `DatasetRowRow` stay
unchanged so every other reader/writer (PUT replace, row PATCH/DELETE, upsert write-back, engine reads) is untouched;
the key columns get their own lookup/stamp queries; the stamp targets the inserted row's `id`. The V132
`hel1530_dataset_row_update_trigger` fires on the stamp UPDATE but enqueues nothing (it only walks rows whose `data`
changed). The lock serialises same-source appends, so the lookup is race-free. The unique index is defence-in-depth:
a violation is mapped AFTER Slick has rolled the transaction back (a `Future` recover in `appendFormRow`, never `asTry`
inside the `.transactionally` DBIO, whose commit Postgres would then fail), and ONLY when the `PSQLException` is
SQLSTATE `23505` with constraint name `ux_dataset_rows_submit_key`; any other `23505` (e.g. `UNIQUE (data_source_id,
seq)`) keeps today's outcome. Under the lock it is almost unreachable, so it is covered by a repository spec that
pre-inserts a keyed row with raw SQL and calls the stamp path with the lookup bypassed (task 5.9), plus the 5.1
drop-the-lookup mutation.

**D4 Service and route (as built).** `appendFormRow` gains `submitKey: Option[UUID] = None` and still returns
`RowWriteResult`, which gains `replayed: Boolean = false`; `FormSubmitResult.replayed` is a derived `def` delegating to
`write.replayed`, and `completeSubmit` reads it. Deviation from the planned `FormAppendOutcome` wrapper: the flag rides on
the existing result so the four existing `appendFormRow` callers and `PanelFormFileSubmission` needed no change; no wire
leak (the response builders list their fields explicitly). `Replayed` -> no `audit`, no `triggerAutoRunAwaited`,
`RowWriteResult.fromRepositoryRows(ds, Vector(row))` (empty denials). `KeyConflict` -> `FormSubmitError(ServiceError.Conflict(<fixed
message>))`, naming no row, seq or user; non-owner masking applies unchanged. `completeSubmit`: `Created` for a fresh
append, `OK` for a replay; same body shape (`FormSubmitResponse.fromDomain`, so a non-owner still gets no `seq`).

**D5 Client.** `submitFormPanel`'s JSON branch mints `crypto.randomUUID()` once per call, sends `{values, submitKey}`,
and on a failure where `isAxiosError(err) && err.response === undefined` (no HTTP response; a non-axios throw is
not retried) re-sends the same body up to 2 more
times after 300 ms then 900 ms; any response ends the loop; the final error is rethrown unchanged so
`useCompactCounterSubmit`'s HEL-1169 branches and `FormPanelView`'s retryable error state keep working. Because the
retry lives inside the one call, each click/submit still settles once: the optimistic delta is applied once and the
pending map semantics are unchanged; a `200` replay resolves like `201`. Every new click/submit calls
`submitFormPanel` afresh, so a manual action always gets a new key. The backoff is injectable for tests.

## Risks / Trade-offs

- A retry adds up to ~1.2 s plus request time before an indeterminate state is shown; bounded by Q0's cap of 2.
- A same-key re-send with a different body replays the original; only our own retry loop re-uses keys, and it
  re-sends the identical body.
- PUT replace / row delete drops the key with its row (owner ruling Q2: the key lives as long as the row).
- `crypto.randomUUID` needs a secure context: localhost and prod https both qualify; jest may need a polyfill check.

## Planner Notes

- Self-approved: field name `submitKey`; `200` vs `201` split per ruling Q3; client retry placed in
  `submitFormPanel` (one place, both callers); backoff 300/900 ms; columns named `submit_*`; index name.
- Not decided here (possible follow-up triage at Delivery): reusing a key on a MANUAL re-submit of an unchanged
  non-counter form after an indeterminate failure (the assistant composer does this); it would change the "always a
  fresh key" rule and is a product call.
- Multipart key support: follow-up triage at Delivery (ruling Q1).
- Sibling lanes: no overlap with HEL-1707 (pipeline roots) or HEL-1517 (charts); only the V-number may collide.
