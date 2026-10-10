# HEL-1436 red evidence

Run on the UNMODIFIED production tree (main 719710c15 + new tests only), `sbt -J-Xmx3g testOnly` over the six new/updated specs. Exit 1; `[hel1468-guard] ScalaTest summary: failed=30`. Every failing assertion is labelled RED; no GUARD-labelled assertion fails (two initially mislabelled GUARD/RED were corrected after this run: 'Double epoch' is RED, 'Long epoch' is GUARD). Full log: red-evidence.log.

- should RED (HEL-1436 D6): a cast mixing float with string is trusted, so abs($string-cast field) warns *** FAILED ***
- should RED (HEL-1436): trust a cast to float (CastStep emits Double) and warn against a string key *** FAILED ***
- should RED: reject a cast step with a string-body target (422) and accept a float target *** FAILED ***
- should RED: cast "1.5" to float yields Double 1.5 *** FAILED ***
- should RED: cast "1.5" to number yields Double 1.5 *** FAILED ***
- should RED: cast of unparseable text to float yields null *** FAILED ***
- should GUARD: a Double epoch (a JSON epoch number) yields null, as datebucket already does *** FAILED ***
- should RED: timestamp of 'tomorrow' yields null *** FAILED ***
- should RED: timestamp of 'abc' yields null *** FAILED ***
- should RED: date of 'tomorrow' yields null *** FAILED ***
- should RED: date of 'abc' yields null *** FAILED ***
- should RED: 'string-body' passes the ORIGINAL value through (a Double stays a Double) *** FAILED ***
- should RED: 'binary-ref' passes the ORIGINAL value through (a Double stays a Double) *** FAILED ***
- should RED: 'foo' passes the ORIGINAL value through (a Double stays a Double) *** FAILED ***
- should RED: rejects target 'binary-ref', naming it and the supported list *** FAILED ***
- should RED: rejects target 'string-body', naming it and the supported list *** FAILED ***
- should RED: rejects target 'foo', naming it and the supported list *** FAILED ***
- should RED: legacy 'string-body' projects the input type unchanged with no validationError *** FAILED ***
- should RED: legacy 'binary-ref' projects the input type unchanged with no validationError *** FAILED ***
- should RED: legacy 'foo' projects the input type unchanged with no validationError *** FAILED ***
- should RED/GUARD: every non-null 'float' cast output has the class family analyze projects *** FAILED ***
- should RED/GUARD: every non-null 'number' cast output has the class family analyze projects *** FAILED ***
- should RED/GUARD: every non-null 'date' cast output has the class family analyze projects *** FAILED ***
- should RED/GUARD: every non-null 'timestamp' cast output has the class family analyze projects *** FAILED ***
- should RED: float amounts are Doubles; timestamp keeps original strings, junk becomes null *** FAILED ***
- should RED: a downstream filter amount = 1.5 matches the CSV cell "1.50" once cast to float *** FAILED ***
- should RED: a real run passes a non-String value through unchanged *** FAILED ***
- should RED: single-call create rejects binary-ref with 422 naming it and the supported list, storing nothing *** FAILED ***
- should RED: step-create route rejects string-body with 422 and stores no step *** FAILED ***
- should RED: a stored legacy binary-ref cast lists, analyzes as passthrough with no validationError, and is not gated *** FAILED ***
*** 30 TESTS FAILED ***

Note: "GUARD: a stored legacy binary-ref cast lists, analyzes with no validationError, and is not gated" (CastTargetWriteRoutesSpec) was labelled RED when this run was recorded; it failed pre-fix only because the route test's empty source schema made an assertion on a projected type throw (None.get). That assertion was removed (the projection is proven RED in CastStepSpec) and the test is now a plain GUARD for C5. Its mutation check is M1.

## Cycle 2: task 1.6 through the production run path (evaluation-1 CR1)

`CastPipelineRunSpec` (CSV data source row -> cast {amount: float, when: timestamp} [-> filter amount = 1.5], `PipelineRunService.submit`, persisted `node_snapshots` rows read back; embedded Postgres via `VerifiedEmbeddedPostgres.start`) was run against a throwaway detached worktree at 719710c15 (unmodified production tree) with only that spec added; the worktree was removed afterwards. Exit 1, `[hel1468-guard] failed=2`, output in `red-evidence-1.6.log`:
- `Vector("1.50", "2.25", "x") was not equal to Vector(1.5, 2.25, null)` (snapshot amounts are strings pre-fix)
- `Vector() was not equal to Vector("1")` (filter amount = 1.5 matches nothing over the string "1.50")
The earlier flat-engine (`executeWithStepCounts`) CSV cases in `CastRuntimeParitySpec` were removed and are not counted as 1.6.
