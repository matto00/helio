## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `deb53526` + untracked `openspec/changes/row-listing-api/` (ticket.md, proposal.md,
design.md, tasks.md, specs/dataset-row-write-api/spec.md). All conclusions below were checked
against the code, not taken from the artifacts' prose.

### What I verified (with evidence)

- **No new migration needed: confirmed.** V106 creates
  `idx_dataset_rows_data_source_id ON dataset_rows(data_source_id, seq)` and
  `UNIQUE (data_source_id, seq)`. That index serves `WHERE data_source_id=? AND seq>? ORDER BY seq
  LIMIT ?` and `COUNT(*) WHERE data_source_id=?`. The design doesn't plan a migration, and tasks 6.2
  has the right "STOP and ESCALATE" guard.
- **`readDatasetRows` pool and callers: confirmed.** `DataSourceRepository.scala:593-610` runs under
  `ctx.withSystemContext`, and its return shape is `{columns, rows}`. D1's separate-method approach
  keeps it unaffected by construction. `DatasetRowsReaderBehaviorPreservingSpec.scala` already
  exists as a guard.
- **The RLS intent is clear in design.md (D1, D7) and in the spec delta.** `findByIdOwned`
  (`:152-158`) uses `withUserContext` plus an app-level `ownerId ===` filter. `RlsOwnerTablesSpec`
  already has a two-role (`helio_app_test` non-BYPASSRLS / `helio_privileged`) fixture that seeds
  `dataset_rows`, so it can be reused.
