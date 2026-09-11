## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All AC items from ticket.md (as widened by the owner ruling recorded in ticket.md) are addressed:
  `dataset_rows` table + forced RLS through `data_source_id → data_sources.owner_id`; RLS proven
  under non-superuser (`FlywayNonSuperuserMigrationSpec` extended + new `RlsOwnerTablesSpec` block);
  real `hel904-real-dump.sql` fixture exercised (plus a supplementary edge-case fixture per
  design.md/tasks.md 5.3, not a substitute for it); all three legacy readers and both writers
  retargeted with a genuine before/after-shaped comparison; `updateStaticPayload` write-path decided
  (Decision 7 — retargeted atomically, not left on the blob); `config` keep-vs-clear decided
  explicitly (Decision 4 — cleared, gated on the parity guard); CHECK constraint updated
  correctly; `dataset_schema` backfilled from declared columns per Decision 3; `StaticSource`
  scaladoc corrected (`DataSource.scala`).
- No AC silently reinterpreted — the one deliberate deviation from the ticket's literal wording
  (backfilling `dataset_schema` from declared `columns`, not `inferred_schema`) is explicitly
  recorded and justified in design.md Decision 3, with the reasoning re-verified against the code
  (`SparkJobSubmitter.scala` and `V106__dataset_rows.sql` both use `config->'columns'`, not
  `inferred_schema`).
- tasks.md is fully checked off ([x] on every item across all 7 sections) and each item traces to a
  real, verifiable diff line (spot-checked task 1.5/1.7/2.1/2.2/3.1/3.7/4.1/4.2/6.1-6.2 against the
  actual migration SQL, repository code, and test diffs — all match).
- No scope creep found: `files-modified.md`'s inventory matches `git diff --stat` exactly; every
  changed test file is either a Decision-7a seed migration (`'static'` → `'dataset'` + `dataset_rows`
  seeding) or new coverage for this ticket's own surface. `V98PipelineRootsMigrationSpec` correctly
  keeps its pre-V98-target seeds at `'static'` (verified in the diff: only post-`migrateToLatest()`
  seeds were renamed).
- No regressions to existing behavior: `PipelineRunServiceSpec`/`DataSourceServiceSpec`/
  `InProcessPipelineEngineSpec`/`SparkJobSubmitterSpec` mock overrides swap `readRawConfig` for
  `readDatasetRows` mechanically (same call sites, same assertions) — not weakened.
- API/schema contracts: spec deltas (`data-source-persistence`, `dataset-row-storage`,
  `static-data-connector`) added under `openspec/changes/migration-a-dataset-rows/specs/` and match
  the implemented behavior precisely (spot-checked `dataset-row-storage/spec.md`'s three backfill
  scenarios against the migration SQL and `V106DatasetRowsMigrationSpec`'s edge-case assertions —
  exact match, including the positional/no-collapse/no-padding language).
