## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All six AC rows from the ticket's decided-policy table (add-optional, add-required,
  rename, retype, drop-with-data, reorder) are implemented per design.md Decision 2, and every
  case is covered by a test at the pure-planner level (`DatasetSchemaMigrationSpec`), and the
  drop/rename/bad-type/bad-default/safety-net/concurrency cases are also covered at the
  persistence level (`DataSourceRepositorySpec`) and the HTTP level (`DataSourceRoutesSpec`).
- ACL/not-found reuses `findByIdOwned` (HEL-1002 shape) unchanged; non-dataset-kind source is
  `400`, not `500` — verified by both code and a route test.
- All 28 tasks.md items marked done; none outstanding, none partial.
- No scope creep found — diff is confined to the schema-update route, its supporting domain
  logic, tests, and the contract (schemas/openapi/frontend types+service). No unrelated files
  touched.
- No regressions: `GET /api/data-sources/:id/schema` (`DatasetSchemaResponse`, `jsonFormat1`) is
  verified byte-for-byte untouched, both by inspection (protocol diff shows no edit to that
  formatter) and by a dedicated regression test asserting the GET response's key set is
  `{"fields"}` only.
- Design.md's final wording (post round-5 CONFIRM) matches the shipped code exactly — verified
  independently below (not merely re-read from the design doc).
- No non-retired `CONSTRAINTS` entries in `workflow-state.md` were found to conflict with this
  diff.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (fresh run, this cycle, in `WORKTREE_PATH`, not `CLEAN_WORKTREE`):**
- `sbt test`: 4246 tests, 0 failed, 277 suites (fresh full run, ~5m).
- `npm run lint`: clean (zero-warnings).
- `npm run format:check`: clean.
- `npm test` (frontend + helio-mcp): 3298 + 248 tests, 0 failed.
- `npm --prefix frontend run build`: succeeds.
- `node scripts/check-schema-drift.mjs`: in sync (95 protocol/schema pairs).

**Targeted verification of the specific risk areas called out for this review:**

