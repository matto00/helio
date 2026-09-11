## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Gates, re-run fresh in the worktree (not trusting evaluation-1.md):**
- `cd backend && sbt test`: `Total number of tests run: 4100 / Suites: completed 276, aborted 0 / Tests: succeeded 4100, failed 0 / All tests passed.`, EXIT=0
- `npm run lint`: EXIT=0. `npm run format:check`: "All matched files use Prettier code style!", EXIT=0.
- `npm test`: `Tests: 248 passed, 248 total` (helio-mcp) + `Tests: 3197 passed, 3197 total` (frontend), EXIT=0
- `npm --prefix frontend run build`: EXIT=0

**Mutation probes, reproduced in a scratch copy of `backend/` (the worktree was never modified; `git status` afterward shows only the evaluator's untracked evaluation-1.md):**
- (a) `validateValue` short-circuited to `Right(())` → `DatasetRowValidatorSpec`: `Tests: succeeded 9, failed 4`. Reproduced; the guard is real.
- (b1) `createStatic`'s `DatasetRowValidator.validate(...)` replaced by `Right(req.rows)` → 3 red (wrong-type, missing-required, and the RLS reject test). Reproduced.
- (b2) `applyStaticRefresh`'s validate call replaced by `Right(payload.rows)` → 1 red ("reject a refresh with a wrong-typed value…"). The evaluator did **not** run this arm, even though tasks.md 3.5 requires it. I ran it: it reproduces.
- (c) **RLS vacuity probe:** in `RlsOwnerTablesSpec`'s new test, I built the service as `new DataSourceService(null, fileSystem)`. The test **still passed**. The reject path returns `Future.successful(Left(...))` before any repository call, so no SQL goes through the `helio_app_test` pool at all.
- (d) **Default-fill persistence probe:** in both `createStatic` and `applyStaticRefresh` I persisted `req.rows`/`payload.rows` instead of `validatedRows`. Full suite: `succeeded 4097, failed 1`. The one failure is `ShareTokenService`'s "never reach for scala.util.Random" source scan, which searches upward for `helio-mcp/src`; that directory doesn't exist in the scratch copy, so the failure is an artifact of the copy and unrelated to this change. **No test catches default-filled values being dropped before persistence.**

**AC tracing:**
- AC1 (wrong type rejected with a field-level error, no coercion): `DatasetRowValidator.validateValue` (DatasetRowValidator.scala:93-109). It's wired into `createStatic` (DataSourceService.scala ~l.362) and `applyStaticRefresh` (~l.713) and returns `ServiceError.BadRequest`. Tested at unit level and service level with the exact string `"row 0: field 'age' — expected integer, got string"`. MET.
- AC2 (missing required field rejected): `validateRow` required/no-default branch (l.165) → `"row 0: field 'age' is required"`. Tested at unit and service level. MET.
- AC3 (failable probe): reproduced, see (a)/(b1)/(b2). MET.

**Pinned design contract, checked literally:**
- The row-length check runs first and short-circuits the per-field checks (l.150). Holds.
- "Missing" means absent or `JsNull`: `row.lift(i).getOrElse(JsNull)`, then `== JsNull`. Holds.
- `ServiceError.BadRequest` with `"; "` join and no new envelope or variant. Holds.
- Row-length, required, field-level and default formats render exactly as spec.md pins them. Holds.
- **Type-mismatch reason template: does NOT hold for two cases** (CR 1).
- Legacy `{name,type}` rows deserialize unchanged: `DatasetFieldDeclarationSpec`. Holds.
- The `TimestampParsing` extraction is byte-identical to the old four formatters. Holds.
- The `SchemaInferenceRegressionSpec` fixture change is a genuine invalid-fixture correction (`"boolean"` backed by `JsString("true")`), not a loosened validator. Acceptable.
- Scope: no creep found. There's no migration. `schemas/sources/static-column-payload.schema.json` was updated. The repo has no OpenAPI file carrying this shape (grep found only the JSON schema), so the evaluator's note on that holds.

**UI:** the frontend diff is type and parsing only (`dataSource.ts`, the `StaticSourceForm.handleSubmit` NaN fallback) with no visual change. I did not start the app because there's no view to judge. See CR 4 for the behavior-test gap.

### Verdict: REFUTE

### Change Requests

1. **The pinned type-mismatch reason template is violated in shipped code.** spec.md (scenario "A wrong-typed value is rejected, not coerced") pins the reason as `"expected <declaredType>, got <actualKind>"`, where `<actualKind>` is one of `string`, `number`, `boolean`, `object`. The code diverges at `backend/src/main/scala/com/helio/domain/engine/DatasetRowValidator.scala`:
   - l.100 emits `"expected integer, got non-integral number"`
   - l.105 emits `"expected timestamp, got a string that does not parse as a timestamp"`
   - `jsonKind` (l.83) can emit `"array"`, which the spec's kind set doesn't allow.

   HEL-1077 will build on these strings, so code and spec must agree literally. Pick one:
   - (a) Conform the code to the template.
   - (b) Amend spec.md, and the design.md Decision 7 examples, to explicitly pin these two extra reason strings and add `array` to the `<actualKind>` set. This keeps the more informative messages.

   Either way, add exact-string assertions for the non-integral-integer case (today it only checks `include("field 'age'")`, DatasetRowValidatorSpec.scala ~l.477) and for an unparseable-timestamp case (no test exists).

2. **The RLS reject-path test is vacuous with respect to RLS, and ticket.md's RLS requirement is not actually met.** `RlsOwnerTablesSpec` "a rejected DatasetRowValidator write leaves no dataset_rows row under the non-superuser role" passes unchanged with `new DataSourceService(null, …)` (probe (c)). No query ever runs as `helio_app_test`. The claim in evaluation-1.md's "RLS reject-path check" section ("a real RLS-role exercise") is false. ticket.md says "any code touching `data_sources`/`dataset_rows` must be exercised under the non-superuser `helio` role path", and no RLS spec calls `insertDatasetSource`/`replaceDatasetRows` through the app pool (grep of `Rls*.scala`). Add to `RlsOwnerTablesSpec`, all through the app-role `ctx`:
   - An **accepted** `createStatic` whose declaration has `required`/`default` and a row needing a default fill. Assert that ownerA sees the `dataset_rows` row via `withUserContext(ownerA)` and ownerB doesn't, and that the persisted `dataset_schema` carries `required`/`default`.
   - An **accepted and a rejected** `service.refresh` on that source. Assert that the old rows survive the reject under the app role.

   Keep the existing reject test if you want, but relabel its comment: it guards "validation precedes the repository call", not RLS.

3. **Default-fill persistence is unguarded.** With both write paths mutated to persist the raw rows instead of `validatedRows` (probe (d)), the whole suite stays green. The spec scenario "A missing required field with a default is filled, not rejected" says THEN "the persisted row carries the field's default value". `DataSourceServiceSpec` "fill a missing required field from its declared default rather than reject" (~l.805) only asserts `result.isRight`. Make it read back `dataSourceRepo.readDatasetRows(src.id)` and assert `rows == [[0]]`. Add the same assertion for a refresh that relies on a default. The test must go red under probe (d).

4. **The `StaticSourceForm` NaN-fallback behavior change has no test.** `frontend/src/features/sources/ui/forms/StaticSourceForm.tsx` ~l.102-116 now sends the raw string instead of `NaN`→`null` for an unparseable numeric cell. `StaticSourceForm.test.tsx` never asserts the `onSubmit` payload (every render passes `onSubmit={noop}`), so reverting the fix leaves all 3197 frontend tests green. Add a test that types a non-numeric value into an `integer` column and asserts that `onSubmit` receives the raw string for that cell, not `null`/`NaN`.

5. **Spec scenario "A caller-declared 'double' field is stored as canonical 'float'" has no test that exercises it.** `DatasetFieldDeclarationSpec` "canonicalize a non-canonical 'double' type to 'float' on write" (DatasetFieldDeclarationSpec.scala ~l.586) constructs `DataFieldType.FloatType` directly, so no `"double"` is ever involved and the name is misleading. The existing HEL-893 tests assert `inferredSchema`, not the persisted declaration. Add a service-level test that creates a source with `StaticColumnPayload("amount", "double")` and asserts `readDatasetRows(...).fields("columns")` stores `"type":"float"`. Fix or rename the vacuous codec test.

### Non-blocking notes
- `DatasetRowValidator.validateRow` fills from `default` without re-checking `JsNull`. If a direct Scala caller (HEL-1077) constructs `StaticColumnPayload(default = Some(JsNull))`, a `required: true` field gets persisted as `null`. The HTTP path is safe because spray reads `null` as `None`, but HEL-1077 should normalize `Some(JsNull)`→`None` in the service where the declaration is built, the same way the codec already does.
- The `e.reason == "required"` string sentinel in `renderRowFailures` (the evaluator flagged this too): a small `FieldError` ADT would make CR 1's reason set explicit and harder to drift.
- `helio-mcp/src/helioApi.ts:96` `StaticColumn` lacks `required?`/`default?`. design.md Decision 6 says "a caller that sets them (MCP…) is honored", but the MCP client can't send them yet. This is fine if HEL-1077 owns it; say so explicitly.
- `DatasetFieldDeclaration.write` calls `validateAndCanonicalize(asString(fieldType))`, which is redundant: `asString` of a `DataFieldType` is already canonical.