- **`updatedAt` convention: confirmed.** Every writer truncates to MICROS
  (`DataSourceService.scala` appendRows/replaceRows/patchRow). Responses use `Instant.toString`
  (`DataSourceProtocol.scala` `RowWriteResponse`, `RowResponse`). PATCH parses with `Instant.parse`
  and compares Instants (`patchRow`'s `r.updatedAt === expectedUpdatedAt`). D4's by-construction
  round-trip claim is sound, and task 4.5 is concrete and correct.
- **seq allocation: this is where the design goes wrong (see CRs 1 and 2).** V106 backfill uses 0-based
  `elem.ord - 1`. `appendRows` uses `maxExistingSeq (default -1) + 1 + idx`, so the first row is 0
  and seq is reused after the max-seq row is deleted. `replaceRows` (PUT **and** refresh) deletes
  every row and re-inserts with `seq = idx` from 0.
- **Checked D5's schema-delivery premise, and it is false (CR 4).** `DataSourceRoutes.scala:101-112`: `path(DataSourceIdSegment)`
  has only `patch` and `delete`, with no authenticated single-source GET. The dataset-kind wire type
  `StaticSourceResponse` (`DataSourceProtocol.scala:82-91`, `:340-347`) carries only
  `inferredSchema`, not the declared `dataset_schema`
  (`DatasetFieldDeclaration{name,fieldType,required,default}`). V106's own header says the declared
  types and the runtime types diverge.
- **Contract targets.** `schemas/sources/` exists and already has `row-response-row.schema.json`.
  No OpenAPI document exists anywhere in the repo (`git ls-files | grep -i openapi` returns nothing,
  and no file contains `"openapi"`).
- **Existing row type.** `RowResponseRow(id, seq, updatedAt, data)` (HEL-1078,
  `DataSourceProtocol.scala`) already has exactly the per-row shape D4 proposes to invent.

### Verdict: REFUTE

### Change Requests

1. **D3 rejects cursor `0`, but seq is 0-based, so a valid `nextCursor` can be rejected.** D3 says
   "An invalid (non-numeric, negative, zero) `cursor` … is rejected with 400". First rows have
   `seq = 0` (V106 backfill `ord - 1`, `appendRows` `-1 + 1`, `replaceRows` `idx`). A page ending
   at seq 0 (for example `limit=1`) returns `nextCursor: 0`, and the next request then gets a 400.
   Revise D3 and task 1.2 so that `cursor >= 0` is valid and only negative or non-numeric values are
   400. `limit <= 0` stays a 400. Add a test to 4.1: `limit=1` from the start, follow `nextCursor=0`,
   and expect 200 with the seq-1 row.

2. **D2's paging-stability argument leaves out `replaceRows` and misstates append semantics.**
   (a) `PUT .../rows` and refresh go through `replaceRows`, which deletes every row and renumbers seq
   from 0. A cursor issued before a replace is then read against a different set of rows: rows
   get skipped or mixed across generations, with no signal. D2 only talks about append and
   delete. It must state what happens across a concurrent replace. Either accept and document it
   (the grid must restart paging if the source's `updatedAt` changes), or detect it. Record the
   decision; don't leave it implicit.
   (b) D2 says appended rows "can only ever appear on a page not yet fetched". That is false: after
   the max-seq row is deleted, the next append reuses that seq (`maxExistingSeq + 1`). The new row
   can then land at or below a cursor the caller already holds, and that caller never sees it. This
   doesn't break the AC (which is about pre-existing rows), but the sentence must be corrected to
   what the code actually guarantees.
   Update the spec delta's paging scenario to match.

3. **`nextCursor` is `null` in D2 but must be omitted per AC #5, and task 4.8 is muddled.** D2
   specifies `"nextCursor": <seq-or-null>`. With spray-json, an `Option[Long] = None` is omitted, not
   emitted as `null`. Decide explicitly: `nextCursor` is absent at end of set. Then make everything
   agree with that decision:
   - the JSON schema: `nextCursor` not in `required` and not nullable
   - the frontend type: `nextCursor?: number`
   - task 4.8: assert the key is absent from the actual serialized response body (not
     `null`), and that the frontend and schema tolerate an absent key.

   Also state the end-of-set rule precisely. With "fewer than `limit` rows ⇒ end", a final page of
   exactly `limit` rows yields a cursor to an empty page. Either accept that (and test it in 4.1) or
   fetch `limit + 1` to detect the end.

4. **D5's premise is false and its wording is a placeholder.** "the existing authenticated source
   GET / whichever route currently returns `datasetSchema`/`inferredSchema`" names no real route.
   There is no authenticated `GET /api/data-sources/:id`. The dataset wire response exposes only
   `inferredSchema`. Nothing on the authenticated surface returns the declared schema (types,
   `required`, `default`) that HEL-1080's grid needs to render and validate edits for HEL-1078's
   PATCH. Re-decide D5 against the real code:
   - include the declared `columns` in this response, or
   - name a concrete existing route and verify that it carries the declared schema, or
   - record an explicit spinoff for HEL-1080.

   Update the Non-Goals and Risks entries to match.

5. **Task 4.4's RLS test can't prove RLS as written.** Through `GET .../rows`, the service's
   `findByIdOwned` applies an app-level `ownerId === ownerUuid` filter and returns 404 before the new
   query runs. Route specs also run on the superuser pool. So "confirm RLS denies the read" through
   the route never reaches RLS. Rewrite 4.4 to require all of the following:
   - (a) A test in the `RlsOwnerTablesSpec` two-role fixture (app pool = `helio_app_test`,
     NOSUPERUSER, non-BYPASSRLS) that calls `DataSourceRepository.listRows` directly as user B on
     user A's seeded dataset source, and asserts zero rows and `total == 0`.
   - (b) A positive control on the same pool: owner A sees the seeded rows with the correct `total`.
     This proves the grants and the `EXISTS` join policy work under a real role, so the negative
     case isn't passing because everything is empty.
   - (c) The same call against the privileged pool returning B's view of the rows, or an equivalent
     contrast, to show the negative result is RLS and not a vacuous query. This replaces the
     unspecified mechanism behind "explicitly assert the query path does NOT use
     `withSystemContext`".
   - (d) Pin in D1 and task 1.1 that `listRows` filters only by `data_source_id` (no owner
     predicate), so RLS is load-bearing and the test is meaningful.

6. **Task 1.1's repository contract is ambiguous, and D7's transaction boundary is unstated.**
   Task 1.1 says the repository "Returns `SourceNotFound` (source missing under this user's ACL)",
   but under RLS a non-owned source's rows just read as empty. The repository can't tell "missing"
   from "empty" without a second lookup, and task 1.2 already assigns 404/400 to the service via
   `findByIdOwned`. Pick one owner for the 404 decision. Also require the page query and the
   `COUNT(*)` to run in one `withUserContext` DBIO (a single transaction), so a response's `rows`
   and `total` come from the same snapshot.

7. **D4 reinvents a type that already exists.** `RowResponseRow(id: String, seq: Long, updatedAt:
   String, data: Vector[JsValue])` from HEL-1078, and its `schemas/sources/row-response-row.schema.json`,
   are exactly the `{id, seq, data, updatedAt}` item D4 describes. D4 only considers `RowWriteRow`
   and rejects it for missing `data`. Either reuse `RowResponseRow` and its schema (`$ref`), or
   justify the new type against `RowResponseRow` specifically. Update tasks 1.3 and 3.1 to match.

8. **Contract tasks point at a file that doesn't exist.** Task 3.2 says "Update the OpenAPI spec
   under `openspec/`", but the repo has no OpenAPI document (the ticket's "OpenAPI" corresponds to
   the openspec spec delta, which HEL-1077/1078 also used). Make 3.1–3.3 name the concrete
   files:
   - the new/updated `schemas/sources/*.schema.json`
   - `specs/dataset-row-write-api/spec.md` as the contract delta
   - `frontend/src/features/sources/services/dataSourceService.ts` and `types/dataSource.ts`

   State in design.md that no OpenAPI file exists, so the evaluator doesn't treat the AC as unmet.

### Non-blocking notes

- Task 4.5: consider using a row whose µs fraction has trailing zeros (`Instant.toString` prints
  `.120` vs `.123456`). Correctness already holds because PATCH compares Instants, but it pins the
  "byte-for-byte" claim.
- Task 4.6: drive the mid-paging append through the real `appendRows` (the seq-allocation path),
  not raw inserts.
- Task 4.7: name `DatasetRowsReaderBehaviorPreservingSpec` as the existing guard instead of
  "whichever already exist".
- tasks.md ends with an empty `## Standing Constraints` heading. Fill it or remove it.
- D3 calls `min`-clamping "matching the existing convention". The existing list route
  (`DataSourceRoutes.scala:80-94`) clamps `limit` but does not reject `limit <= 0`, so D3's
  rejection is a (fine) divergence. Say so.