1. **"Touched" gate (round-4 defect class) — independently re-derived from the code, not
   trusted from the design doc.** `DatasetSchemaMigration.planField` computes
   `touched = added || retyped || requiredChanged || defaultChanged` and gates the
   default-substitution/required-check step on it exactly as Decision 2 Step C step 2 specifies;
   an untouched field's step-1 candidate is returned unmodified with no substitution and no
   required check, regardless of its `required` flag or nullness. Verified against
   `DatasetSchemaMigrationSpec`'s "4.2e round-4 touched gate" tests: a rename-only edit on a
   field whose `default`/`required` are resubmitted unchanged leaves a pre-existing `JsNull`
   cell exactly as-is (test asserts the exact migrated row), contrasted with a genuinely-touched
   case (required flips) that does backfill. The same property is re-proven against the real
   persisted rows in `DataSourceRepositorySpec` ("a successful rename-only edit never backfills
   an untouched null cell", task 4.12b) — not just the pure planner.

2. **AC edit-case coverage** — every allowed/rejected case has a real test, including against a
   non-empty dataset: add-optional (trailing + non-trailing insert), add-required
   (default-backfill success / no-default 409), rename (rowsMigrated 0), retype (success /
   409-naming-count / null-exempt), drop-with-data (409 without confirmDrop even when
   all-null / success with confirmDrop), reorder (full row rewrite), required-tightening
   (success-no-default-needed / backfill / 409), plus the round-3-flagged interaction cases
   (retype+required together, required-default-removed). Structural 400s (bad `previousName`,
   duplicate `previousName`, duplicate `name`, rename-onto-a-dropped-name, chained-rename
   allowed) are each independently tested. HTTP-layer smoke tests independently confirm status
   codes (`200`/`400`/`404`/`409`) and response shapes.

3. **RLS test** — confirmed genuine, not merely asserted: `RlsOwnerTablesSpec`'s new
   `updateDatasetSchema` test reuses the file's existing `helio_app_test` role (`NOSUPERUSER
   ... NOLOGIN`, `SET ROLE` via `setConnectionInitSql`, confirmed in the harness setup code,
   not just a comment) and follows the (a)/(b)/(c) shape: (a) non-owner repository call denied
   (`None`), (b) owner positive control succeeds, (c) a RAW non-owner `UPDATE` directly against
   `dataset_rows` (bypassing the service/repository) affects 0 rows under the non-BYPASSRLS
   role, contrasted with the same raw query on the privileged (`withSystemContext`) pool
   affecting 1 row — proving `dataset_rows`' own policy, not merely `data_sources`' existence
   check, does the denying. Plus a byte-identical check on the true owner's rows afterward.

4. **Concurrency test** — genuine overlap, not two sequential calls: a `CountDownLatch(2)`
   barrier forces both the schema-edit `Future` and the row-append `Future` to block until both
   have started, then each independently blocks on the DB lock; asserted both succeed and the
   final row count/schema are consistent regardless of which order the lock serialized them in.
   This is a real race against real DB connections, not a fabricated ordering.

5. **Decision 8 final re-validation is pass/fail-only** — confirmed by reading
   `persistMigrationAction`: on `DatasetRowValidator.validate(...)` returning `Left`, it throws
   (aborting the transaction) rather than returning a value; on `Right`, it discards the
   returned vector entirely and persists `migration.migratedRows` (Step D's own output)
   unchanged. `DataSourceRepositorySpec`'s dedicated safety-net test bypasses `plan` via the
   `private[sources] applyMigrationForTest` entry point with a deliberately inconsistent
   `MigrationResult` and asserts a full rollback (both `dataset_schema` and `dataset_rows`
   unaffected).

6. **`GET` response untouched** — confirmed: `datasetSchemaResponseFormat` (`jsonFormat1`) has
   no diff; `DatasetSchemaUpdateResponse` is a wholly new, hand-rolled-adjacent (`jsonFormat2`)
   type. A dedicated regression test pins the GET response's JSON key set to exactly
   `{"fields"}`.

7. **Contract landed and is consistent**: five new `schemas/sources/*.schema.json` files exist,
   are referenced correctly (`$ref` to the existing `dataset-field-response.schema.json`),
   and pass `check-schema-drift.mjs` (95 protocol/schema pairs in sync). Frontend
   `dataSource.ts`/`dataSourceService.ts` add matching new types and a
   `updateDatasetSchema()` client function; `DatasetSchemaResponse` is explicitly left alone in
   both frontend and backend. `openspec/changes/.../specs/dataset-schema-api/spec.md` exists as
   the proposed capability delta.

8. **Migration V107** — genuinely not needed: `dataset_schema`/`dataset_rows` (V106) already
   support arbitrary declarations and positional arrays; the diff contains no
   `V107__*.sql` file, matching design.md Decision 9's expectation and `files-modified.md`'s
   explicit statement. Confirmed by `git diff --stat` showing no migration-directory changes.

**Code-quality (CONTRIBUTING.md, mechanical rules):**
- No inline fully-qualified names introduced (imports are used throughout the new/changed
  files).
- No dead code / unused imports found in the diff.
- Errors handled at boundaries (`400`/`404`/`409`/`500` mapped distinctly; Decision 8's internal
  bug case correctly surfaces as `500`/`IllegalStateException`, not silently swallowed).
- No untyped escape hatches (`asInstanceOf[JsArray]` in the repository mirrors the pre-existing
  pattern used elsewhere in the same file for row storage, not new territory).
- `DatasetSchemaMigration` is DB-free/pure as designed — good separation of domain logic from
  infrastructure (Decision 4's own design intent), independently testable, which the test suite
  exploits.

### Phase 3: UI Review — N/A
No UI-affecting route/component ships in this ticket. `frontend/**` changes are limited to a new
service function and type declarations (no consuming component yet — matches the ticket's "blocks
HEL-1079" framing, i.e. the consuming UI is out of scope for this ticket). `ApiRoutes.scala` was
not touched directly (route lives in the pre-existing `DataSourceRoutes.scala` composition), and
no `openspec/specs/**` capability spec files (as opposed to the change's own proposed delta) were
modified. Triggers not met beyond the schema/contract files already covered under Phase 1/2.

### Overall: PASS

### Non-blocking Suggestions
- None of substance. The implementation matches design.md Decision 2 precisely, including the
  specific "touched"-gate defect class the ticket asked to be scrutinized, and every requested
  scrutiny point (1-8) checked out independently against the code and fresh gate runs.
