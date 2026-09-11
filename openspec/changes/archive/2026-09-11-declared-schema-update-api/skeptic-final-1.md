## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit: `9a9ec0b606c75c971852945f1b16a6a24ae28ae3`
Live-resolved review base: `4e313d49b83fed424217cbb7d44b87fab4e2b754` (via `resolve-review-base.sh`, exit 0)

Every conclusion below is derived from the actual diff, the actual files, and gate runs I
executed myself. The evaluator's PASS and the design's CONFIRM were read only as claims.

### What I verified (with evidence)

**1. The "touched" gate is genuinely in code, and matches Decision 2 exactly.**
`DatasetSchemaMigration.scala:124-127`:
```scala
val added           = oldIndexOpt.isEmpty
val requiredChanged = oldFieldOpt.exists(_.required != edit.required)
val defaultChanged  = oldFieldOpt.exists(_.default != edit.default)
val touched         = added || retyped || requiredChanged || defaultChanged
```
This is the design's definition verbatim (added OR retyped OR `required` differs from the OLD
declaration OR `default` differs from the OLD declaration). Line 130 `if (!touched) step1` skips
substitution entirely, and the `required` rejection at line 133 is itself gated on `touched` — so
an untouched field carrying a pre-existing `JsNull` is neither backfilled nor rejected, which is
precisely the round-4 property. `retyped` (line 107) is computed from the OLD type, not the
payload, so a retype cannot masquerade as untouched. The comparison is against
`oldFieldOpt`/`oldDeclaration`, i.e. the OLD declaration — not the submitted payload — which is
the specific mistake the gate exists to prevent.
Covered by tests at `DatasetSchemaMigrationSpec.scala:164-190` (the untouched-resubmitted-default
case AND an explicit touched contrast case), and again past the real DB write in
`DataSourceRepositorySpec.scala` ("a successful rename-only edit never backfills an untouched null
cell", asserting the persisted rows are `[["x", null]]`).

**2. Decision 8's persisted rows are Step D's own output, never `validate`'s `Right(_)`.**
`DataSourceRepository.persistMigrationAction`: on `Left` it returns `DBIO.failed(...)` (aborting
the transaction); on `Right(_)` it discards the payload — the binding is `case Right(_) =>` — and
builds `newRows` from `migration.migratedRows`, i.e. Step D's vector. There is no path where
`validate`'s returned vector reaches the write. The safety-net test drives
`applyMigrationForTest` with a deliberately inconsistent `MigrationResult` (required integer field
paired with a `JsNull` row), asserts the throw, and then asserts BOTH `dataset_schema` and
`dataset_rows` are unchanged — a genuine rollback assertion, not just an exception assertion.

**3. The RLS test is genuinely non-superuser/non-BYPASSRLS and proves `dataset_rows`' own policy.**
`RlsOwnerTablesSpec.scala:98` creates `helio_app_test` as `NOSUPERUSER NOCREATEDB NOCREATEROLE
NOLOGIN`, and line 120 wires the app pool via `setConnectionInitSql("SET ROLE helio_app_test")` —
so `withUserContext` genuinely runs under a non-BYPASSRLS role. The new HEL-1124 block
(lines 644-706) has all three legs, and leg (c) is the load-bearing one: a **raw**
`UPDATE dataset_rows ... ` as the non-owner asserts `rawUpdateAsNonOwner shouldBe 0`, contrasted
with the same statement on the privileged pool asserting `shouldBe 1`. Because this raw statement
never touches `data_sources` at all, the denial cannot be attributed to `data_sources`' existence
-check policy — it is `dataset_rows`' own policy. Leg (b) is a real positive control (the owner's
edit succeeds under the same role), and the block closes by asserting the true owner's rows are
byte-identical (`Vector("[\"orig\"]")`).

**4. The concurrency test genuinely races two overlapping executions.**
`DataSourceRepositorySpec.scala`: a `CountDownLatch(2)` barrier — each `Future` calls
`countDown()` then `await(...)`, so neither proceeds until both have started; the two operations
then contend on real DB connections. This is overlap by construction, not two sequential calls.
Assertions hold under either serialization order (final row count 2, schema consistent), which is
the correct way to assert a race whose ordering is not deterministic.

**5. `GET /api/data-sources/:id/schema`'s response shape is unchanged.**
Diffing the `DatasetSchemaResponse` / `DatasetFieldResponse` definitions and their formatters
between the base and HEAD yields only line-number shifts (+29) and newly-added *comment* lines
that happen to mention the type name; the declarations themselves are textually identical,
including `datasetSchemaResponseFormat = jsonFormat1(DatasetSchemaResponse.apply)`. The PATCH
`200` is a separate `DatasetSchemaUpdateResponse`. A route-level test also re-reads the schema via
`GET` after a PATCH and gets the expected `DatasetSchemaResponse`.

