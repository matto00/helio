## 1. Declared-field model

- [x] 1.1 Add `DatasetFieldDeclaration(name, fieldType: DataFieldType, required: Boolean, default: Option[JsValue])` to `DataSource.scala` (or a new sibling file colocated with the domain model).
- [x] 1.2 Add a spray-json formatter for `DatasetFieldDeclaration` in `JsonProtocols.scala` (or a nearby protocol file), normalizing absent `required`→`false` and absent `default`→`None` on read, and routing `fieldType` through `DataFieldType.validateAndCanonicalize` (write) / `DataFieldType.asString` (read) per design.md Decision 2 — not the older `canonicalize`/`fromString`-only naming from round 1. On read, a stored type string that fails `fromString` logs a warning and falls back to `StringType` (design.md Decision 2) rather than crashing.
- [x] 1.3 Update `DataSourceRepository.insertDatasetSource`/`replaceDatasetRows`/`readDatasetRows` (and their `declaredColumns`/`datasetSchema` (de)serialization) to use `Vector[DatasetFieldDeclaration]` instead of `Vector[SchemaField]` for `dataset_schema`.
- [x] 1.4 Confirm pre-existing `dataset_schema` rows (backfilled `{name,type}` shape) deserialize unchanged under the new codec (unit test with a raw legacy-shape JSON string, no migration).

## 2. Write-time validator

- [x] 2.1 Extract `SchemaInferenceEngine.isTimestamp` into a shared `TimestampParsing.looksLikeTimestamp(s: String): Boolean` helper (domain.engine); update `SchemaInferenceEngine` to call it (behavior-preserving refactor, no test change expected there).
- [x] 2.2 Add `DatasetRowValidator` (domain layer, pure function) with `validate(declaration, row): Either[Vector[FieldError], Vector[JsValue]]` implementing design.md Decision 3's exact per-type acceptance rules (integer requires integral JsNumber; float accepts any JsNumber; timestamp uses `TimestampParsing.looksLikeTimestamp`; string/string-body accept JsString; boolean accepts JsBoolean; binary-ref accepts any JsObject), the "missing" definition (absent-or-null, required-no-default reject, default-fill, row-too-long reject).
- [x] 2.3 Add a `validateDefault(field: DatasetFieldDeclaration): Either[FieldError, Unit]` (or fold into schema-declaration validation) checking a field's `default`, if present, against its own declared type using the same rules.
- [x] 2.4 Define `FieldError` (field name + reason) and a row-level `RowLengthError`-style case; settle on one ADT covering both.
- [x] 2.5 Unit-test every scenario in `specs/dataset-schema-validation/spec.md` verbatim, including: wrong type, non-integral-for-integer, whole-number-for-float, bare-date-for-timestamp, missing required no default, missing required with default, missing optional no default, extra-trailing-values, bad-default-at-declaration-time, plus "double"/"long"/"date" canonicalization via `validateAndCanonicalize`.

## 3. Wire the existing writers through the validator

- [x] 3.1 Add `required: Option[Boolean]`/`default: Option[JsValue]` to `StaticColumnPayload` (`DataSourceProtocol.scala`), defaulting absent to `false`/`None`; verify `StaticSourceForm.tsx`'s `handleSubmit` mapping (parseInt/parseFloat/boolean-literal/raw-string) always produces a value passing Decision 3 for every type the form's column-type selector offers — fix the form only if a real gap is found, do not assume.
- [x] 3.2 In `DataSourceService.createStatic`, validate the declaration's defaults (task 2.3) then every row via `DatasetRowValidator` before calling `insertDatasetSource`; reject the whole call (no repository write) on any failure, returning `ServiceError.BadRequest` with the pinned message format from design.md Decision 7 / specs/dataset-schema-validation/spec.md (no new `ServiceError` variant, no new response envelope).
- [x] 3.3 In `DataSourceService.applyStaticRefresh`, do the same before calling `replaceDatasetRows`.
- [x] 3.4 Re-run `DataSourceServiceSpec.scala`'s HEL-893-pinning tests (~lines 276-336) and every other `createStatic`/refresh fixture in the suite; for any fixture that now fails, confirm whether the fixture data is genuinely invalid under Decision 3 (fix the fixture, with a comment) or whether the validator is wrong (fix the validator) — never loosen the validator just to make a test pass.
- [x] 3.5 Add a failable probe: (a) mutate the validator's type check to always pass — the unit test from 2.5 must fail; (b) remove the validator call from each of `createStatic`/`applyStaticRefresh` in turn — an integration test asserting `400` + zero new `dataset_rows` rows must fail for that path. Record both mutations performed and their failure output as evidence.

## 4. Wire shape + RLS + spec hygiene

- [x] 4.1 Update `schemas/` JSON Schemas + `openspec/` OpenAPI for `StaticColumnPayload`'s new `required`/`default` fields; update the corresponding frontend TypeScript types (even if the form doesn't populate them yet). The `400` error body is the existing `ErrorResponse{message}` shape (design.md Decision 7) — no new schema/envelope for it.
- [x] 4.2 Exercise the create/refresh + validation reject paths under the non-superuser `helio` role (RLS), not just local/CI superuser — confirm a rejected write leaves no `dataset_rows` row under RLS.
- [x] 4.3 Confirm no migration is needed (dataset_schema is already jsonb, schema-on-read) — if one becomes necessary, use V107 (verify against origin/main before adding) and flag it to the orchestrator before committing.
- [x] 4.4 Re-read `dataset-row-storage` and `static-data-connector`'s existing spec requirement text; if either textually describes today's lenient/coercing acceptance as a requirement, add a MODIFIED delta for it in this change rather than leaving proposal.md's "no existing capability changes" claim unverified.
