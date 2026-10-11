## Standing Constraints

- [C1] Owner rulings Q1–Q6 in ticket.md are binding; no now(), no month/year addition, no `-` on timestamps.
- [C2] Red first: every new test group's failing run against unmodified code is captured in red-evidence.md before the implementation that turns it green.
- [C3] Every sbt run's output must show `[hel1468-guard]`; new DB-backed specs use `VerifiedEmbeddedPostgres.start`; no inline FQNs (CONTRIBUTING.md).
- [C5] Seam fixtures live in `shared-test-fixtures/` (convention: join-step-config.json) and are read by the backend, frontend and helio-mcp tests.
- [C4] Resource caps: `nice -n 19` on heavy jobs; check MemAvailable ≥ ~15 GB before `sbt testFull` or a full jest run; at most two machine-wide testFull runs; shut down every sbt server you start; Bash timeout 600000; no pkill/pgrep/killall; no `--no-verify`/`HUSKY=0`; `git -C`, never `cd`.

## 1. Shared timestamp parser

- [x] 1.1 Write `TimestampParsingSpec` (table: every accepted/rejected shape in design D1/D6, incl. NaN/Infinity/fractional epochs -> None) and a datebucket characterisation table run against UNMODIFIED code pinning current outputs, with the D1 delta rows (JSON-number Double epoch, `"1771286400.0"`, `"1.7712864E9"`, `"1e3"`) pinned as their old `null` value first; rejected-shape rows call `DateBucketStep.apply` (not `evaluate`, which fails an all-unparseable step); run red and record in red-evidence.md
- [x] 1.2 Implement `TimestampParsing.parseInstant(value: Any): Option[Instant]` (D1); move `SpaceSeparatedFormatter`; verify 1.1 green
- [x] 1.3 Route `DateBucketStep.parseToUtcDate`/`parsesAsDate`/`parseNonEpochDate` and `CastStep.isTimestampLike` (raw value) through it; verify every characterisation row unchanged except exactly the enumerated D1 delta rows (updated in the same commit, listed in red-evidence.md); add a `ColumnClassifier` regression test proving `parseNonEpochDate` still rejects epoch-looking strings; existing ColumnClassifier specs green

## 2. Date/time functions

- [x] 2.1 Write `ExpressionDateTimeFunctionsSpec` covering every compute-expression-language spec scenario + D6 edge cases (leap day, DST-free, mixed date/timestamp, offsets, fractions/sign, nulls, unparseable, epoch numbers, add_days large-but-representable (1000000 days) and unrepresentable (1e15 days), unit errors for a quoted unknown unit, a `$`-ref unit and a BARE identifier unit on BOTH `validate` and `parseProblem`, unknown-function message); run red, record
- [x] 2.2 Add `ExpressionDateTimeFunctions` object, registry entries (`SupportedFunctions`, new `DateTimeFunctions`), `checkArity` arities (2, 2, 2), the date_trunc unit-literal parse check (D3), and `applyFn` delegation; verify 2.1 green and existing ExpressionEvaluatorSpec/registry probe green

## 3. Inference, parity and warnings

- [x] 3.1 Write parity tests iterating `DateTimeFunctions` (inferred kind == evaluated JsValue kind), the `$ts + 1` → string scenario, and warning tests per the pipeline-analyze-schema-warnings delta (`timestamp` in numeric context with the seconds_between suggestion and no cast suggestion; add_days `n` numeric context; timestamp args of date functions do not warn); run red, record
- [x] 3.2 Before changing `+`: record in `openspec/changes/compute-datetime-functions/timestamp-paths-evidence.md` every path a `timestamp`-typed field reaches compute and confirm none delivers a JSON number (D4); if one does, STOP and escalate
- [x] 3.3 Implement `inferTypeOf` and `ExpressionNumericContexts` changes (D4); verify 3.1 green; list any existing test expectations the `+` change altered

## 4. Seam / integration

- [x] 4.1 Write a `VerifiedEmbeddedPostgres` run spec: CSV source → cast timestamp → compute `seconds_between` and `date_trunc` → run; assert analyze projected types (`float`, `timestamp`) equal materialised JSON kinds, unparseable row null, run succeeded; plus `validate-expression` with a bad unit → `valid:false` naming units. Red first, then green
- [x] 4.2 Add the cast/datebucket/compute agreement spec (timestamp-value-parsing scenarios); run it red against the pre-1.3 code (or record why a row was already green), then green

## 5. Documentation surfaces

- [x] 5.1 Update `docs/compute-expression-grammar.md` (table rows, inference list, accepted shapes, examples, no now(), no `-` on timestamps, Spark note, cast-vs-datebucket MM/dd/yyyy note) and the `ExpressionEvaluator` scaladoc; fix stale `SourceService.applyComputedFields` references in files touched
- [x] 5.2 Add `shared-test-fixtures/compute-expression-functions.json` and a backend spec asserting fixture == `SupportedFunctions` (both directions)
- [x] 5.3 Frontend: function reference constant + accessible disclosure in `ComputeFieldConfig.tsx` per DESIGN.md; Jest tests (renders, toggles, lists date functions, names == fixture); verify lint/typecheck/format
- [x] 5.4 helio-mcp: one exported compute-expression description constant used by `add_pipeline_step` and the pipeline-proposal tool; test it names every fixture function; verify helio-mcp tests

## 6. Gates

- [x] 6.1 Run backend gates (targeted specs, then `sbt testFull` under caps, `[hel1468-guard]` visible), frontend lint/typecheck/format/jest, helio-mcp tests; record transcripts in the run evidence dir
- [x] 6.2 Write files-modified.md and commit (hooks on)
