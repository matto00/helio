## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: `feature/compute-datetime-arithmetic/HEL-1314` at `5f0b679ef19bd40967dcfe4b284d64da49408b6d` (no code changes yet; change dir untracked). The artifacts read were ticket.md (owner rulings Q1-Q6), proposal.md, design.md, tasks.md, specs/compute-expression-language, specs/timestamp-value-parsing, and `.concertino/runs/HEL-1314/evidence/premise-validation.md`.

### What I verified (with evidence)

- **Structure.** `openspec validate compute-datetime-functions --strict` printed "valid". `check-spec-structure.mjs` reported 0 issues and `check-openspec-hygiene.mjs` reported clean. The MODIFIED "Output type can be inferred" block keeps all six base scenarios verbatim (compared against `openspec/specs/compute-expression-language/spec.md:148-189`).
- **D1 JSON-number epoch claim: TRUE.**
  - `PipelineRowJson.jsValueToAny` (`PipelineRowJson.scala:61`) turns every `JsNumber` into a `Double`.
  - `DateBucketStep.parseToUtcDate` does `Try(str.toLong)` on `value.toString` (`DateBucketStep.scala:~150`). That fails on `"1.7712864E9"`, and `parseNonEpochDate` also rejects it, so the result is `None`.
  - The datebucket spec (`pipeline-date-bucket-op/spec.md:12`) says "an epoch numeric value", so this is a real spec-vs-code bug.
  - Epoch arithmetic: `date -u -d @1782907200` gives 2026-07-01 12:00Z, and `@1771286400` gives 2026-02-17. The week example also checks out: 2026-03-19 is a Thursday and 2026-03-16 is a Monday.
- **D1 agreement scenario.** Traced each listed shape:
  - Through `parseNonEpochDate`'s current chain: Instant, then OffsetDateTime, then ISO_LOCAL_DATE_TIME, then the space formatter (`HH:mm[:ss]` plus a 0-9 digit fraction), then LocalDate.
  - Through the compute boundary: `anyToJsValue` turns a Double into a `JsNumber`, which becomes a `VNum`; a String becomes a `VStr`.
  - With the planned `parseInstant`, every shape lands on 2026-07-01 UTC in all three steps.
  - Cast keeps the JSON-number epoch only because D1 passes it the raw value. It emits the string form `"1.7829072E9"` (see notes).
  - Rejected shapes fail every branch.
- **ColumnClassifier.** `ColumnClassifier.scala:56` uses `DateBucketStep.parseNonEpochDate` to get `LocalDate`s and counts distinct dates. That is safe only if the non-epoch path stays separate from `parseInstant`'s epoch-first branch. The design states this requirement but not the mechanism (see CR3).
- **D4: "timestamp is always text at the compute boundary". I verified this against the tree, and it holds today.**
  - *Source inference.* `SchemaInferenceEngine.inferJsonType` only yields `TimestampType` from a `JsString` (`:224-226`). JSON numbers infer integer or float.
  - *Dataset declared schema.* `DatasetRowValidator.validateValue` accepts only `JsString` for `TimestampType` (`:72`). `DatasetSchemaMigration` re-validates rows on a type change (`:107-121`), so numbers are rejected.
  - *SQL connector.* Timestamp columns fall into `rs.getString`, which gives a `JsString` (`SqlConnectorDriver.scala:207`).
  - *Cast.* It keeps `str` (`CastStep.scala:88`).
  - *Datebucket.* It emits a `yyyy-MM-dd` String while analyze types it `timestamp` (`ReshapeSchemaInference.scala:30`).
  - *groupby min/max.* Analyze preserves the input type (`ColumnSchemaInference.scala:200`), but in-process GroupBy only implements sum and count (`GroupByStep.scala:80-85`).
  - *Other objects.* Any non-numeric object (Instant, `java.sql.Timestamp`) is stringified by the `anyToJsValue` catch-all (`PipelineRowJson.scala:47`).
  - *AnalyzeSchemaWarnings.* Its "timestamp may be a String or an instant" comment (`:73`) concerns `JoinStep`'s raw `Map[Any,_]` key equality before JSON conversion, not compute. D4 correctly leaves `family` unchanged.
  - Task 3.2's evidence-then-STOP guard is still appropriate, because HEL-1316 (window step) is landing concurrently.
