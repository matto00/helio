## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: the uncommitted planning artifacts in `openspec/changes/counter-submit-idempotency-key/` at HEAD
`cb287223d10c5451d3ebb2045bd872f88dfb376a`, checked against the live code. Owner rulings Q0-Q5 are taken as given.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/counter-submit-idempotency-key/HEL-1175`.
- **Round-1 CR1 (contradicting main-spec requirements): closed.**
  - The delta now carries `## MODIFIED Requirements` for both requirements.
  - Each requirement header matches the main spec exactly: `openspec/specs/form-panel-submit/spec.md:82` and `:698`.
  - The first requirement accepts `values` plus `submitKey`, and every other key is still `400`. It says `201` for an
    append and `200` for a replay. All 5 original scenarios are kept verbatim.
  - The second requirement scopes the audit event to "a submit that appends a row" and says a replay records none.
    Both original scenarios are kept. The audit scenario's WHEN clause is narrowed to "and a row is appended".
- **Round-1 CR2 (user-reference inventory): closed.**
  - D2 and task 1.5 add the `dataset_rows | submit_user_id | SET NULL` row and a SET NULL note.
  - Task 5.11 runs `V119OwnerFkMigrationSpec`.
  - I confirmed the inventory's current table format: `docs/user-reference-inventory.md:40-42`, SET NULL prose at :53.
- **Round-1 CR3 (unique-violation backstop): closed.**
  - D3 maps only SQLSTATE `23505` carrying constraint `ux_dataset_rows_submit_key`. Any other `23505` (the
    `(data_source_id, seq)` unique) keeps today's outcome.
  - The mapping is done in a Future recover in `appendFormRow`, after rollback. D3 explicitly forbids `asTry` inside
    `.transactionally`.
  - D3 labels the mapping defence-in-depth. Task 5.9 tests it: a keyed row is pre-inserted with raw SQL and the stamp
    path is called with the lookup bypassed. A seq `23505` must not be mapped. This is feasible: the stamp is its own
    UPDATE query (D3), so calling it directly on a fresh row with a key already in use raises the target violation.
  - I checked that `appendFormRow` has no recover today that would swallow the exception first
    (`DataSourceService.scala:867-893`).
- **Round-1 non-blocking notes**: all adopted.
  - Partial indexes on `submit_user_id` and `submit_panel_id` (D2).
  - Panel-delete and user-delete coverage under NOBYPASSRLS (5.10).
  - The stamp targets the inserted row's `id` (D3).
  - The `replayed` flag travels through `FormAppendOutcome` into `FormSubmitResult` (D4).
  - The retry predicate is narrowed to `isAxiosError && response === undefined` (D5).
  - The schema description, the TS interface and the protocol `write` are all updated (D1, 2.5, 3.3).
- **The design on its own merits, checked against the code:**
  - **FK column types are right.** `panels.id` is `TEXT` (V1:12), so `submit_panel_id TEXT` matches. `users.id` is
    UUID, as in V146:10 `triggered_by_user_id UUID ... REFERENCES users(id) ON DELETE SET NULL`, so `submit_user_id`
    matches.
  - **The V-number is right.** The last migration on the branch and on origin/main is V148, so V149 is next free. D2
    already flags the possible collision with HEL-1707.
  - **Both submit paths are accounted for.** Multipart reaches `appendFormRow` through
    `PanelFormFileSubmission.scala:62`. The JSON path goes through `PanelService.scala:130`. Both pass the stamp as
    `None` or `Some` per D1/D2.2. Changing the return type to `FormAppendOutcome` touches both, plus one test caller
    (`PatchSetUndoDatasetLaterWorkSpec.scala:193`), which passes no key and needs a mechanical update only.
  - **The retry stays inside the client function.** `submitFormPanel` (`panelService.ts:179-202`) already branches on
    an empty `files` map. Putting the retry in the JSON branch leaves its signature unchanged. Existing component tests
    assert `toHaveBeenCalledWith("panel-9", { delta: 5 }, {})` (`FormPanelView.nonOwner.test.tsx:125`), and they keep
    passing.
  - **There is prior art for the key.** The client already uses `crypto.randomUUID()` (`ChatPage.tsx:89`,
    `MessageComposer.tsx:119`, `OutputControlsEditor.tsx:32`), so the jsdom polyfill risk is already handled in this
    codebase.
  - **The locking and RLS premises still hold.** The lock is a single transaction with `lockSource FOR UPDATE`, and
    the append runs in the owner's context. I re-checked the call sites listed above.
- **Placeholders and ambiguity**: no TODO or TBD. Every AC (the key scheme, no double append, no change without a
  key, red-first with a mutation, the seam test, RLS parity, schema, client and server together) maps to a task:
  D1-D5 and tasks 1.x-5.x.

### Verdict: CONFIRM

### Non-blocking notes

- **Task 5.8 needs an HTTP-level mock to go red first.** The counter and form component tests mock `submitFormPanel`
  wholesale (`FormPanelView.nonOwner.test.tsx:33`). A 5.8 that mocks it to resolve `200` would pass before the change
  and prove nothing about the retry. 5.8 must mock at the `httpClient`/axios layer: first call a no-response error,
  second call `200`. Then the pre-change code announces indeterminate and the test goes red, as C2 requires.
- **Task 5.9 names a repository spec, but D3 puts the mapping in a service.** The `23505` mapping lives in
  `DataSourceService.appendFormRow`, so a pure repository spec only sees the raw `PSQLException`. Extract the mapping
  as a small function and assert it on the real exception the repository raises. Or drive 5.9 through the service.
  Either way, the test must cover both the mapped constraint and the unmapped `seq` constraint.
- **Shape-check ordering on a replay.** If the HEL-1784 counter-shape `400` check (or any other pre-lock check) runs
  before `appendFormRow`, a replay after the dataset's shape changed answers `400`, not `200`. That is acceptable and
  arguably right, but the executor should know where those checks sit, so that a 5.x test does not assume otherwise.
- **A replay returns the row's current state.** It is built from the row as it is now, so a row PATCHed since the
  original submit replays its current `updatedAt`. That is consistent with "built from the original row" and harmless.
