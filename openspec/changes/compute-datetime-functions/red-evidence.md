# Red evidence (HEL-1314)

Transcripts live in `/home/matt/Development/helio/.concertino/runs/HEL-1314/evidence/`.

## Group 1 -- shared timestamp parser (tasks 1.1)

- `TimestampParsingSpec` against unmodified code: test compilation fails, `value parseInstant is not a member of object TimestampParsing` and
  `value parseNonEpochInstant is not a member of object TimestampParsing` (4 errors); no tests run.
- `DateBucketCharacterisationSpec` against unmodified code (TimestampParsingSpec moved aside so test sources compile): 30/30 green. It pins
  the current datebucket output for every shape; the five `pin ...` rows record the D1 delta inputs at their OLD value `null`
  (`red-char-pre.txt`).

### Group 1 green (tasks 1.2, 1.3)

- `green-group1.txt`: after `TimestampParsing.parseInstant`/`parseNonEpochInstant` and routing DateBucketStep/CastStep through them,
  167/168 green across TimestampParsingSpec, DateBucketCharacterisationSpec (delta rows flipped, listed below), DateBucketStepSpec,
  CastStepSpec, CastRuntimeParitySpec, CastSupportedTargetsSpec, FirstRunPlannerSpec. The one failure was the pre-existing
  `CastStepSpec` "a Double epoch ... yields null" row, which is exactly a D1 delta input.
- `green-group1b.txt`: CastStepSpec after updating that row (now expects the string form `"1.7513712E9"`, plus a fractional-Double-is-null row).
- D1 delta rows, old value `null` -> new value (datebucket `day`): whole `Double` epoch `1771286400.0`, `BigDecimal("1.7712864E+9")`,
  `"1771286400.0"`, `"1.7712864E9"` -> `2026-02-17`; `"1e3"` -> `1970-01-01`. Cast to timestamp/date of a whole `Double` epoch: `null` -> kept.
  Every other characterisation row is unchanged.
- `parseNonEpochDate` regression: `"1771286400"`, `"1771286400000"`, `"1.7712864E9"`, `"1771286400.0"`, `"-1"` still `None`.

## Group 2 -- date/time functions (tasks 2.1, 2.2)

- `red-group2.txt`: `ExpressionDateTimeFunctionsSpec` against code with only the `DateTimeFunctions` registry vector present (needed to compile):
  26 of 29 failed (the 3 passes are the pre-existing guards: no `now()`, single-quote tokenizer error, `-` stays numeric-only).
- `green-group2.txt`: after `ExpressionDateTimeFunctions`, parser arity + unit-literal check, `applyFn` delegation: ExpressionDateTimeFunctionsSpec,
  ExpressionEvaluatorSpec, ExpressionUnaryMinusSpec, ComputeStepSpec, PipelineAnalyzeServiceSpec 305/305, `[hel1468-guard]` failed=0.
- Altered existing expectations (all the same cause, three new names in `SupportedFunctions`): the unknown-function message list in
  `ExpressionEvaluatorSpec` (x2), `ComputeStepSpec`, `PipelineAnalyzeServiceSpec`; `SupportedFunctions` size 11 -> 14; the NumericFunctions
  partition now also subtracts `DateTimeFunctions`; the list<->dispatcher probe passes a string-literal first argument so `date_trunc` parses.

## Group 3 -- inference, parity, warnings (task 3.1)

- `red-group3.txt`: `ExpressionDateTimeInferenceSpec` and the new `NumericOpOnTextFieldWarningSpec` section: 7 failures
  (infer parity `date_trunc`/`add_days`, composition, `$ts + 1` string; timestamp subtraction / `$ts * 2` / text day count warnings;
  the former "abs() over a timestamp-cast field neither warns" guard, rewritten to the new behaviour).
- Tasks 3.2 stop point reached: see `timestamp-paths-evidence.md`. 3.3 not implemented.

## Group 3 green (task 3.3)

- `green-group3.txt`: `testOnly com.helio.domain.engine.*` 918/918, `[hel1468-guard]` failed=0, after `inferTypeOf` (`+` with `timestamp` infers `string`; date functions),
  `TextTypes += timestamp`, `add_days` second argument as a numeric context, and the timestamp-specific warning suggestion.
- Existing expectation altered by the `+`/TextTypes change: only the `NumericOpOnTextFieldWarningSpec` timestamp-cast `abs()` guard (above). No stored-config
  fixture expected `float` for a `timestamp + x` expression (grep of the engine/service specs; full `testFull` confirms).

## Group 4 -- seam (task 4.1)

- `ComputeDateTimeRunSpec` (CSV -> cast timestamp -> compute `seconds_between` + `date_trunc` -> real run -> `node_snapshots`, analyze `outputSchema` float/timestamp).
- Red: `red-group4.txt` -- with `backend/src/main` stashed to the pre-change tree the test sources do not compile (the new specs reference `DateTimeFunctions`),
  so no behavioural red is available from the unmodified tree. Instead a mutation proves the spec can fail: `mutation-group4.txt` flips `Duration.between(s, e)`
  to `(e, s)` in `seconds_between` and the spec goes red; reverted, `green-group4.txt` is 1/1 green.

## Groups 4.2, 5, 6

- 4.2 `TimestampAgreementSpec` (datebucket / compute `date_trunc` / cast agree on every shape): green on arrival (`green-group4c.txt`). Its only rows that were
  red before group 1 are the JSON-number / decimal-or-exponent epoch inputs, already recorded as the null -> parsed delta in Group 1.
- 5.2-5.4 seam fixture `shared-test-fixtures/compute-expression-functions.json` read by `ComputeExpressionFunctionsSeamSpec` (backend), `computeFunctionReference.test.ts`
  (frontend) and `computeExpressionDescription.test.ts` (helio-mcp). These guards are failable by removing a name from the fixture/constant/engine list; no recorded mutation run.
- Frontend: the first full jest run failed `tokenAuditSweep` (a raw `gap: 2px` in the new CSS, `gate-jest-full.txt`); fixed to `var(--space-1)`.
- 6.1 gates (transcripts in the evidence dir): `gates-static.txt` (lint, format:check, typecheck, helio-mcp typecheck, scala-quality, openspec, credential-leak: all exit 0),
  `gate-backend-testFull.txt` (`[hel1468-guard]` failed=0, 504 suites, 6886 passed, 0 failed), `gate-jest-frontend.txt` (517 suites, 5540 passed), root/helio-mcp jest 46 suites 444 passed
  (`gate-jest-full.txt`), `gate-frontend-build.txt` (exit 0). Not run: a browser visual-cohesion pass of the new disclosure (jsdom cannot see layout).
- Re-sync with origin/main (HEL-1316, bc8ccac45): resync-*.txt; DateBucketStep conflict resolved keeping parseToUtcDate private[steps] delegating to parseInstant; window rolling-days agreement row added.
