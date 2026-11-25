## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c33f9b16f29ffe6f40dc308b251bfe3f0afdd3ac` against the live-resolved base `cb287223d10c5451d3ebb2045bd872f88dfb376a`
(`resolve-review-base.sh`, merge-base with origin/main). origin/main has since gained HEL-1707 and HEL-1517 (no
migration and no overlapping file: V148 is still the newest migration on origin/main, so V149 does not collide).

### Phase 1: Spec Review — FAIL

All checks pass except one: the planning artifacts do not describe what was built.

- Ticket AC: covered. The key scheme is `submitKey` (D1). A same-key re-send appends no second row: route spec,
  repository spec, RLS spec, and the live HTTP and browser runs below. Unkeyed behaviour is unchanged: route spec and
  live run.
- Driver AC:
  - Red first. `red-1` shows the route spec red with 8 failures. `red-3` shows the service, repository and RLS specs
    failing to compile. Mutation M1 (drop the lookup) turns 9 tests red.
  - Seam test: see Phase 2.
  - RLS parity: see Phase 2.
  - Schema, client and server are all in the one commit.
- Spec delta: both MODIFIED headers match the main spec. The ADDED requirements match the implementation, including
  the upper-case spelling of a key replaying (D1 compares the input lower-cased).
- Scope: no creep. The diff touches no HEL-1707 or HEL-1517 file, and the migration is additive only (C6).
- CONSTRAINTS C1-C6 are honoured in the diff.
- **Planning artifacts diverge from the implementation (CR1):**
  - `design.md:63-64` (D4) still specifies a `FormAppendOutcome(write, replayed)` wrapper, and a third constructor
    field `FormSubmitResult(write, writerIsFormOwner, replayed)`.
  - `tasks.md:27` (2.6) is ticked as "Thread replayed via FormAppendOutcome -> FormSubmitResult".
  - Neither exists. The flag is `RowWriteResult.replayed: Boolean = false`
    (`DataSourceService.scala:1493`), and `FormSubmitResult.replayed` is a derived `def`
    (`FormSubmitResult.scala:7-10`).
  - D3/1.2 say `appendBuiltRowAction` "gains `key`". The implementation adds a new public `appendBuiltRowKeyed`, and
    the `lookupFirst` test seam sits on the private action. `appendBuiltRow` keeps its old return type.

**Judgment on the D4 deviation itself:** acceptable. There is no wire leak:
- `RowWriteResponse.fromDomain` (`DataSourceProtocol.scala:322-328`) builds the data-source row-route responses field
  by field and never reads `replayed`.
- `FormSubmitResponse.fromDomain` (`FormSubmitProtocol.scala:18-25`) also lists its fields explicitly. The live
  `200` replay body has exactly `deniedPipelines`, `rows` and `updatedAt`.
- `appendRows` and `replaceRows` always build `RowWriteResult` with the default `false`.

A form-only flag on a shared result type is a small modularity cost, not a defect. The only problem is that the
artifacts do not record the deviation.

### Phase 2: Code Review — PASS

**Gates, run fresh by me in `WORKTREE_PATH`** (after `cd frontend && nice -n 19 npm ci`):

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `frontend npm run typecheck` | exit 0 |
| root jest | 76 suites, 683 tests passed |
| frontend jest, 3 shards (`--shard=k/3`, 3 workers, `nice -n 19`) | 945 suites, 10929 tests passed (315+315+315 suites; 3585+3384+3960 tests); matches the executor's totals |
| `npm --prefix frontend run build` | exit 0 |
| `npm run check:scala-quality` | clean (soft size warnings only) |
| `check:schemas` | in sync |
| `check:openspec` | clean |

Backend, with `sbt -J-Xmx3g` under `nice -n 19`, in two `testOnly` runs:

1. 24 targeted suites: the 3 new or extended HEL-1175 specs, FormSubmitRoutes/EditorRoutes, FormSubmission,
   V119OwnerFkMigration/Guard/Cleanup, FlywayNonSuperuserMigration, RlsOwnerTables, RlsPolicyGuard,
   PatchSetUndo(Inline)DatasetLaterWork, PanelFormFileSubmissionFailedAppend, DataSourceRepository/Routes, V106,
   CounterEventRowModel, DashboardApplyProposalFormSeam, AutoRunDebounceWriterAttribution, DatasetWriteSubmitLatency,
   RowWriteResponseDenyReasonCoverage, DataSourceServiceDeniedPipelines. Result: **579 passed, 0 failed**. The 3
   cancels are the opt-in `HELIO_MEASURE` latency reports.
2. Every suite in `com.helio.api.routes.panels.*`, `com.helio.services.panels.*`, `com.helio.services.sources.*`,
   `com.helio.infrastructure.persistence.sources.*` and `com.helio.api.protocols.*`: 97 suites, **1190 passed, 0
   failed**. The `hel1468-guard` summary reads failed=0, aborted=0, unreadable=0.

I did not re-run the other roughly 9,300 tests of the full suite. The executor's 4-shard totals (10482 passed) are
consistent with the main-code surface, and every caller of the changed signatures is in the suites I ran.

**Executor claims I verified:**
- **5.8 red for the right reason.** I applied mutation J1 (no retry) in a throwaway detached worktree at c33f9b16f,
  under the lane scratch dir, with hardlinked node_modules; it was removed afterwards. Result: 3 failed, 4 passed.
  The lost-ack test fails with "Expected number of calls: 2, Received: 1", which is the missing retry and not the
  fixture. The other two failures are the two retry unit tests. This matches `mutation-J1-no-retry.txt`.
- **Every guard has a mutation that turns it red:**

  | Guard | Mutation | Tests turned red |
  | --- | --- | --- |
  | Lookup | M1 | 9 |
  | Same submitter and panel check | M2 | 6, including both delete cases |
  | 23505 constraint-name filter | M3 | the seq test |
  | Replay side effects | M4 | the audit test and the RLS debounce test |
  | Retry | J1 | reproduced above |
  | Key reused across attempts | J2 | 3 |

- **RLS parity.** `FormSubmitEditorRlsSpec` runs its app pool as `helio_app_test` with `SET ROLE` (created
  NOSUPERUSER, so it is NOBYPASSRLS by default), and the privileged pool as `helio_privileged`.
  - It covers:
    - keyed append by an editor into the owner's source;
    - replay with no second row, no debounce row and no `seq`;
    - a different submitter getting a conflict;
    - panel delete, where the row survives, `submit_panel_id` is NULL and the key then conflicts;
    - user delete, where `submit_user_id` is NULL and the key then conflicts.
  - Everything passed in my run.
  - The migration path is covered by `FlywayNonSuperuserMigrationSpec` and `V119OwnerFkGuardSpec`, which migrate as a
    NOSUPERUSER NOBYPASSRLS table-owning role through V149. Both passed in my run.
  - The migration needs no grant: there is no new table, and the added columns inherit `dataset_rows`' table-level
    grants and policy.
- **Seam.**
  - `shared-test-fixtures/panels/form-submit-keyed-request.json` is posted verbatim through the real route twice
    (201, then 200, one row) in `FormSubmitIdempotencyRoutesSpec`.
  - The jest test asserts that the client's body has exactly the fixture's key set, with `submitKey` a UUID.
  - The live browser capture shows the client sends `"submitKey"`.

**Code checklist:**
- Canonical rules: clean. No inline FQN, and quality and lint are clean. `DataSourceRepository.scala` (1349 lines)
  and `DataSourceService.scala` (1524 lines) were already far over the soft budget before this change (+58 and +28
  lines here).
- Security:
  - The key is strictly validated (canonical UUID).
  - The 409 names no row, seq or user.
  - The replay is masked for a non-owner.
  - The raw SQL is fully parameterised.
- Error handling: only SQLSTATE 23505 on `ux_dataset_rows_submit_key` is mapped, and it is recovered after rollback
  in the Future, never with `asTry` inside the transaction.
- Concurrency: the lookup runs inside `lockSource`, so same-source requests are serialised.
- Behaviour preservation: the unkeyed path goes through the unchanged `appendBuiltRow` (re-wrapped), and the
  multipart path passes no key.
