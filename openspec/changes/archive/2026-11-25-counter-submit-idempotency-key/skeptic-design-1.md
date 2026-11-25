## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: the uncommitted planning artifacts in `openspec/changes/counter-submit-idempotency-key/` (ticket.md, proposal.md,
design.md, tasks.md, specs/form-panel-submit/spec.md) at HEAD `cb287223d10c5451d3ebb2045bd872f88dfb376a`, checked against
the live code. Owner rulings Q0-Q5: confirmed in `.concertino/runs/HEL-1175/events.jsonl` line 7
(`escalation.answered`, `answer_source: human`). I did not re-argue them.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/counter-submit-idempotency-key/HEL-1175`.
- **Rulings map onto the design**: Q0 maps to D5 (same key, 2 retries, 300/900 ms, then the HEL-1169 path). Q1 maps to D1
  (JSON only, optional, multipart passes `None`). Q2 maps to D2 and D3 (nullable column, partial unique index, lookup
  under `lockSource`). Q3 maps to D4 (200, same body, `FormSubmitResponse.fromDomain` masking). Q4 maps to D3 (same
  user AND same panel, otherwise `KeyConflict` and 409). Q5 maps to D4 (no `audit`, no `triggerAutoRunAwaited`). Every
  ruling is covered.
- **Lock and race-freedom**: `DbContext.withUserContext` = `db.run((setUserVar andThen action).transactionally)`
  (DbContext.scala:50-51). `lockSource` = `SELECT ... FROM data_sources WHERE id = ? FOR UPDATE`
  (DataSourceRepository.scala:609-610). `appendBuiltRowAction` (:715-743) takes the lock first. A lookup placed after the lock
  in the same transaction is therefore serialised against every other same-source append, PUT replace, and patch/delete.
  The case of a lost ack where the first request is still in flight also comes out right: whichever request takes the
  lock second sees the key and replays.
- **RLS context**: `appendFormRow` runs the append in the form owner's context (`DataSourceService.ownerContext`,
  DataSourceService.scala:867-893). The `dataset_rows_owner` policy (V106:51-58) has USING only, so an UPDATE has an
  implicit WITH CHECK, and the owner's own rows pass it. The lookup and the stamp UPDATE both see exactly the owner's rows.
  FK RI checks and actions bypass RLS, which is the same premise as the V146/V124 headers. No new table means no new
  policy or grants. Task 5.5 can extend the existing `FormSubmitEditorRlsSpec.scala`.
- **V132 trigger interaction**: `hel1530_dataset_row_update_trigger` (statement level, AFTER UPDATE, ENABLE ALWAYS)
  fires on the D3 stamp UPDATE and on every FK `SET NULL`. Its function only walks rows where `o.data IS DISTINCT FROM nr.data`
  (V132:57-66). A stamp or SET NULL leaves `data` unchanged, so nothing is enqueued. Harmless.
- **Masking of the 409**: `FormSubmitErrorMasking.forNonOwner` passes `Reason.Other` through unchanged
  (FormSubmitErrorMasking.scala:24). A `Conflict` with a fixed message therefore reaches a non-owner as the same 409. D4 holds.
- **Wire**: `formSubmitRequestFormat` currently rejects any key but `values` (PanelProtocol.scala:316-331).
  `schemas/panels/form-submit-request.schema.json` has `additionalProperties: false`. D1 and task 2.5 update both. There is
  no other submit client (`helio-mcp/src` has no `/submit`; the only caller is `panelService.ts:185`).
- **Client**: `isDefiniteRejection` = `isAxiosError(err) && err.response !== undefined` (classifySubmitFailure.ts).
  `httpClient.ts` has no timeout, no retry, and no cancel. A 200 or a 201 both resolve the axios promise, so
  `useCompactCounterSubmit.ts:143` and `FormPanelView.tsx:202` need no status branch. D5 retries only in the JSON branch,
  so the keyless multipart path is never re-sent.
- **Existing e2e**: `e2e/hel1169-...spec.ts:183` and `e2e/hel1087-...spec.ts:212` abort every submit request. With
  retries they still end indeterminate, about 1.2 s later. No spec asserts the exact posted body.
- **Can the tests go red?** 5.1: if the lookup is dropped, the unique index raises the violation and it maps to a 409, not
  the expected 200, so the test goes red. If the stamp is dropped, two rows are appended, so it goes red too. 5.8:
  pre-change there is no retry, so the first rejection runs the indeterminate path and announces / reconciles, and the
  test goes red. 5.4 is meaningful only because the spec scenario requires a dataset that feeds an auto-runnable pipeline.
- **User-delete SQL**: `docs/user-reference-inventory.md` holds the FK-to-users table, and `V119OwnerFkMigrationSpec`
  (lines 150-162) parses it and compares it to `pg_constraint` on a migrated DB. Nothing in the plan updates it. See CR2.
- **Main spec**: `openspec/specs/form-panel-submit/spec.md:82-88` and `:698-702` contradict the new behaviour. See CR1.

### Verdict: REFUTE

The design itself is sound and implements Q0-Q5 faithfully against the real code. These are three gaps in the
artifacts, each cheap to fix. Without them the executor ships a self-contradicting spec, and one existing backend spec
fails.

### Change Requests

1. **The spec delta ADDs behaviour that two existing requirements forbid. Change them with `## MODIFIED Requirements`.**
   - `openspec/specs/form-panel-submit/spec.md:82-88` ("A submit appends exactly one row ..."). It says the body
     accepts `{"values": ...}` only. It says "a request body carrying any key other than `values` SHALL be rejected with
     `400`". It says a successful submit "SHALL respond `201 Created`". After this change `submitKey` is accepted, and a
     replay answers 200 and appends nothing. Modify the requirement: `values` plus an optional `submitKey`, every other
     key still 400. Then say 201 for an append and 200 for a replay (pointing at the new requirement).
   - `:698-702` ("A write by a non-owner is attributed ..."). It says "A successful submit SHALL record an audit event".
     A replay is a successful submit from the client's view, yet Q5 says no audit event. Modify the requirement to
     "a submit that appends a row" (or except a keyed replay).
   - If the archived spec keeps both the old text and the ADDED text, it states both rules.
