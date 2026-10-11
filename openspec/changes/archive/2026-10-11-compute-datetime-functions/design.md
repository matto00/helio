## Context

See proposal.md (Why). Owner rulings Q1–Q6 are recorded in ticket.md and are binding. Current tree (main 5f0b679ef, premise-validation.md):

- **Engine layout after HEL-1404.** Adding a function touches six places:
  - `ExpressionEvaluator.SupportedFunctions`/`NumericFunctions` (the registry lists);
  - `ExpressionParser.checkArity` (arity and known names, at parse time);
  - `ExpressionInterpreter.evalExpr`/`applyFn` (dispatch);
  - `ExpressionTypeInference.inferTypeOf`;
  - `ExpressionNumericContexts` (the HEL-1403 warning);
  - `docs/compute-expression-grammar.md`.
- **Run-time values.** `Val` is `VNum | VStr | VNull`. A compute step receives timestamp columns as strings:
  - cast keeps the original string (HEL-1436 D3);
  - SQL `java.sql.Timestamp` values become strings via `PipelineRowJson.anyToJsValue`'s `toString` catch-all;
  - JSON numbers arrive as `VNum`.
- **Existing timestamp readers.** There are two, and they differ:
  - `TimestampParsing.looksLikeTimestamp` (Boolean only; ISO_DATE_TIME, ISO_LOCAL_DATE_TIME, ISO_LOCAL_DATE, MM/dd/yyyy). Used by schema inference, `DatasetRowValidator` and cast.
  - `DateBucketStep.parseToUtcDate`/`parseNonEpochDate` (LocalDate only; epoch via `str.toLong`, Instant, OffsetDateTime, T- and space-separated local date-time, LocalDate). Used by datebucket, cast and the first-run `ColumnClassifier`.
  - Neither yields an `Instant`.
- **JSON-number epoch bug.** `parseToUtcDate` gets a JSON-number epoch as a `Double` (`jsValueToAny` makes every number a Double). Its `toString` is `"1.7712864E9"`, which fails `toLong`, so datebucket nulls a JSON-number epoch today. That contradicts its own spec ("an epoch numeric value").

## Goals / Non-Goals

**Goals:**
- Add the three functions with exact analyze/apply type parity.
- Build one shared instant parser that datebucket, cast and compute all route through.
- Add function reference help in the editor and in MCP.
- Leave HEL-1070 (conditionals, next in queue) a clean place to add functions.

**Non-Goals:**
- `now()`, month/year addition, `-` on timestamps.
- Changing `TimestampParsing.looksLikeTimestamp` or what schema inference/`DatasetRowValidator` call a timestamp.
- Spark path parity.
- The `validate-expression` endpoint's missing `inferType` check (HEL-1437).
- A new Val variant for instants.

## Decisions

### D1. Shared parser: `TimestampParsing.parseInstant(value: Any): Option[Instant]`
- **Where it lives.** It goes in the existing `TimestampParsing` object (domain/engine). It accepts exactly the datebucket shape set (spec `timestamp-value-parsing`), in datebucket's existing order: whole-number epoch first, then Instant, then OffsetDateTime, then T-local, then space-local, then bare LocalDate.
- **Epoch normalisation.**
  - Int/Long/BigInt are used directly.
  - Double/Float/BigDecimal and numeric strings are accepted only when they are a whole number in Long range (via `BigDecimal`, e.g. `"1.7712864E9"`, `1771286400.0`). Fractional epochs are rejected (`None`).
  - The magnitude rule is unchanged (> 9999999999 means milliseconds).
- **How the steps use it.**
  - `DateBucketStep.parseToUtcDate` becomes `parseInstant(v).map(_.atZone(UTC).toLocalDate)`, and `SpaceSeparatedFormatter` moves with it.
  - `DateBucketStep.parsesAsDate` and `parseNonEpochDate` delegate to it, so `ColumnClassifier`'s non-epoch semantics are unchanged. `parseNonEpochDate` stays a non-epoch subset and must still return `None` for epoch-looking strings.
  - `CastStep.isTimestampLike` becomes `looksLikeTimestamp(str) || parseInstant(v).isDefined`. It is passed the raw value, so a JSON-number epoch cast to timestamp is kept. Its string form `"1.7712864E9"` is still accepted by `parseInstant`, so cast's output is readable downstream.
