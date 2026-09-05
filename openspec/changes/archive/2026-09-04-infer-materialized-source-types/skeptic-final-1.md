## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **Central runtime-type demand.** Read `InProcessPipelineEngineSpec.scala` diff (git diff
   9c1f29bf HEAD). Test "loadRows: a numeric-looking CSV column materializes as String..."
   measures `row("count") shouldBe a[String]` on rows returned by `engine.loadRows` (real
   materialization) AND asserts `declaredSchema...dataType shouldBe StringType` in the same test.
   Mutation-tested this directly: reverted `SchemaInferenceEngine.scala` to the pre-fix version
   (`git show 9c1f29bf:...SchemaInferenceEngine.scala`), re-ran
   `sbt testOnly com.helio.domain.engine.InProcessPipelineEngineSpec` → **2 tests failed**
   (confirms the test suite catches a revert of the fix). Restored the file afterward
   (`git diff` on it is now empty — confirmed clean).

2. **Static-source runtime proof.** "loadRows: a static source's numeric column materializes as
   Double, matching its registered `float` schema" calls `PipelineRowJson.parseStaticRows` and
   measures `row("count") shouldBe a[java.lang.Double]`, and separately calls
   `staticColumnRuntimeType` on the same cells, asserting `"float"`. `DataSourceServiceSpec`'s new
   tests exercise the actual service entrypoint (`service.createStatic`) end-to-end and read back
   the persisted `inferredSchema`, so a revert of the `DataSourceService.createStatic`/
   `applyStaticRefresh` call sites (not just the helper function) would also be caught.

3. **Evidence-shaped non-evidence check.** Diffed every edited pre-existing test individually
   (`SchemaInferenceEngineSpec`, `DataSourceRoutesSpec`, `SchemaInferenceFacadeSpec`,
   `SchemaInferenceRegressionSpec`) against 9c1f29bf. Every rename/edit is accompanied by an
   inline comment naming the old (broken) behavior it used to pin and why the new assertion is
   correct (e.g. `SchemaInferenceRegressionSpec`'s "derive field types from the data rows, not
   from a fallback constant" → renamed, `score` now asserted `string` not `integer`, with the
   comment explaining the prior assertion pinned the defect). `SchemaInferenceFacadeSpec` gained a
   new test proving REST/SQL non-string overrides are still accepted (scope boundary intact, not
   silently widened). No edited assertion papers over a new defect.

4. **Safety argument (no runtime value moves).** Read `PipelineRowJson.staticColumnRuntimeType`
   — it derives its declared type from the *same* `jsValueToAny` conversion the row loader
   applies (`JsNumber → Double → "float"`, `JsString → "string"`), so the reported type always
   matches; no row cell content changes anywhere in the diff. `FilterStep`/`SortStep`/aggregate
   code is untouched. New test 6.5 demonstrates (not just asserts) that an `=` filter over
   string-valued rows matches identically regardless of declared type. `blast-radius.md` names
   the `fact_issues` production case explicitly and traces why 328/222 is unaffected.

5. **Completeness of the invariant.** Checked all five CSV/static creation/refresh paths:
   - `createCsv` — override guard added, rejects non-string with a clear message naming `cast`.
   - `createCsvUrl`, `finishCsvRefresh`, `infer` — call `SchemaInferenceEngine.fromCsv` directly
     with no override parameter at all; since `fromCsv` itself always reports `StringType` now
     (D1), these paths are covered by construction — no override hole exists because there is no
     override mechanism on these paths to close.
   - `createStatic`, `applyStaticRefresh` — both route through `staticColumnRuntimeType` derived
     from stored cells.
   No path found where a CSV/static declared type can still disagree with materialized type.

6. **Constraints.** `git diff 9c1f29bf HEAD --stat` shows no Flyway migration, and no changes to
   `RestApiConnectorDriver`, `RestSourceConnectorMigration`, or `RestApiConfig` (the latter file
   does not even exist under that path — no accidental touch). `SchemaInferenceFacadeSpec`'s new
   test explicitly pins that non-string REST/SQL overrides remain accepted.

7. **Honest cost disclosure.** `blast-radius.md` §"What consumers DO change" states the
   `measure`-classification and numeric-panel-slot-eligibility loss explicitly. The frontend
   `InferredFieldsTable.tsx` locks the data-type Select for CSV sources and renders a visible hint:
   "CSV columns always load as string... add a cast step" — this is user-facing, not just a code
   comment.

8. **Gates re-run myself:**
   - `sbt testOnly` across all 7 touched backend specs → 383/383 passed.
   - `npm test` (full frontend + helio-mcp jest suites) → 2619 + 230 tests passed, 0 failures.
   - `npm run lint` → clean (zero-warnings policy).
   - `npm run typecheck` → clean.

### Verdict: CONFIRM

### Non-blocking notes
- `SortStepSpec` (new file) is a solid regression guard for the AC's required "sort over
  numeric-looking Strings" case, but it tests pre-existing `SortStep` coercion behavior rather
  than anything changed by this diff — correctly scoped as a guard, not mislabeled as proof of a
  fix.
- The `createCsvUrl`/`finishCsvRefresh`/`infer` paths have no explicit test asserting they reject
  non-string overrides, but this is moot: those paths accept no override parameter at all, so
  there is nothing to test a hole in.
