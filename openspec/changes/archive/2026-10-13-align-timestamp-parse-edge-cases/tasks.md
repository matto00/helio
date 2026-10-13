## Standing Constraints

- [C1] Do not modify any file in the diff of parked PRs #996 or #986 (`gh pr diff 996 --name-only`, `gh pr diff 986 --name-only`), including `TimestampNumberParitySpec.scala`, `ExpressionEvaluator.scala`, `ExpressionTypeInference.scala`, `ComputeTypeWarningsSpec.scala`.
- [C2] `looksLikeTimestamp` is unchanged; no migration.
- [C3] Each reject class is shown RED (the changing side disagrees) before its fix; quote the failing output.
- [C5] The D2 gate runs BEFORE every existing reader (the STRICT `uuuu` space reader alone would newly admit `0000-07-01 12:00`).
- [C4] Every pre-existing fixture case and characterisation row keeps its result.

### Backend

- [x] 1.1 Probe and record current backend + chart result for every D1 example (both separators where applicable)
- [x] 1.2 Add the D2 shape-aware syntactic gate (written year incl. `MM/dd/yyyy`; time-field-only fraction/`:60`/hour-24 checks) before every reader
- [x] 1.3 Switch `SpaceSeparatedFormatter` to `uuuu` + `ResolverStyle.STRICT`
- [x] 1.4 Update `parseInstant`'s doc comment to state the rejections

### Frontend

- [x] 2.1 `utcMillis` rejects year < 1; LOCAL branch of `parseChartInstant` rejects a fraction without seconds
- [x] 2.2 Update `parseChartInstant`'s doc comment to match

### Tests

- [x] 3.1 Add fixture cases for every D1 class plus the D4 boundary positives
- [x] 3.2 Set both sides' minimum case count to the same new total (`ChartTimestampParsingParitySpec`, `chartTimeAxis.test.ts`)
- [x] 3.3 `TimestampParsingSpec`: unit rows for each reject class and boundary positive
- [x] 3.4 `DateBucketCharacterisationSpec`: move the `MM/dd/yyyy` row to a "changed by HEL-1502" group; add a HEL-1532 group
- [x] 3.5 Compute-step test: `date_trunc("hour")` over the two bracketed-id inputs
- [x] 3.6 Datebucket-step test: epoch-bound positives `253402300799999` and `-62135596800000`
- [x] 3.7 Run the bounded differential check (D4) and record input count + disagreements in evaluation evidence