- **D3 vs the legacy parser, `parseProblem` and the write path.**
  - The check runs inside `StrictParser`, so `validate`, `inferType`, `parseProblem`'s strict arm, `compile` and the `validate-expression` endpoint all see it.
  - The legacy parser has no call syntax (`ExpressionParser.scala:156-167`), so no stored legacy expression can contain `date_trunc`. There is no back-compat exposure.
  - **One gap:** a bare-identifier unit never reaches the check (CR2).
- **D5 drift fixture.**
  - Failable as designed, because each backend registry edit breaks a two-way equality.
  - **Poorly placed:** the repo already has a three-way seam fixture convention that the design does not use (CR4).
  - No other function-name lists exist. I grepped frontend/src, helio-mcp/src and backend main for function-list text and found only the engine. MCP proposal validation is backend-side (`pipelineProposalValidation.ts` has no expression logic).
- **Missing contract delta.** D4 changes the HEL-1403 warning's type set and its contexts, but `openspec/specs/pipeline-analyze-schema-warnings/spec.md:121-122` pins both, plus a cast-step remedy (CR1).
- **HEL-1070 seams.** One object per function family, registry lists, and a per-name parse check added next to `checkArity` all leave conditionals a clean pattern to copy. I found no conflict.
- **Scope.** Each piece maps to an AC or to the driver's direction:
  - functions → AC1;
  - parity and the `+` fix → AC2;
  - editor help (none exists today, so listing all functions is the minimum honest surface) and MCP → AC3;
  - the shared parser → driver direction.
  - The `TextTypes` addition is a small, justified extension.
  - I found no creep beyond that.

### Verdict: REFUTE

### Change Requests

1. **Add a spec delta for `pipeline-analyze-schema-warnings` ("Numeric use of a text field warns"), and fix its remedy for timestamps.**
   - That requirement (`openspec/specs/pipeline-analyze-schema-warnings/spec.md:122`) pins three things:
     - the type set "`string`, `string-body` or `boolean`";
     - the function list "`floor`, `ceil`, `round`, `mod` or `abs`";
     - that the message SHALL "suggest adding a cast step".
   - D4 adds `timestamp` to `TextTypes` and makes `add_days`'s `n` a numeric context. The plan has no MODIFIED delta for this capability, so the shipped behaviour would contradict a canonical spec.
   - The pinned remedy is also wrong for a timestamp: casting `"2026-07-01T…"` to float yields null (`CastStep.scala:84`). The warning would advise a fix that reproduces the all-null column it exists to prevent.
   - Add a MODIFIED requirement, with a scenario, that covers the timestamp type, the `add_days` `n` context, and timestamp-specific remedy wording (for example, point at `seconds_between`). Add a task and a test for that wording in `AnalyzeSchemaWarnings.scala:238-239`.

2. **D3 does not reach a bare-identifier unit, although the spec says it must.**
   - The spec says: "A `unit` that is not a string literal … SHALL be a parse error naming the supported units".
   - For `date_trunc(day, $ts)`, the most likely mistake, `parseArgs` fails first with `DollarPrefixRequiredMsg` (`ExpressionParser.scala:115`). The post-`checkArity` check is never reached.
   - The user then gets either "Column references require a '$' prefix" (from `validate`) or the legacy parser's "Unexpected token in expression: FnName(date_trunc)" (from `parseProblem`/`compile`, which fall back on that exact message).
   - Either:
     - (a) specify a parser mechanism that emits the units message for a bare-identifier first argument of `date_trunc`, without returning `DollarPrefixRequiredMsg` (so no legacy fallback is triggered); or
     - (b) narrow the spec to the cases D3 actually covers.
   - Either way, add a `date_trunc(day, $ts)` scenario and test that pins the resulting message on both `validate` and `parseProblem`.

