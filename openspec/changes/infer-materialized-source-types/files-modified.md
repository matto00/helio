# Files modified — HEL-893 (infer-materialized-source-types)

## Backend — production code

- `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala` — `fromCsv` now
  infers `StringType` for every column (nullability inference unchanged); `widenType` and
  `isBooleanValue` deleted (last caller removed); updated the `widenJson` doc comment, which
  previously described a divergence from `widenType` that no longer exists.
- `backend/src/main/scala/com/helio/domain/engine/PipelineRowJson.scala` — added
  `staticColumnRuntimeType`, the shared helper deriving a static column's runtime type from its
  stored cells' JSON kind; added a pointer comment at `jsValueToAny`'s `JsNumber` case naming the
  retained JSON/REST/SQL divergence spec requirement.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — `createStatic`
  and `applyStaticRefresh` now derive `SchemaField`/`DataField` types via
  `PipelineRowJson.staticColumnRuntimeType` instead of the caller-declared column type;
  `createCsv` rejects any field-type override that isn't `string`, naming the `cast` step.

## Frontend — production code

- `frontend/src/features/sources/ui/InferredFieldsTable.tsx` — added a `sourceKind` prop; when
  `"csv"`, disables the per-field data-type `Select` and renders a hint pointing at the `cast`
  step.
- `frontend/src/features/sources/ui/AddSourceModal.tsx` — passes `sourceKind` through to
  `InferredFieldsTable`; forces every CSV field override's `dataType` to `"string"` before
  calling `createCsvSource`, regardless of `fields` state.
- `frontend/src/features/sources/ui/AddSourceModal.css` — added `.add-source-modal__hint` styling
  for the new CSV hint text.

## Tests

- `backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala` — updated
  `fromCsv` scenario expectations from `IntegerType`/`FloatType`/`BooleanType`/`TimestampType` to
  `StringType`, matching D1; renamed scenario titles that previously named the widened type.
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala` — added the
  tasks.md 6.1/6.2/6.3/6.5/6.6 runtime-type-proof tests (CSV cell runtime class vs. declared
  schema in one test; static cell runtime class vs. registered `float` schema; the retained
  JSON/REST `Double` divergence; a filter no-change proof; a CSV Output re-inference agreement
  check).
- `backend/src/test/scala/com/helio/domain/steps/SortStepSpec.scala` (new) — tasks.md 6.4's
  regression guard: sorting a column of numeric-looking `String`s (`9`, `10`, `100`) numerically,
  not lexicographically.
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceSpec.scala` — updated the
  legacy-synonym canonicalization test's numeric/date-cell expectations for D2 (`count`→`float`,
  `createdAt`→`string`); added a companion "no rows" fallback test; added the tasks.md 3.1/3.2 CSV
  override-rejection tests.
- `backend/src/test/scala/com/helio/services/sources/SchemaInferenceFacadeSpec.scala` — added the
  tasks.md 3.1a negative-space test proving `toSchemaFields` still accepts a non-string override
  on the generic REST/SQL/JSON path.
- `backend/src/test/scala/com/helio/services/sources/SchemaInferenceRegressionSpec.scala` —
  renamed and updated the two regression tests that had pinned the pre-HEL-893 defect as desired
  behavior (CSV numeric column declaring `integer`; static boolean/timestamp columns backed by
  `JsString` cells declaring their stale declared type).
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — renamed and
  updated the CSV field-override route test: a non-string override is now rejected (400, naming
  `cast`); added a companion test for an accepted `string` override with a `displayName`.
- `frontend/src/features/sources/ui/AddSourceModal.test.tsx` — added two tests: the CSV
  data-type editor is disabled with the cast-step hint rendered; every CSV field override is
  submitted as `string` regardless of stale `fields` state.
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — shifted three pinned baseline line numbers
  for `AddSourceModal.css` (+6) to account for the new `.add-source-modal__hint` rule.

## Change evidence (not code)

- `openspec/changes/infer-materialized-source-types/blast-radius.md` (new) — tasks.md 7.2's
  blast-radius report.
