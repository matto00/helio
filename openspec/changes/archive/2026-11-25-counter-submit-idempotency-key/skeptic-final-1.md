## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `a9780ec9f2bff6cc1d5769d2a674636f550de68d` against the live-resolved base
`cb287223d10c5451d3ebb2045bd872f88dfb376a` (`resolve-review-base.sh`, exit 0). origin/main has moved on to `42d679bd1`
(HEL-1707, HEL-1517), but it adds no migration (it stops at V148) and touches none of this change's files, so V149 does
not collide.

### What I verified (with evidence)

**Owner rulings Q0-Q5** (`escalation.answered` in `.concertino/runs/HEL-1175/events.jsonl`), checked against the code:
- Q0, auto-retry: `panelService.ts` `submitFormPanel` mints one `crypto.randomUUID()` per call. It re-sends the same body
  object only when `isAxiosError(err) && err.response === undefined`, waiting 300 ms and then 900 ms. The cap is
  `attempt >= backoffMs.length`, so it gives up after 2 retries and rethrows the original error.
- Q1, JSON submits only: `PanelService.submitForm` passes `submitKey` only on the `files.isEmpty` branch. The multipart
  branch (`submitFormWithFiles`) and its client `FormData` branch are unchanged.
- Q2, a key column on `dataset_rows`: V149 adds 3 nullable columns, a partial unique index
  `(data_source_id, submit_key)` and 2 partial FK indexes. There is no new table, no DML and no purge job.
- Q3, `200` replay: `PanelRoutes.completeSubmit` answers `OK` when `r.replayed`. The body comes from the same
  `FormSubmitResponse.fromDomain`, so a non-owner still gets no `seq`.
- Q4, scope: the repository lookup replays only when both `submit_user_id` and `submit_panel_id` match. Anything else
  is `KeyConflict`, which becomes a `409` with a fixed message.
- Q5, no bookkeeping on a replay: the `Replayed` arm returns before `audit(...)` and `triggerAutoRunAwaited`, with an
  empty denials list.

**Lost ack, end to end, without a double count**
- Server side: the lookup and the append run in one `.transactionally` block (`DbContext.withUserContext`, line 50-51).
  This happens after `lockSource`, which is `SELECT ... FROM data_sources ... FOR UPDATE`.
- So a retry that arrives while the original request is still in flight blocks on the row lock. Under READ COMMITTED
  its later lookup statement then sees the committed row and replays it. Whichever of the two requests takes the lock
  first appends; the other replays.
- The unique index is a second guard. Its violation is mapped only for SQLSTATE 23505 on `ux_dataset_rows_submit_key`,
  inside a `Future.recover` after rollback.
- Client side: the retry lives inside one `submitFormPanel` call, so `useCompactCounterSubmit` applies its optimistic
  delta once and settles once. A `200` resolves exactly like a `201`.
- `httpClient.ts` has no timeout and no abort signal on this call. A "no response" therefore means a real network
  failure and never a cancellation, so there is no retry of an aborted request.
- I relied on the evaluator's live browser lost-ack run (`.concertino/scratch/HEL-1175/eval-1-live-lost-ack.txt`) for
  the UI half. It shows 201 lost, then a 200 replay, one row for the key, and a +5 tally. I did not repeat it live: there
  is no visual change to judge, and both halves below are proven by my own fresh runs.

**Can a replay or a 409 leak another user's data**
- A replay is served only to the same submitter through the same panel, and only after HEL-1784 admission has been
  re-checked on that request. The body carries row id, `seq` (owner only), row `updatedAt` and the source's
  `updatedAt`. That is the same shape as the fresh submit that same user already received.
- A `409` carries the fixed `SubmitKeyConflictMessage`. It names no row, seq or user, and the
  `FormSubmitErrorMasking` `Reason.Other` passthrough is safe for it.
- The key is scoped per dataset and is a client-minted v4 UUID, so a conflict reveals only that a guessed key exists.
- The route spec asserts that the 409 body has no `rows`, no `seq` and not the owner's row id.

**Is the migration safe under non-BYPASSRLS Flyway and FORCE RLS** (my own probe, since no repo harness runs V149 as a
non-BYPASSRLS owner)
- Setup: a scratch database owned by a fresh `NOSUPERUSER NOBYPASSRLS` role. In it, a `dataset_rows` copy with the V106
  policy verbatim, FORCE RLS, 1,000 existing rows, and `app.current_user_id` unset. Unset is deliberate: if any statement
  evaluated the policy, the `::uuid` cast would raise.
- Running V149 verbatim as that role exited 0. The rows stayed 1000/1000 with every key NULL, and all 3 indexes were
  created.
- SET NULL probe: as that role, with a different tenant's `app.current_user_id`, I deleted the stamping panel and user.
  The row was kept and `submit_user_id`/`submit_panel_id` were cleared, because FK actions bypass RLS.