**6. Acceptance criteria, traced individually.**
- *"A route updates the declared schema, reusing the existing ACL and the HEL-1002 not-found
  shape."* — `DataSourceRoutes.scala` adds `patch` inside the existing
  `path(DataSourceIdSegment / "schema")` block (same `pathPrefix`/auth/rate-limit composition, no
  new wiring); `DataSourceService.updateDatasetSchema` gates on `findByIdOwned` → `None` ⇒
  `ServiceError.NotFound("Data source not found")`, and non-dataset kind ⇒ `400`. Route tests
  cover 200/400/409 and the non-dataset-kind 400.
- *"Each allowed and rejected edit is covered by a test, including an attempt against a non-empty
  dataset."* — `DatasetSchemaMigrationSpec` (359 new lines) covers the full six-case rubric plus
  the interaction cases (retype+required-tighten, default-removal, chained rename, rename/drop
  collision, `rowsMigrated` semantics); the drop-with-data and rename cases are additionally
  exercised against non-empty datasets at both the repository and route levels.
- *"Exercised under a non-superuser, non-BYPASSRLS role."* — item 3 above.
- *"Contract (`schemas/`, OpenAPI, frontend service types) in the same PR."* — five new
  `schemas/sources/*.schema.json`; the OpenSpec capability delta at
  `openspec/changes/declared-schema-update-api/specs/dataset-schema-api/spec.md`, which targets
  the **existing** `openspec/specs/dataset-schema-api` capability (I confirmed that capability
  exists — this repo's "OpenAPI" surface is OpenSpec, and an in-flight change correctly carries
  its delta in the change dir until archive); and frontend `dataSource.ts` /
  `dataSourceService.ts` types + client function. I verified the wire shapes agree across all
  three layers (notably `default`'s `Option[Option[JsValue]]` idiom: the hand-rolled Scala
  formatter distinguishes absent from explicit-null, the JSON Schema documents exactly that, and
  the TS type marks `default?: unknown`).
- *"Blocks HEL-1079."* — no code obligation.

**7. Gates re-run by me, fresh (not taken from the evaluator):**
```
Tests: succeeded 280, failed 0, canceled 0, ignored 0, pending 0   (5 suites, exit 0)
npm run typecheck        EXIT=0
eslint (changed files)   EXIT=0   --max-warnings=0
prettier --check         EXIT=0   "All matched files use Prettier code style!"
npm run check:schemas    EXIT=0   "schemas in sync with JsonProtocols (95 checked across 49 protocol files)"
check:spec-structure     EXIT=0   "382 canonical specs, 0 issues"
check:openspec           EXIT=0   "openspec/ is clean"
check:scala-quality      EXIT=0   "clean (164 soft warning(s))"  [pre-existing soft warnings only]
check:repo-integrity     EXIT=0
```
All 28 checklist items in `tasks.md` are checked, with zero unchecked items.

**8. No UI review applicable.** `frontend/**` changes are a type module and a service function
only — no component, no stylesheet, no route renders anything new. Nothing to judge visually, so
the design-standard/theme-parity step does not apply to this diff. I did not start the dev servers
for this reason.

### Verdict: CONFIRM

### Non-blocking notes
- `evaluation-1.md` item 6 states "A dedicated regression test pins the GET response's JSON key
  set to exactly `{"fields"}`." That is not accurate — the only `keySet` assertion in
  `DataSourceProtocolSpec.scala:406` pins the **PATCH** response to `Set("fields", "rowsMigrated")`
  (its test name says it is "a distinct type from the shipped DatasetSchemaResponse"). This does
  not change the verdict: GET's shape is proven unchanged far more strongly, by the source-level
  identity of the type and its formatter against the base. Flagged only so the claim is not
  carried forward as if a GET key-set test existed.
- The concurrency test's schema edit is a no-op-shaped edit (same field name and type), so it
  proves serialization and row-count consistency but not migration-under-contention of actual
  cell values. Adequate for Decision 5 as written; a future ticket touching this path may want a
  contending edit that genuinely rewrites cells.
- `computeRowsMigrated`'s `isPureRename` requires same arity and same index for every field, so a
  pure *reorder* reports the full row count. That is exactly Decision 6's stated intent
  (deliberate over-reporting), not a defect.
