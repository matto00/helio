## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Gates, re-run fresh by me (all green):**
- `cd backend && sbt test` → `Total number of tests run: 4136` / `Tests: succeeded 4136, failed 0` / `All tests passed.` / EXIT=0
- `npm run lint` EXIT=0; `npm run format:check` "All matched files use Prettier code style!" EXIT=0; `npm run typecheck` EXIT=0
- `npm test` → `Test Suites: 301 passed` / `Tests: 3198 passed` (plus 25/248 root suite), EXIT=0; `npm --prefix frontend run build` EXIT=0

**AC tracing (git diff main...HEAD, full-file reads):**
- AC1 "append adds without disturbing existing rows": `DataSourceRepository.appendRows` is insert-only (no UPDATE/DELETE on `dataset_rows`), seq = `MAX(seq)+1+idx` (fallback -1, so 0-based), all inside `ctx.withUserContext` which is `(setUserVar andThen action).transactionally` (DbContext.scala:50-51). Tests: repo "leaves existing rows' id/seq/data unchanged", "starts at seq 0", "continuing from MAX(seq)" (3,4); route test (3,4, preview length 5). Live probe: POST on 1-row source returned seq 1,2.
- AC2 "replace swaps the full set atomically": `replaceRows` does lock, schema read, validate, and count check, then returns `Left` *before* any DELETE/INSERT; the delete, insert, and schema update run in one transaction. Tests re-read after a rejected mid-batch replace and assert equality with the pre-request set (repo: `after shouldBe before` on rows; route: preview 1..5 unchanged). Live PUT: seq 0,1.
- AC3 "unauthorized caller gets same shape": both routes go `findByIdOwned` → `None` → `ServiceError.NotFound("Data source not found")`, the same branch/message as `delete` (DataSourceService.scala:592-595). Live probe with a random UUID: POST, PUT, and DELETE all returned `{"message":"Data source not found"} [404]`. The route tests seed an other-owner dataset source and get 404 on both verbs.
- 0-based seq: consistent across append (`getOrElse(-1L)+1`), replace (`idx`), V106, and `insertDatasetSource`. The refresh path is behaviour-preserving: the inferred-schema declType changed from `validateAndCanonicalize(col.type)` to `asString(fromString(canonical))`, which is equivalent.

**Concurrency tests: are they genuinely concurrent, and do they prove the lock?** I mutated a scratch copy outside the worktree (`scratchpad/mut/backend`) and never touched the worktree.
- Both Futures are started before `zip`, so they really are concurrent.
- Mutation A (both `<- lockSource(id)` replaced by `DBIO.successful(())`): the append/append, jointly-exceed-limit, and refresh-vs-append tests failed 3 of 3 runs. The cause was `PSQLException: duplicate key value violates unique constraint "dataset_rows_data_source_id_seq_key"`, which is a genuine race. These three tests do guard the lock.
- Mutation B (PUT reads `dataset_schema` *before* taking the lock, plus 300ms sleep): the 5.3b test "replaceRows(None) racing replaceRows(Some) schema change never reverts either write" still passed 3 of 3. A probe println showed the final stored columns were `[{"name":"a"...}]`, meaning refresh's committed schema `b` had been silently reverted. The test cannot catch the bug it names. Control on the real code (4 runs, both lock orders observed: final rows `put-value` and `refreshed`) always ended with columns `[{"name":"b"...}]`. The code is correct and the guard is vacuous. See CR2.

**RLS under the non-superuser role:** RlsOwnerTablesSpec's `ctx` app pool uses `SET ROLE helio_app_test` (NOSUPERUSER, not BYPASSRLS; lines 88-122). The new tests go through `DataSourceService.appendRows/replaceRows` on that pool, so `SELECT ... FOR UPDATE` plus writes under forced RLS are genuinely exercised. An ownerB read of ownerA's rows returns empty. Both new repo methods use `withUserContext` (the user-scoped pool), never `withSystemContext`.