- Tests are meaningful, and each is failable by mutation (above).

### Phase 3: UI Review — PASS

Setup:
- Servers were started with `start-servers.sh` on 6607/9514 with `DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1175`,
  `DB_USER=$USER` and `ANTHROPIC_API_KEY=` in the same command. `assert-phase.sh servers` printed PASS.
- Flyway migrated the empty lane DB cleanly ("Successfully applied 145 migrations ... now at version v149").
  `dataset_rows` is still RLS and FORCE RLS, and all 3 new indexes are present.
  - The lane role is a superuser, so the non-BYPASSRLS migration proof is the two specs named above, not this run.

Over HTTP (curl, persisted at `/home/matt/Development/helio/.concertino/runs/HEL-1175/evidence/.concertino/scratch/HEL-1175/eval-http-out.txt`):

| Request | Status |
| --- | --- |
| Keyed counter submit | 201 |
| Same key re-sent | 200, same row id and seq |
| Same key through another panel | 409, fixed message |
| `"nope"` key | 400 |
| Two unkeyed submits | 201, 201 |
| Plain form keyed, then the same key re-sent | 201, then 200 |
| Plain form unkeyed | 201 |

- Rows: 3 counter and 2 form, with stamps only on the keyed rows.
- Audit `data_source.rows.append` count is 5, one per append. The replays recorded none.

In the browser (Playwright MCP, page on port 6607, no open dialog):
- A counter click and a plain form submit each sent a fresh `submitKey`. Both showed "The row was added.", with no
  alert and no console errors.
- **Live lost-ack test.** I patched `XMLHttpRequest.send` in the page. The first submit was delivered by `fetch` (it
  committed: 201), and the XHR was then failed with no response.
  - The client retried with the identical body and key, and got 200.
  - The counter moved from 20 to 25, one step, with no alert.
  - The DB holds exactly one row for that key.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1175/evidence/.concertino/scratch/HEL-1175/eval-1-live-lost-ack.txt`.

Breakpoints: no markup or CSS changed. A 390x844 check rendered the counters and the form without breakage.

Cleanup:
- The test user was deleted by exact id via `buildUserDeleteSql` (0 rows remain).
- Servers were stopped with `stop-servers.sh`, and no listener remains on 6607 or 9514.
- No java or node process is rooted in the worktree.

### Overall: FAIL

### Change Requests
1. Make the planning artifacts match the code. Either change is acceptable as the fix.
   - Option A: edit the text.
     - `design.md` D4 (lines 62-64): replace the `FormAppendOutcome(write: RowWriteResult, replayed: Boolean)` wrapper
       and `FormSubmitResult(write, writerIsFormOwner, replayed)` with what shipped. That is
       `RowWriteResult.replayed: Boolean = false`, set only by `appendFormRow`'s replay branch, and
       `FormSubmitResult.replayed` as a `def` delegating to `write.replayed`. State why there is no wire exposure:
       `RowWriteResponse.fromDomain` and `FormSubmitResponse.fromDomain` list their fields explicitly.
     - D3 (line 45): say the keyed path is the new `appendBuiltRowKeyed` over the private `appendBuiltRowAction(...,
       stamp, lookupFirst)`, and that the unkeyed `appendBuiltRow` keeps its return type.
     - `tasks.md` 2.6 (line 27) and 1.2 (line 15): reword to match.
   - Option B: implement `FormAppendOutcome` as designed.

   No code change is required for this CR.

### Non-blocking Suggestions
- Add the failing test names to `evidence/mutation-J1-no-retry.txt` and `mutation-J2-new-key-per-attempt.txt`.
  Today they hold only a count line. I reproduced J1, and the names are the three listed in Phase 2.
- `DataSourceRepository.scala:193` of the diff (`lookup`) has `dsOpt.map(rowToDomain).get`. It is safe because the
  source was read under the same lock, but `.result.head` on the source query, or a fold, would read more plainly.
- In the PR description, note the pre-existing size of `DataSourceRepository.scala` and `DataSourceService.scala`, per
  CONTRIBUTING's "propose a split" rule.
