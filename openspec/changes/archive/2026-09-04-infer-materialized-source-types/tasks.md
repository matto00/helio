## 1. Backend — CSV inference

- [x] 1.1 Change `SchemaInferenceEngine.fromCsv` to infer `StringType` for every column while retaining nullability inference; verify `SchemaInferenceEngineSpec`'s `fromCsv` block passes with updated type expectations
- [x] 1.2 Delete `widenType` and any helper left with no caller (`isBooleanValue`/`isTimestamp` only if genuinely unreferenced); verify with grep and a clean `sbt compile`
- [x] 1.3 Confirm the header-only-CSV branch still returns `StringType, nullable = false` and is now redundant rather than divergent; verify by test

## 2. Backend — static source schema

- [x] 2.1 Add a shared helper deriving a static source's field types from its stored `rows` cells using the same conversion `PipelineRowJson.parseStaticRows` applies (`JsNumber`→`float`, `JsString`→`string`, `JsBoolean`→`boolean`, mixed→`string`, no rows→canonicalized declared type); verify by unit test per case
- [x] 2.2 Wire that helper into `DataSourceService.createStatic` in place of the declared-type projection; verify a static source created with `{"name":"count","type":"integer"}` and numeric cells registers `count` as `float`
- [x] 2.3 Wire the same helper into `DataSourceService.applyStaticRefresh` (`DataSourceService.scala:611-638`), replacing its `payload.columns` declared-type projection; verify by test that refreshing that same static source still reports `count` as `float` rather than reverting to `integer` — without this, D4's "corrected on next refresh" promise is false for static sources

## 3. Backend — CSV field-type overrides

- [x] 3.1 Reject a CSV field override whose `dataType` is not `string`, with a message naming the `cast` step, in the ONE real CSV override-application site: the inline block in `DataSourceService.createCsv` (`DataSourceService.scala:187-194`); verify a `ServiceError.BadRequest` by test
- [x] 3.1a Do NOT add the guard to `SchemaInferenceFacade.toSchemaFields` — it serves only the generic REST/SQL/JSON connector path (`CreateSourceEnvelope.build`, `SourceService.upsertInferredSchema`) and has no source-kind parameter; guarding there would regress REST/SQL/JSON overrides. Verify by test that a non-string override on a REST or SQL source is still accepted
- [x] 3.2 Confirm `displayName`-only overrides and `string` overrides still apply; verify by test

## 4. Frontend

- [x] 4.1 Disable the per-field data-type editor in `InferredFieldsTable` when the source kind is CSV, with a short inline explanation pointing at the `cast` step; verify by Jest test asserting the control is disabled and the hint is rendered
- [x] 4.2 Ensure `AddSourceModal` sends `string` for every CSV field override; verify by Jest test on the submitted payload

## 5. Documentation of the retained divergence

- [x] 5.1 Ensure the `schema-inference` spec delta's divergence requirement survives archive into `openspec/specs/schema-inference/spec.md`; verify `openspec validate --change infer-materialized-source-types` exits zero
- [x] 5.2 Add a short pointer comment at `PipelineRowJson.jsValueToAny`'s `JsNumber` case naming the spec requirement, so the code site leads to the reasoning rather than restating it

## 6. Tests — runtime-type proof (not inference-returned-without-error)

- [x] 6.1 CSV end-to-end: load a CSV with a numeric-looking column through the pipeline engine and assert each materialized cell `isInstanceOf[String]`, then assert the inferred schema declares that column `string` — the two asserted in one test so the invariant is what fails if either side drifts
- [x] 6.2 Static end-to-end: same shape — materialize a static source's rows and assert the runtime class of each cell matches the type its schema declares
- [x] 6.3 JSON/REST divergence guard: assert a JSON `integer`-inferred column materializes as `Double`, pinning the retained divergence so a later silent alignment fails a test
- [x] 6.4 Sort regression guard: sort a column of numeric-looking `String`s with values `9`, `10`, `100` and assert numeric order — the shape a CSV source actually produces, which no existing test covers
- [x] 6.5 Filter no-change proof: assert `is_epic = "0"` style conditions over string-valued CSV rows return the same matches before and after, demonstrating the by-construction argument rather than asserting it
- [x] 6.6 Verify the CSV-rooted Output re-inference now agrees with its source schema; if it does not, record the finding for a follow-up ticket rather than fixing it here

## 7. Verification and reporting

- [x] 7.1 Run backend `sbt test` and frontend `npm test`/`lint`/`typecheck`; verify all gates green
- [x] 7.2 Write the blast-radius report covering `fact_issues` and the 11 pipelines: state which declared types change, that no runtime value moves, and what a user sees before the next refresh; verify it is committed as change evidence