**Response shape vs HEL-1078.** This is where the defect is (CR1). Live probe:
```
POST → {"rows":[{"id":"c742…","seq":1,"updatedAt":"2026-09-11T11:41:04.847706338Z"},…],"updatedAt":"2026-09-11T11:41:04.847706Z"}
PUT  → {"rows":[{"id":"49c7…","seq":0,"updatedAt":"2026-09-11T11:41:04.947540381Z"},…],"updatedAt":"2026-09-11T11:41:04.947540Z"}
psql: SELECT id, seq, updated_at FROM dataset_rows … → 49c7…|0|2026-09-11T11:41:04.947540
```
JDK 21 `Instant.now()` has nanosecond precision here (jshell: `…08.732313013Z`). Postgres `timestamptz` stores microseconds.

UI / design: not applicable. The frontend diff is two service functions and three types, with no view or visual change.

### Verdict: REFUTE

### Change Requests

1. **The per-row `updatedAt` returned by POST/PUT is not the stored value, so the HEL-1078 precondition token does not round-trip.** `DataSourceService.appendRows` and `replaceRows` (and `applyStaticRefresh`) pass `Instant.now()` into the repository. `DataSourceRepository.appendRows`/`replaceRows` build `DatasetRowRow(..., updatedAt, updatedAt)` in memory and return those objects. `RowWriteRowResponse` then serializes the in-memory nanosecond `Instant` (`…947540381Z`) while the DB holds `…947540`. The source-level `updatedAt` in the *same* response is DB-re-read and has 6 fractional digits, so one response carries two different renderings of the same write instant. The v0.8 spec (L126-127, L155) makes the row's `updated_at` the optimistic-concurrency precondition. Any consumer that compares this token against a DB-read value as an `Instant` or string will spuriously mismatch. HEL-1080's grid reading rows through the read path will also see a different version than the write returned. Fix: truncate at the source, e.g. `Instant.now().truncatedTo(ChronoUnit.MICROS)` for the `now` passed by all three service callers, or return `RETURNING`/re-read DB values. Add a test that, for both POST and PUT, asserts each response row's `updatedAt` string equals the DB-read `updated_at` for that row id, and equals the response's source `updatedAt`. That test must fail on the current code (it will: 9 vs 6 fractional digits).

2. **The 5.3b concurrency test (DataSourceRepositorySpec, "a replaceRows(declaration = None) racing a replaceRows(declaration = Some(...)) schema change never reverts either write") is vacuous.** Both schemas have exactly one column, so `finalRows.head … should have size finalColumns.size` holds even when refresh's schema is reverted. Mutation B above proves this: stored columns were reverted to `a` and the test passed 3 of 3. Under either lock order the correct invariant is that the final stored declaration is `newSchema` (a PUT never writes a schema other than the one current at lock time, and refresh sets `b`). Assert `readBack.fields("columns") shouldBe newSchema.toJson`, and assert the final row is one of `["refreshed"]` / `["put-value"]`. Confirm the strengthened test goes red under a pre-lock schema read. Optionally give the two schemas different arity/types so a torn write is also detectable.

### Non-blocking notes

- The refresh-vs-append test (5.3) claims "one consistent, serialized ordering" but asserts only seq uniqueness and `defined`. Consider asserting that both results are `Right` and that the final data is exactly one of `[refreshed-1, refreshed-2]` or `[refreshed-1, refreshed-2, appended]`.
- The route 404 tests assert status only, not body equality with the DELETE/nonexistent 404. The code path is shared and the live probe shows identical bodies, but a body-equality assertion would make AC3 a guarded claim.
- The rejected-replace re-read compares row `data` only, not `id`/`seq`/`updated_at` (the "byte-for-byte" wording overstates it). The code rejects before any write, so this is safe today.
- The RLS cross-owner write refusal is demonstrated through the service ACL (`findByIdOwned`), not by calling `repo.appendRows` as ownerB directly to show RLS alone blocks the write.
- Task 4.2 ("Update the OpenAPI spec (`openspec/`)") is checked, but `openspec/` holds no OpenAPI file (only `config.yaml`). The spec deltas are the contract artifact; the checkbox wording is misleading, not a missing deliverable.
- Under the lock-removed mutation, the jointly-exceed-limit test goes red via the unique constraint, not the count check. The in-lock count check is correct by inspection but not independently guarded.
