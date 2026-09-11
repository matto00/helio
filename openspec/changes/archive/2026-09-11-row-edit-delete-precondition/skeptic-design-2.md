## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `39576df8b985e91cfcbb5b908e28e0bd785ffdc7`. The planning artifacts are still uncommitted
(`?? openspec/changes/row-edit-delete-precondition/`).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/row-edit-delete-precondition/HEL-1078`.
- **CR1 (cross-source predicate): RESOLVED.** The proposal (line 19), design D1, both spec requirements
  and tasks 1.1/1.2 all state `WHERE id = ? AND data_source_id = ? AND updated_at = ?`. D5 step 2 adds
  a pre-read, `WHERE id = ? AND data_source_id = ?`. Task 5.6 now has a same-owner, two-source test
  that asserts a 404 and that B's row is unchanged. I checked this against V106: `data_source_id TEXT
  NOT NULL` (line 32), and the RLS policy `dataset_rows_owner` scopes by owner only (lines 51-55). That
  confirms the source scoping has to come from the predicate, and now it does.
- **CR2 (precision): RESOLVED.** `DataSourceService.scala:744, 774, 794` all use
  `Instant.now().truncatedTo(ChronoUnit.MICROS)`. I confirmed this with a fresh grep. `RowWriteResponse.fromDomain`
  (`DataSourceProtocol.scala`) emits `r.updatedAt.toString`. V106:36 is `updated_at TIMESTAMPTZ NOT NULL`.
  D4 now matches the code, and task 1.4 makes MICROS truncation a verified requirement. The
  TIMESTAMPTZ wording is fixed. The backfill explanation is still missing, but that part is moot for
  now (see notes).
- **CR3 (404 vs 409 mechanism): RESOLVED.** D5 gives a real three-step sequence: re-read the schema
  under the lock, read the row scoped to the source, then run the conditional mutation. The schema
  re-read matches the existing pattern in `appendRows`/`replaceRows`
  (`DataSourceRepository.scala:375-378, 432-435`: `lockSource`, then
  `table.filter(_.id === id).map(_.datasetSchema).result.headOption`, where `None` means not found).
  `lockSource` (`:355-356`) is private in the same class, so the new methods can reuse it.
- **CR4 ("no separate read" rationale): RESOLVED.** D1 and the proposal now name the source
  `FOR UPDATE` lock as the real serializer, with the predicate as the stale-client check. The spec no
  longer claims "no separate read".
- **CR5 (no row-read API): RESOLVED via option (b).** A row-listing `GET` is an explicit Non-Goal in
  both the proposal and the design, and a spinoff is promised at Delivery. Task 5.9 now round-trips
  through routes that exist: POST, then PATCH, then PATCH/DELETE. `RowWriteRowResponse` does carry a
  per-row `updatedAt`, so the round-trip is buildable. I confirmed that `readDatasetRows` (`:476-495`)
  still returns no identity.
- **CR6 (clearing an optional cell): RESOLVED.** PATCH is now a full-row replace. The design records
  this as a deliberate, reversible shape decision.
- **CR7 (merge vs validator defaults): MOSTLY RESOLVED.** There is no merge any more, so the
  `lift`-padding problem is gone. Default-filling and shorter-array behaviour have residual wording
  issues (see notes). I read `DatasetRowValidator.validateRow`: a `JsNull` cell takes the field's
  `default` if it has one. A shorter row is accepted and a longer row is rejected.
- **CR8 (response shapes): RESOLVED.** Task 2.3 pins PATCH's 200 body as a new `RowResponse`,
  `{"row": {id, seq, updatedAt, data}, "sourceUpdatedAt"}`. DELETE returns `204` with no body. A
  malformed or missing `updatedAt` is a 400 before any DB call. The DELETE spec is normative on the
  query parameter.
- **CR9 (precedence): RESOLVED.** The full order is stated in D6 and repeated in the spec's third
  requirement: updatedAt 400, source 404, kind 400, row 404, validation 400, then 409. The service
  code matches the claim that the source 404 comes before the kind 400: `appendRows:768-782` runs
  `findByIdOwned` and returns the kind `BadRequest` in its `Some(_)` branch. Stale plus invalid gives
  400, and task 5.11 tests it.
- **Conflict mapping:** `ServiceError.Conflict` (`ServiceError.scala:23`) maps to 409
  (`routes/ServiceResponse.scala:81`).
- **Audit parity:** task 2.4 adds `data_source.rows.patch` and `.delete`, matching `:779` and `:799`.
- **AC coverage:** concurrent appends are covered by 5.10, stale rejection by 5.2 and 5.5, reuse of
  the validator, ACL and lock by 1.1, 1.2 and 2.1, and cross-owner behaviour under real RLS by 5.8.
  Every AC has a task.

### Verdict: CONFIRM

All nine round-1 change requests are addressed with claims that hold against the code. What is left
is wording precision, not design soundness, so none of it blocks implementation.

### Non-blocking notes (executor should honor these)

- **Defaulted optional columns cannot be cleared to null.** Because PATCH reuses `validateRow`, a
  `null` sent for a column that has a `default` is stored as the default. It is not stored as `null`.
  D2's point (c), "no silent default-filling", is therefore only true for columns without a default.
  The spec scenario "Clearing an optional cell ... stored value becomes null" should be scoped to "an
  optional column **with no default**". Task 5.3 should use a column like that. It may also be worth
  adding an assertion that `null` on a defaulted column writes the default, which is the same
  behaviour as append. Do not fork the validator to make clearing work.
- **Shorter `data` array.** The spec says `data` is the same length as the declaration. The reused
  validator accepts a shorter row and pads the missing cells as nulls, then fills defaults or reports
  "required". Pick one behaviour and state it. The simplest option that doesn't fork the validator is
  to document that shorter rows are handled exactly as append handles them. The alternative is to add
  an explicit length check in the service and test it.
- **D8 wording.** D8's prose shows a flat `{id, seq, updatedAt, data}` and then the wrapped shape. The
  wrapped shape in task 2.3 (`{"row": {...}, "sourceUpdatedAt": ...}`) is the binding one. Keep the
  OpenAPI and schema entries consistent with it.
- **Task 1.3** says "4-way result" but lists five cases. The list is correct.
- **Backfilled (pre-V106) rows.** The CR2 question about these is moot until the row-read `GET`
  spinoff exists, because no current route exposes a backfilled row's id. The spinoff ticket should
  carry the note: a TIMESTAMPTZ read back through JDBC is microsecond-precise, so `Instant.toString`
  round-trips it.
- **The 409 body** includes the row's current `updatedAt`. Only the owner can reach it (rows are
  RLS-scoped), so nothing leaks.