- I dropped the probe database and role afterwards.
- The V132 update trigger fires on the stamp UPDATE but walks only rows whose `data` changed (`o.data IS DISTINCT FROM
  nr.data`), so the stamp enqueues nothing.

**Gates and tests, run fresh by me**
- Backend, `sbt -J-Xmx3g testOnly FormSubmitIdempotencyRoutesSpec DatasetRowSubmitKeyRepositorySpec
  FormSubmitEditorRlsSpec FormSubmitRoutesSpec`: `Tests: succeeded 65, failed 0`, EXIT=0
  (`.concertino/scratch/HEL-1175/skeptic-sbt-1.txt`). The route specs run on embedded Postgres through the real HTTP
  route. The RLS spec runs as the real NOBYPASSRLS `helio_app_test` role.
- Frontend, after `npm ci`: jest over `panels/services` and `panels/ui/form` gave 132/132 passing. The two HEL-1175 files
  gave 7/7. `npm run typecheck` exited 0.
- Whole backend suite: I relied on the evaluator's pasted shard totals (`evidence/green-2-backend-shards.txt`, 4 shards,
  0 failed). There has been no production change since then (`a1f8680b4..HEAD` touches tests and openspec only).

**Red and mutation proofs, reproduced by me** in a throwaway detached worktree at HEAD, since removed
- M1, lookup dropped (`stamp.filter(_ => false)`): 9 tests failed, 25 succeeded. This is the driver-required "drop the
  dedupe goes red" proof. It is identical to the committed `mutation-M1-drop-lookup.txt`.
- M2, ownership check removed (`if true =>`): 6 tests failed, 28 succeeded. All of the 409 and conflict tests went red,
  so the cross-user replay guard is genuinely tested. It is identical to `mutation-M2-no-owner-check.txt`.
- J2, a new key per attempt (`{ ...body, submitKey: crypto.randomUUID() }`): 3 jest tests failed, 4 passed. These were
  the retry test, the cap test and the FormPanelView lost-ack test. It matches `mutation-J2-new-key-per-attempt.txt`.
- The seam fixture `shared-test-fixtures/panels/form-submit-keyed-request.json` is read by both sides. The jest test
  checks that the client body's keys equal the fixture's keys. The route spec posts the fixture twice and gets 201, then
  200, with one row. So the field name `submitKey` is proven on the wire.
- A seam test that relies on the server reading this exact name would fail at once if the client used another name,
  because the protocol reader rejects unknown keys with `400`.

**No regression of the unkeyed path or the multipart path**
- `appendBuiltRow` keeps its signature and calls the shared action with `stamp = None`, so no lookup or stamp runs.
- The route spec's "unkeyed append 201 x2 = 2 rows" passes, and so does the pre-existing `FormSubmitRoutesSpec`, which is
  part of the 65.
- The multipart path is code-untouched. `DatasetRowTable`'s projection is unchanged, so PUT replace, PATCH and DELETE,
  upsert write-back and engine reads all ignore the new columns.
- No raw `SELECT *` or `INSERT ... SELECT` on `dataset_rows` exists outside V106.

**AC trace (ticket.md)**
- Key scheme: D1 and D5, `submitKey` UUID. Done.
- Same-key duplicate appends no second row: route, repository and RLS specs, guarded by M1. Done.
- No change on the non-duplicate path: the unkeyed specs and the 2-key test. Done.
- Driver-required:
  - Red-first: `red-1`/`red-2`/`red-3` plus the M1 mutation, reproduced. Done.
  - Seam test: the fixture is shared by both sides. Done.
  - RLS parity: no new table. The columns inherit the policy and grants, the RLS spec runs as the NOBYPASSRLS role, and
    my non-BYPASSRLS Flyway probe passed. Done.
  - Schema, client and server in one change: `schemas/panels/form-submit-request.schema.json`, `panel.ts` and the
    protocol all change in this diff. Done.

**UI and design judgment:** skipped. The change has no visual or UI-structure effect: no component markup, style or
token changed. The behaviour change (a silent retry inside the service call) is covered above.

**Gate defect check (CON-160):** none of the reports I drilled into discloses unsound evidence mtimes. No conclusion
here rests on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- D1 accepts an upper-case spelling of a key and canonicalises it, so an upper-case re-send replays. That is harmless and
  by design.
- A same-key re-send with a different body replays the original. This is a documented non-goal, and only the client's own
  retry ever re-uses a key.
- `DataSourceRepository` uses `dsOpt.map(rowToDomain).get` in the replay lookup. It is safe under the lock and the
  existence check, but a `flatMap`/fail with a message would read better.
- The PR body should mention the pre-existing size of `DataSourceRepository.scala` and `DataSourceService.scala`, per
  CONTRIBUTING (the evaluator noted this too).
- Follow-ups already recorded by the planner: a multipart key (Q1), and re-using a key on a manual re-submit after an
  indeterminate failure.