- **Behaviour delta, deliberate and spec-backed (skeptic design r1 #3).** Exactly these inputs change from `null` to a parsed epoch in datebucket (and from `null` to kept in cast):
  - a JSON-number epoch arriving as a whole-number `Double`/`BigDecimal` (e.g. `1771286400.0`);
  - a numeric string that is a whole number written with a decimal point or exponent (e.g. `"1771286400.0"`, `"1.7712864E9"`, `"1e3"`).
  Plain integer strings (`"1771286400"`) already parsed and are unchanged. Every other datebucket input must produce byte-identical output. A characterisation table run against the unmodified code first pins both the unchanged rows and the delta rows (old value `null`). The delta rows are then updated in the same commit as the change, and listed.
- **Fourth consumer (HEL-1316).** `WindowRolling`'s day-based frames call `DateBucketStep.parseToUtcDate` (kept `private[steps]`, delegating to `parseInstant`), so a whole-number `Double` epoch now orders and frames for rolling-days windows instead of being dropped as unparseable; `TimestampAgreementSpec` pins it.
- **Non-epoch entry point (skeptic r1 #3).** `TimestampParsing` exposes `parseNonEpochInstant(str: String): Option[Instant]` (no epoch branch), and `parseInstant(v) = epoch(v).orElse(parseNonEpochInstant(...))`. `DateBucketStep.parseNonEpochDate(str)` becomes `parseNonEpochInstant(str).map(_.atZone(UTC).toLocalDate)`, so `ColumnClassifier` stays epoch-free. A ColumnClassifier regression test asserts that `"1771286400"` and `"1.7712864E9"` are still not date-like.
- **Non-finite numbers.** NaN, Infinity, and anything outside Long range give `None`; the parser never throws.
- **Alternatives considered.**
  - Make compute alone accept Double epochs: rejected, because the readers would then disagree.
  - Widen the shared set to MM/dd/yyyy and region-zoned ISO: rejected, because the owner ruled "datebucket shapes".

### D2. Date/time functions live in their own object
- **Structure.** A new `ExpressionDateTimeFunctions` (private[engine]) holds `secondsBetween`, `dateTrunc`, `addDays`, the `TruncUnits` list and output formatting. `ExpressionInterpreter.applyFn` delegates the three names to it.
  - Registry lists: `SupportedFunctions` gains the three names (alphabetical, so the unknown-function message lists them).
  - A new `DateTimeFunctions` vector next to `NumericFunctions` drives the parity test.
- **Why.** The interpreter does not grow by another 60 lines, and HEL-1070 gets a pattern to copy (one object per function family, plus registry lists). No generic function-table refactor is done here: it is speculative, and it would be HEL-1070's call.
- **Argument rules.**
  - A timestamp argument that is `VStr` or `VNum` goes to `parseInstant`; `None` gives `VNull`.
  - Nulls are already handled by `applyFn`'s null guard.
  - The `n` of `add_days` must be `VNum`, otherwise it is a TypeError (row null, consistent with numeric strictness).
  - `add_days` arithmetic (skeptic r1 #5): `total = BigDecimal(n) * 86400` seconds, rounded HALF_UP to 9 decimal places. It is split into whole seconds (must fit a Long) and a nano remainder, and the result is `ts.plusSeconds(secs).plusNanos(nanos)`. It is never accumulated in a single Long of nanoseconds, which would cap shifts at about 106,751 days. Non-finite `n`, Long overflow, `ArithmeticException` or `DateTimeException` (a result outside `Instant.MIN..MAX`) gives `VNull`. Examples: `add_days("2026-07-01", 1000000)` gives `"4764-05-28T00:00:00Z"`; `add_days("2026-07-01", 1e15)` gives `null`.
  - `ExpressionInterpreter`'s `VNum`/`VStr`/`VNull` are `private`. They are widened to `private[engine]` so the new object can match on and build them; there is no other visibility change.
  - `seconds_between` is computed as `Duration.between(start, end)`, converted to seconds + nanos/1e9 as a Double, plus `+ 0.0` to normalise -0.0.
- **Output format.** `DateTimeFormatter.ISO_INSTANT` (Z suffix; fractional digits only when non-zero, in groups of 3).
- **`date_trunc` week rule.** ISO Monday via `TemporalAdjusters.previousOrSame(MONDAY)` on the UTC date. Month, quarter and year are computed on the UTC date. Second, minute, hour and day use `truncatedTo`.

### D3. The `date_trunc` unit is a parse-time string literal
- **Bare identifier (skeptic r1 #2).** In `StrictParser`, when the function name is `date_trunc` and the first argument token is a `Token.Ident` (a bare word like `day`), the parser returns the units message itself, before `parseFactor` would return the `$`-prefix message. That message is not `DollarPrefixRequiredMsg`, so `parseProblem`, `evaluate` and `compile` never take the legacy fallback for it, and `validate`/`parseProblem` both report the units message. This is pinned by scenarios on both entry points. More generally (skeptic r2 note): if parsing `date_trunc`'s first argument fails with the `$`-prefix message at any depth (`-day`, `lower(day)`), the parser reports the units message instead, so no bare word inside the unit position ever reaches the legacy fallback.
- **Single quotes.** `date_trunc('day', $ts)` still fails in the tokenizer ("Unexpected character"). The grammar has only double-quoted strings, and this is documented in the grammar doc rather than special-cased.
- **Check.** `checkArity` is per-name and per-argc only. A new parser-side check, applied right after `checkArity` in `StrictParser.parseFactor`, requires `args(0)` to be `StrLit(u)` with `u` in `TruncUnits`. Otherwise it is a parse error: `date_trunc unit must be a string literal, one of: second, minute, hour, day, week, month, quarter, year`.
- **Why parse time.** Because of this, `validate`, `validate-expression`, write-path `parseProblem` and `requiredConfigProblems` all reject it with no new plumbing. A unit cannot vary per row, so a per-row null would hide a typo.
- **Units are case-sensitive and lowercase.** The message lists them.
- **Legacy parser.** It is frozen and unchanged. Bare-identifier legacy expressions never contained calls, so this has no effect on them.

### D4. Inference and warnings
- **`inferTypeOf`.**
  - `seconds_between` gives `"float"`; `date_trunc` and `add_days` give `"timestamp"`.
  - `+` gives `"string"` when either side is `"string"` or `"timestamp"`.
- **Why `+` changes.** At the compute boundary a `timestamp`-typed value is always text (see Context), so today `$ts + 1` infers `float` but produces `"…1"`, which is an existing parity hole that this ticket's AC2 makes visible. The executor MUST record evidence of every path by which a `timestamp`-typed field reaches compute: cast, dataset declared schema, source inference, SQL/REST connectors, datebucket output (it emits `"yyyy-MM-dd"` strings but analyze types it timestamp?). The evidence must show that none delivers a JSON number. If any does, stop and escalate instead of shipping the `+` change.
- **`ExpressionNumericContexts`.**
  - `TextTypes` gains `"timestamp"`, so `$ts * 2` and `floor($ts)` warn.
  - `add_days`'s second argument is a numeric context (checked like a numeric-function argument, context name `add_days`).
  - The timestamp arguments of `seconds_between`, `date_trunc` and `add_days` are NOT numeric contexts.
  - `textRefs` descends through `coalesce` and `+` as today. Date-function results infer `timestamp`, so `floor(date_trunc("day",$t))` flags nothing via `textRefs` (it does not descend into other calls), which matches the existing rule.
- **Warning wording (skeptic r1 #1).** The `pipeline-analyze-schema-warnings` "Numeric use of a text field warns" requirement gets a MODIFIED delta: `timestamp` joins the warned types and `add_days`'s day count joins the numeric contexts. For a `timestamp` field, the suggestion is to use `seconds_between(end, start)` (for differences) or `add_days` (for offsets), never a cast step: a cast of a timestamp string to a number yields `null`. `AnalyzeSchemaWarnings.computeNumericWarnings` selects the suggestion per the field's projected type.
- **`AnalyzeSchemaWarnings.family`.** It keeps `timestamp` as "not pinned" for join-key purposes. That is a different question (Instant objects inside join indexing) and is not changed.

### D5. Documentation surfaces (AC3)
- **`docs/compute-expression-grammar.md`.**
  - Add function table rows, an inference list entry, examples (queue time), and accepted timestamp shapes.
  - Note that there is no `now()` and that `-` is not supported on timestamps.
  - Add a Spark divergence note.
  - Correct the stale `SourceService.applyComputedFields` mentions where this file carries them.
- **Frontend `ComputeFieldConfig.tsx`.** Add a compact, collapsible "Functions" reference: a `<details>`/disclosure using existing shared components and tokens per DESIGN.md. It lists every supported function with a one-line signature and gloss, including the three new ones. The list is a typed constant in a small module (e.g. `computeFunctionReference.ts`).
  - Drift guard (skeptic r1 #4): the fixture is `shared-test-fixtures/compute-expression-functions.json`, following the existing three-way seam convention (`join-step-config.json` is read by `JoinStepConfigSeamSpec`, `JoinConfig.seam.test.tsx` and `joinStepSeam.test.ts`). A backend spec asserts the fixture equals `SupportedFunctions`. A Jest test asserts it equals the frontend constant's names. A helio-mcp test asserts every fixture name appears in the shared description constant.
  - The help must not be a decorative dead control: it must be keyboard reachable with a real accessible name.
- **helio-mcp.**
  - `add_pipeline_step`'s description gains a `compute → {column, expression}` entry with the function list and date semantics.
  - The pipeline-proposal tool description (`pipelineProposal.ts`) points at the same text, from one exported constant so both stay in sync.
  - A helio-mcp test asserts that the constant names every backend function, using the same fixture as above.
- **`ExpressionEvaluator` scaladoc.** The grammar summary gains the new functions, and the stale `SourceService.applyComputedFields` references there are corrected (this file is touched anyway).

### D6. Tests (red first, recorded)
Each group's red run against unmodified code is captured in `red-evidence.md`.
- **Parser.** A table-driven `TimestampParsingSpec` (`parseInstant`) covers every accepted and rejected shape: epoch s/ms as Long, Double, numeric string and scientific string; Z; offset; T-local with 0/3/6/9 fraction digits; space-local with and without seconds and fraction; bare date; blank; garbage; invalid month/hour; fractional epoch.
- **Agreement.** An agreement spec runs each shape through `DateBucketStep.apply`, `ComputeStep.apply` with `date_trunc("day", …)`, and `CastStep.apply` to `timestamp`, and asserts the spec's agreement scenario. A characterisation table pins datebucket's pre-change outputs for every input, including the enumerated D1 delta rows (old value `null`).
- **Functions.** `ExpressionDateTimeFunctionsSpec` covers every spec scenario: leap day, DST-free, mixed date/timestamp, offsets, fraction/sign, nulls, unparseable, epoch numbers, `add_days` overflow, `-0.0`, the unit literal parse errors, and the unknown-function message listing.
- **Inference/apply parity.** For every name in `DateTimeFunctions` (iterated, like the `NumericFunctions` parity test), `inferType` must match the evaluated `JsValue` kind. This also covers the `+` timestamp rule and the `TextTypes` warning additions (`NumericOpOnTextFieldWarningSpec`).
- **Seam/integration.** A `ComputeExpressionRunSpec`-style spec uses `VerifiedEmbeddedPostgres.start`. It loads a real CSV source with `created_at,started_at`, then a cast to timestamp, then compute `seconds_between($started_at, $created_at)`, then a pipeline run. It asserts:
  - analyze's projected type equals `float`;
  - the materialised value is a JSON number;
  - one unparseable row is null and the run succeeded;
  - a `date_trunc` column projects `timestamp` and is a string.
  - It also hits `POST /api/pipelines/:id/validate-expression` with a bad unit, expecting `valid:false` with the units message.
- **Frontend.** A Jest/RTL test for the help disclosure (renders, toggles, lists the date functions).
- **helio-mcp.** Description and fixture tests.
- **Every sbt run's output must show `[hel1468-guard]`.** No inline FQNs.

## Risks / Trade-offs

- **[Risk] The `+` inference change re-types existing pipelines.** Analyze for a stored `$ts + …` compute step now says `string` where it said `float`. → It now matches what the run already produced. The executor must grep stored-config-shaped fixtures and tests for affected expectations, and list them.
- **[Risk] The datebucket JSON-number epoch fix changes a few previously-null outputs.** → This is spec-mandated behaviour. It is pinned by the characterisation table, and the zero-parse-rate failure rule is unaffected except where it now succeeds.
- **[Risk] Cast and datebucket still differ for `MM/dd/yyyy` and region-zoned ISO strings.** Cast keeps them; datebucket and compute read them as null. This is the pre-existing HEL-1436 D3 owner ruling. → Documented in the grammar doc; candidate follow-up.
- **[Risk] HEL-1316 (window step) is editing analyze and the step codecs concurrently.** → Re-sync with origin/main before the PR, then re-run the gates.
- **[Risk] The Spark path rejects the new functions.** → Pre-existing divergence, documented.

## Migration Plan

No DB migration (the next free number, V124, stays unused). No API shape change. Deploy is the normal backend + frontend release. Rollback is a revert.