2. **The new `users(id)` FK must go into `docs/user-reference-inventory.md`. Add a task for it.**
   - `V119OwnerFkMigrationSpec` ("The user-reference inventory document", lines 150-162) compares that table to every
     FK targeting `users` on a migrated DB. `dataset_rows.submit_user_id ... ON DELETE SET NULL` turns it red.
   - Add the row `| \`dataset_rows\` | \`submit_user_id\` | SET NULL |` in sorted position.
   - Extend the SET NULL paragraph: deleting the submitter keeps the row, and its key can then only ever answer `409`.
   - Add the spec to the backend test run for this change.
3. **Pin down D3/task 1.4's unique-violation backstop, which as written can turn the wrong error into a 409.**
   - `dataset_rows` already has a second unique constraint, `UNIQUE (data_source_id, seq)` (V106:37). Both violations
     are SQLSTATE `23505`.
   - The design must say the mapping matches the constraint name `ux_dataset_rows_submit_key` only. Any other `23505`
     keeps today's outcome.
   - The design must also say the mapping is done outside the transaction: the Future recovers after Slick rolls back.
     It must not use `asTry` inside the `.transactionally` DBIO, because Postgres has already aborted that transaction
     and the commit then fails.
   - Under the source lock the backstop is almost unreachable, so state that 1.4 is defence-in-depth. Either name the
     test for it, for example a repository-level spec that pre-inserts a keyed row through raw SQL with the lookup
     bypassed, or say it is covered only by the 5.1 drop-the-lookup mutation.

### Non-blocking notes

- **FK lookup indexes.** `submit_panel_id -> panels(id) ON DELETE SET NULL` makes every panel delete run
  `UPDATE dataset_rows SET submit_panel_id = NULL WHERE submit_panel_id = $1`. Without an index that is a sequential
  scan of the whole multi-tenant `dataset_rows` table, once per deleted panel. A dashboard delete repeats it for each of
  its panels. `submit_user_id` behaves the same on a user delete. Consider
  `CREATE INDEX ... ON dataset_rows (submit_panel_id) WHERE submit_panel_id IS NOT NULL` and the same for
  `submit_user_id`. They cost almost nothing. V124/V146 did not index their SET NULL columns, so there is precedent
  either way, but the project rule is performance by default.
- **Panel-delete and user-delete test.** Task 5.5 should also cover deleting a panel, and a `DELETE FROM users` for an
  editor submitter, with keyed rows present. The rows must survive with the column NULLed, under the FORCE-RLS table
  and the always-enabled V132 trigger. A later same-key submit must then answer 409.
- **D3 stamp.** D3 stamps the key with a second UPDATE after `insertAppendedRowsAction`. That works, and the V132
  trigger skips it cheaply. It does fire a statement trigger on every keyed submit, and doing the stamp in the INSERT
  through a dedicated raw insert would avoid that. Either choice is acceptable. Whichever is chosen, the stamp must
  target the inserted row's `id`.
- **D4 `replayed` flag.** D4 puts `replayed` on `FormSubmitResult`, which `PanelService` builds from `appendFormRow`'s
  `RowWriteResult`. Spell out where the flag travels so it is not threaded ad hoc: a field on `RowWriteResult`, or a
  wrapper returned by `appendFormRow`.
- **D5 retry predicate.** `!isDefiniteRejection(err)` also matches non-axios errors, such as a synchronous throw in an
  interceptor. Narrowing it to `isAxiosError(err) && err.response === undefined` would avoid two pointless re-sends. A
  retry that receives a definite 5xx from a proxy after the first attempt committed rolls back via the existing
  HEL-1169 path, as before: a pre-existing class, not new.
- **Also update when the protocol changes.** The prose `description` in `form-submit-request.schema.json` ("`values`
  is the ONLY recognized key"). The `FormSubmitRequest` TS interface in `frontend/src/features/panels/types/panel.ts:383`.
  The protocol `write` method, which should emit `submitKey` when present so the seam fixture round-trips.