- Planning artifacts (design.md, 4 rounds of skeptic review) reflect the final implementation: every
  cited Decision (1–9, 7a) was checked directly against the committed code/SQL and matches, including
  the two points most likely to drift under time pressure — the NO FORCE/FORCE bracket ordering and
  the constraint-drop-before-UPDATE ordering (Decision 5).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE`, this is not a `slow`-speed run):
- `npm run check:scala-quality` → clean (162 pre-existing soft-budget warnings, none introduced
  are new blocking issues; no new file crosses a hard threshold).
- `sbt compile` / `Test/compile` → success.
- `sbt testOnly` targeted at the ticket's own new/changed specs (`V106DatasetRowsMigrationSpec`,
  `FlywayNonSuperuserMigrationSpec`, `RlsOwnerTablesSpec`, `RlsPolicyGuardSpec`,
  `DataSourceRepositorySpec`, `InProcessPipelineEngineSpec`, `SparkJobSubmitterSpec`,
  `DataSourceServiceSpec`) → 402/402 passed.
- `sbt test` (full suite, fresh run) → **4064/4064 tests passed**, 273 suites, 0 failed, 0 canceled,
  run to completion in 5m08s. This is the authoritative signal per
  `verification-before-completion.md` — not the executor's own report.

Detailed re-verification of the six specifically flagged items:

1. **Migration file / bracket pattern / constraint-drop ordering / parity guard.**
   `V106__dataset_rows.sql` is the correct next-free V number (confirmed `V105__oauth_states.sql`
   is main's latest via `git log origin/main`, and `ls backend/.../migration | sort -V | tail`
   shows no gap). Uses exactly the `NO FORCE`/`FORCE` bracket (lines 66, 155–156) matching V94/V96,
   not an invented mechanism. `DROP CONSTRAINT data_sources_source_type_check` (line 132) precedes
   the `UPDATE ... SET source_type = 'dataset'` (line 134–136), matching Decision 5. The parity
   guard (lines 96–113) is a `DO $$ ... RAISE EXCEPTION $$` block comparing
   `jsonb_agg(dr.data ORDER BY dr.seq)` against `COALESCE(config->'rows', '[]'::jsonb)` via
   `IS DISTINCT FROM` — exact content-level equality, not a row count — and runs (and would abort
   the transaction) before the `config`-clearing UPDATE at line 148.
2. **`dataset_rows.data` shape.** Confirmed positional: the migration's `INSERT` (lines 81–85)
   copies `elem.value` (a single array element from `jsonb_array_elements`) verbatim into `data`;
   `readDatasetRows` (`DataSourceRepository.scala`) returns `dataset_rows.data` unmodified as the
   `rows` array element, and `SparkJobSubmitter`/`PipelineRowJson.parseStaticRows(JsObject)` both
   consume it positionally (zip-by-index), matching pre-migration behavior exactly. Not an object.
3. **`rowToDomain`/`domainToRow` dataset↔StaticSource mapping.** Confirmed:
   `rowToDomain` matches `DataSourceKind.Static | "dataset"` → `StaticSource` (avoids the prior
   `IllegalStateException` crash on migrated rows); `domainToRow` writes `"dataset"` (not
   `DataSourceKind.Static`/`"static"`) for a `StaticSource`, satisfying the post-migration CHECK
   constraint on new inserts. `DataSourceRepositorySpec` round-trips both directions.
4. **Legacy reader/writer swap, proven behavior-preserving.** All three reader call sites
   (`InProcessPipelineEngine.loadRowsWithStats`, `SparkJobSubmitter.loadDataFrame`,
   `DataSourceService.previewStatic`) now call `readDatasetRows` instead of `readRawConfig`; the two
   writer call sites (`createStatic`, `applyStaticRefresh`/refresh) now call
   `insertDatasetSource`/`replaceDatasetRows` atomically instead of `updateStaticPayload`. The
   "before/after comparison" is realized concretely, not merely asserted: `InProcessPipelineEngineSpec`
   and `SparkJobSubmitterSpec`'s existing golden-output assertions (which pinned exact row/column
   values before this ticket) are preserved unchanged, with only the mock seam changed from
   `readRawConfig: Future[Option[String]]` to `readDatasetRows: Future[Option[JsObject]]` — the same
   assertions passing against the new seam is direct evidence the reader logic reproduces identical
   output, and the full suite run (4064/4064) confirms this holds for the real (non-mocked) path too
   via `V106DatasetRowsMigrationSpec` and `FlywayNonSuperuserMigrationSpec`'s content-level
   row/schema/config assertions against the real fixture. This is real, re-run evidence, not a
   vacuous "tests still pass" claim — the assertions compare exact JSON values
   (`myManualRows.map(_.parseJson) shouldBe Vector(...)`), not row counts.
5. **RLS under non-superuser.** `FlywayNonSuperuserMigrationSpec` (not just `RlsOwnerTablesSpec`) is
   extended with V106-specific assertions run as the non-BYPASSRLS `helio_migration_test` role
   against the real fixture, including registering `dataset_rows` in the `forceRlsTables` list
   checked for `FORCE` being applied. `RlsOwnerTablesSpec`'s new "RLS on dataset_rows" block
   separately proves runtime access control (owner isolation, privileged bypass,
   `owner_id IS NULL` invisibility, and the fail-closed-not-`missing_ok` contract) as a genuine
   non-superuser app-pool query. Both are present and both are real — the ticket's specific
   AC concern (RLS proven under non-superuser, not just superuser/CI/pg_dump) is met twice over.
6. **Existing test-seed migration.** `grep -rn "'static'" backend/src/test --include=*.scala` was
   re-run; every remaining hit outside the intentionally-preserved version-pinned specs
   (`V98PipelineRootsMigrationSpec`'s pre-target seeds, `V96CanonicalizeInferredSchemaType...`,
   `TriggerSourceMigrationSpec`, `PipelineOnlyPanelBindingMigrationSpec`, `ResourceTagMigrationSpec`)
   was migrated to `'dataset'` in the diff, and the ~10+ files seeding non-empty `rows` also gained
   `dataset_rows` seeds via the new shared `DatasetRowsTestSupport` helper rather than duplicated
   per-file SQL. No assertion was weakened to accommodate this — the diffs inspected
   (`InProcessPipelineEngineSpec`, `SparkJobSubmitterSpec`) show exact-value assertions preserved,
   and the full 4064-test run is itself evidence no test silently degraded to a passing-by-accident
   shape.
7. **Gate suite.** Re-run fresh as above (`sbt test`, `check:scala-quality`) — both green,
   independent of the executor's own report.

Additional CONTRIBUTING.md-adjacent checks:
- No dead code / TODO-FIXME introduced; `parseStaticRows`'s two overloads are a deliberate,
  documented compatibility shim (Decision 9's stated mechanism), not leftover cruft.
- No untyped escape hatches (`asInstanceOf`/`Any` casts) introduced in the reviewed diff.
- No inline fully-qualified names spotted in the new code (per this repo's documented pet peeve).
- DRY: the seed migration correctly consolidates into one shared `DatasetRowsTestSupport` helper
  rather than 33 individual ad hoc edits, exactly as tasks.md 6.2 required.

### Phase 3: UI Review — N/A
This is a backend-only Flyway migration + repository/service change. `git diff --name-only
main...HEAD` touches no `frontend/**` path, no `backend/src/main/scala/routes/ApiRoutes.scala`
route-shape change (`DataSourceRepository`/`DataSourceService` internals only — no new/changed
route), no `schemas/**`, and no runtime-behavior-visible `openspec/specs/**` (only this change's own
delta specs, which are plan artifacts, not the shipped spec tree). Confirmed no Phase-3 trigger
matched; dev servers were not started and no UI review was performed, per the phase's own "Otherwise
mark Phase 3 N/A" instruction — this is stated explicitly rather than silently skipped.

### Overall: PASS

### Non-blocking Suggestions
- None beyond the pre-existing (not introduced by this diff) soft file-size budget warnings already
  flagged by `check:scala-quality` on several test files this ticket touched
  (e.g. `RlsOwnerTablesSpec.scala` now 600 lines, `DataSourceRepositorySpec.scala` 285 lines) — these
  were already over budget or grew incrementally on files already over budget; not a new violation
  this ticket introduced in isolation, and splitting them is optional follow-up, not required for
  this ticket's scope.
