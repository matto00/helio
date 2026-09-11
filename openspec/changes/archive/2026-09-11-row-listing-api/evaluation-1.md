## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `0e574897344bcdcdbfe5e75450a2579cd3c69357` ("HEL-1121 Add GET /api/data-sources/:id/rows row listing API"), diffed against base `deb53526ea3b37e50cb7924d5cfd81b3f8e570ad` (resolved live via `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS

- All ticket ACs addressed: paging with cursor+total+cap (AC1), ACL/RLS-scoped access with matching 404 shape (AC2), byte-for-byte `updatedAt` round-trip (AC3), wrong-kind rejection (AC4), contract updated in the same commit (AC5).
- No AC silently reinterpreted; the driver's own "critical verification requirements" (RLS, round-trip, concurrent-append paging, no-regression, spray-json Option-absence) are each independently addressed by a dedicated, non-trivial test (verified below in Phase 2).
- All `tasks.md` items 1–6 are checked and match the diff exactly; task 7.1 is correctly left unchecked (explicitly deferred to Delivery, per the task's own text).
- No scope creep: diff touches only the listed files (repo/service/protocol/route + schema + 2 frontend files + tests + planning artifacts). No modification to `readDatasetRows`, `patchRow`, `deleteRow`, `appendRows`, `replaceRows`, or any write-side row route.
- No regression: `readDatasetRows`'s `{columns, rows}` shape is untouched (confirmed via diff — zero lines changed in that method) and a repository test explicitly re-asserts its shape after `listRows` is exercised (`DataSourceRepositorySpec.scala`, "readDatasetRows's {columns, rows} shape is unchanged...").
- Contract: `schemas/sources/row-list-response.schema.json`, `frontend/src/features/sources/types/dataSource.ts` (`RowListResponse`), and `frontend/src/features/sources/services/dataSourceService.ts` (`fetchSourceRows`) all landed in the same, single commit as the backend change. Confirmed no OpenAPI file exists in this repo (task 3.2's own finding, re-verified: `find . -iname 'openapi*.y*ml'` → none).
- Planning artifacts (design.md D1–D7) reflect the final implemented behavior — verified line-by-line against the diff (see Phase 2 below); no drift found.
- No non-retired `workflow-state.md` CONSTRAINTS entries apply beyond what's already covered above (repo uses the standard Iron Laws set; nothing repo-specific pending for this ticket).
- No migration created; confirmed correct — `idx_dataset_rows_data_source_id (data_source_id, seq)` (V106) already supports the query shape (`WHERE data_source_id = ? [AND seq > ?] ORDER BY seq LIMIT ?`) with no `OFFSET`. Diff contains zero files under `db/migration/`.

### Phase 2: Code Review — PASS

**Gates run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` requested for this cycle):**
- `sbt test` (backend, full suite): **4180 tests, 0 failures** (5m30s).
- Targeted re-run of the four HEL-1121-touched specs (`RlsOwnerTablesSpec`, `DataSourceRepositorySpec`, `DataSourceRoutesSpec`, `DataSourceProtocolSpec`): **214 tests, 0 failures**.
- `npm run lint` (zero-warnings ESLint): clean.
- `npm run format:check`: clean.
- `npm test` (frontend Jest, full suite): 301 suites / 3198 tests, all pass.
- `npm --prefix frontend run build`: succeeds.
- `node scripts/check-schema-drift.mjs`: schemas in sync (88 protocol surfaces checked, including the new one).

**Six critical-verification items, individually re-checked against the diff (not the executor's report):**

1. **RLS test genuinely exercises `dataset_rows_owner`.** `RlsOwnerTablesSpec.scala` adds a case with pinned outcomes (a)-(d): (a) non-owner direct `repo.listRows` call → `None` (app-level ACL, doesn't reach `dataset_rows`); (b) owner positive control; (c) — the load-bearing one — a **raw SQL** `SELECT id FROM dataset_rows WHERE data_source_id = ?` run under `ctx.withUserContext(ownerB.value)` (non-owner, non-BYPASSRLS role) pinned to return **zero rows**, contrasted with the identical raw query under `ctx.withSystemContext` (privileged pool) pinned to return the real row. This is a genuine RLS-policy exercise, not an application-level 404 check. `DataSourceRepository.listRows` itself (`DataSourceRepository.scala`) runs its entire `DBIO` action — including the row query — inside `ctx.withUserContext(user.id.value)(action)`; it never calls `ctx.withSystemContext`. Confirmed by direct read of the method body.
2. **Round-trip test uses the GET JSON body's `updatedAt` verbatim.** `DataSourceRoutesSpec.scala`'s "a row's updatedAt as returned by this endpoint round-trips into a successful PATCH precondition" test does `responseAs[RowListResponse].rows.head` and takes `row.updatedAt` — the deserialized field is populated directly from the wire JSON string (`RowResponseRow.updatedAt: String`, no re-derivation from a DB `Instant`) — then interpolates that exact string into the PATCH body and asserts `200`. Confirmed this is the JSON-body value, not a raw DB read: `RowListResponse.fromDomain` builds `RowResponseRow(r.id, r.seq, r.updatedAt.toString, ...)` in the protocol layer, and the test only ever reads the `responseAs[...]`-deserialized field, never touches the DB directly for the timestamp.
3. **Concurrent-append paging-stability test drives real `appendRows` mid-paging.** `DataSourceRepositorySpec.scala`'s "listRows paging is stable under concurrent appends" test: pages a 4-row source with `limit=2`, fetches page 1 (`seq 0,1`), then calls `repo.appendRows(id, ..., user1)` for real (two new rows) between fetches, then fetches page 2/page 3 and asserts the original four rows (`0,1,2,3`) come back exactly once each, in order, with no duplicate. Genuine, not simulated.
4. **`readDatasetRows` and its three callers provably unchanged.** Diff `--stat` shows zero lines touched in `readDatasetRows` (only the new `listRows` method + `RowListPage` case class were added, both physically separate). No file under the pipeline engine, Spark submitter, or preview path appears anywhere in the diff. A dedicated regression test additionally re-asserts the `{columns, rows}` shape and content are unchanged after `listRows` is exercised against the same source.
5. **spray-json Option-absent test checks raw JSON, not a deserialized `None`.** Both `DataSourceProtocolSpec.scala` ("omits the nextCursor key entirely when None") and `DataSourceRoutesSpec.scala` ("omits the nextCursor key entirely from the raw JSON body...") parse to `JsObject`/`JsValue` and assert `.fields.contains("nextCursor") shouldBe false` — never merely deserializing to a case class and checking `.nextCursor == None` (which would mask a null-emission bug, as the task correctly anticipates). A companion test also asserts the `Some` case serializes as a raw `JsNumber`, not a nested wrapper.
6. **Contract landed atomically.** `schemas/sources/row-list-response.schema.json`, `frontend/.../dataSource.ts`, and `frontend/.../dataSourceService.ts` (`fetchSourceRows`) are all part of the single commit `0e574897`, alongside the backend change — confirmed via `git log --oneline` showing exactly one commit on this branch.

**Other code-quality checks:**
- No inline fully-qualified names in the touched backend files (grepped; only `package` lines match `com.helio.`).
- DRY: `RowResponseRow` reused verbatim per D4, no duplicate per-row type invented. `Page.MaxLimit`/`Page.Default.limit` reused per D3, no new constant.
- Type safety: no untyped escape hatches; `parseCursor`/`parseLimit` return `Either[String, T]`, no exceptions leak.
- Error handling: malformed input rejected with 400 before any DB call (verified live via manual curl below); `SourceNotFound` and kind-mismatch handled at the correct precedence (D6), matching a targeted route test.
- No dead code / no leftover TODOs in the new code.
- No over-engineering: `listRows` is a small, single-purpose addition; no premature abstraction introduced.
- Design doc D1–D7 decisions (separate method, keyset cursor, `Page.MaxLimit`/default reuse, `RowResponseRow` reuse, declared-schema gap explicitly deferred, precedence order, two-layer existence check with no `lockSource`) all match the shipped code exactly — spot-checked against the diff.

### Phase 3: UI Review — PASS (light-touch, justified)

Trigger matched (`schemas/**` and `frontend/**` changed), so this phase was run rather than skipped, but the change adds no UI consumer (design.md D5/Non-Goals: HEL-1080 is the future consumer; this ticket only adds a typed service function with no caller). Accordingly the "happy path / entry points / breakpoints" checklist items are not meaningfully exercisable from the UI yet; verified instead via the live backend (frontend build/lint/tests already gate the TS surface):

- Started servers via canonical `start-servers.sh` / `assert-phase.sh servers` (both `READY`/`PASS`).
- Logged in as the dev account, created a real dataset source, and called `GET /api/data-sources/:id/rows` live: returned exactly the paged shape design.md specifies (`nextCursor`, `rows[].{id,seq,data,updatedAt}`, `total`), matching the JSON schema.
- Confirmed malformed `cursor=abc` returns `400` with a clear message, live, before any DB call.
- No console errors possible to attribute to this change since no frontend code path invokes it yet; `npm test`/`npm run build` (already run in Phase 2) are the only currently-exercisable frontend surfaces and both pass clean.
- Breakpoint/accessibility/loading-state checks: N/A — no rendered UI exists for this endpoint yet (by design, per D5/Non-Goals).

### Overall: PASS

### Non-blocking Suggestions

- None beyond what's already tracked: task 7.1's declared-schema gap (`GET /api/data-sources/:id` doesn't exist) is correctly flagged as a Delivery-phase follow-up ticket, not something this ticket should solve.