3. **D1's behaviour-delta statement is inaccurate, and the non-epoch path is unspecified.**
   - D1 accepts "numeric strings … whole number … via `BigDecimal`". That newly parses several datebucket and cast inputs that are null today, and they are not Doubles: `"1771286400.0"` (a common pandas/CSV float export), `"1.7712864E9"` and `"1e3"`.
   - Yet D1 says "every other datebucket input must produce byte-identical output". The task 1.1 characterisation table ("all non-Double inputs") would therefore be red on these, or would silently omit them.
   - State the exact delta as a list of input classes. Make the characterisation table carry those rows explicitly as expected changes, and add a timestamp-value-parsing scenario for a decimal or exponent numeric string.
   - Also name the mechanism by which `parseNonEpochDate` stays epoch-free, for example a separate `parseInstantNonEpoch` (or similar) that `parseInstant` composes after its epoch branch. Add a `ColumnClassifier` regression assertion that an all-epoch-string column is still not DateLike.

4. **D5: put the function-name fixture under `shared-test-fixtures/`, not under `schemas/` or a frontend `__fixtures__` dir.**
   - `shared-test-fixtures/` is the established three-surface seam convention. `join-step-config.json` is read by:
     - backend (`JoinStepConfigSeamSpec.scala:44`, `Paths.get("../shared-test-fixtures/…")`);
     - frontend (`JoinConfig.seam.test.tsx`);
     - helio-mcp (`joinStepSeam.test.ts`).
   - `schemas/` is the JSON Schema 2020-12 contract directory. A frontend-internal path would make backend and helio-mcp tests reach into frontend source.
   - Pin the path in design.md and tasks 5.2-5.4 rather than leaving it to the executor.

5. **Specify `add_days`'s overflow boundary so that representable results are not nulled.**
   - D2 computes `BigDecimal(n) * 86400e9` nanoseconds. If that is applied through `Instant.plusNanos(Long)` (the obvious API), any shift beyond about 106,751 days (about 292 years) throws `ArithmeticException`, and the design maps that to `VNull`.
   - The spec says only "a result outside the representable instant range SHALL be null", so a 547-year shift (`add_days(ts, 200000)`) would be a spec violation that no planned scenario catches.
   - Specify the split into seconds plus nano-of-second (for example `Duration.ofSeconds(secs, nanos)`). Add two scenarios: one for a large-but-representable shift (non-null) and one for an unrepresentable shift such as `add_days(ts, 1e12)` (null).

### Non-blocking notes

- **Postgres `timestamptz` likely reads as null.** Through `rs.getString`, a `timestamptz` likely reads as `"2026-07-01 12:00:00+00"` (space-separated, short offset). That is outside the owner-ruled datebucket shape set, so datebucket and the new functions would null it. Schema inference already types it `string`. This is owner-ruled scope, but it is a plausible follow-up ticket; the executor may verify it with the embedded Postgres.
- **Cast of a JSON-number epoch emits a scientific-notation string.** After D1, cast to `timestamp` emits `"1.7712864E9"` (Double `toString`). It is readable downstream, but ugly in a table panel. Consider documenting it in the grammar or cast notes.
- **Single-quoted units give an unhelpful error.** `date_trunc('day', $ts)` (Postgres habit) gives `Unexpected character: '''`. Consider mentioning double quotes in the help.
- **`Val` visibility.** `VNum`, `VStr` and `VNull` are `private` to `ExpressionInterpreter` (`ExpressionInterpreter.scala:11-13`). D2's separate object needs them widened to `private[engine]`, or it must receive already-unwrapped values.
- **Agreement and rejected-shape tests.** These must call `DateBucketStep.apply`, not `evaluate`: `evaluate` fails the whole step when every non-blank row is unparseable (`DateBucketStep.scala:70-80`).
- **Red-first coverage for task 4.2.** It records no red run, but its JSON-number-epoch rows are red on current code. Capture that red under C2.
- **Evidence location for task 3.2.** "design-evidence (evaluation dir)" is vague; name the file.
- **Non-finite numbers.** `NaN`/`Infinity` Double inputs to `parseInstant` must be `None`, not a throw: `BigDecimal(Double.NaN)` throws. Include them in the 1.1 table.
