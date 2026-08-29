## 1. Backend

- [x] 1.1 Add a private `numericFieldValue(v: Any): Option[Double]` helper to `FilterStep` matching only
  `Int | Long | Float | Double | BigDecimal | java.math.BigDecimal` (design D5); verify by compiling with
  `sbt compile` and by the unit tests in group 3 exercising a `String` row value and getting `None` behaviour.
- [x] 1.2 Rewrite the `case "=" | "!=" =>` arm of `FilterStep.evalCondition` so that when
  `numericFieldValue(fieldVal)` and `value.flatMap(_.toDoubleOption)` are both defined the comparison is
  numeric, and every other combination falls through to today's exact string comparison with today's null
  handling (design D1/D2/D3); verify by `sbt "testOnly com.helio.domain.steps.FilterStepSpec"` passing.
- [x] 1.3 Leave `contains`, `is null`, `is not null`, the ordering operators and the fallthrough arm
  untouched; verify by `git diff backend/src/main/scala/com/helio/domain/steps/FilterStep.scala` showing
  changes confined to the `=`/`!=` arm plus the new helper.

## 2. Survey

- [x] 2.1 Query saved pipeline step configs for filter steps carrying a `=` or `!=` condition, and report
  which of those reference a field whose materialised row values are numeric (and therefore match nothing
  today); verify by an included transcript of the query and its result, and record "none found" explicitly
  if that is the outcome.

## 3. Tests

- [x] 3.1 Add a failing test to `FilterStepSpec` asserting a row with numeric `years_exp = 0` is returned by
  `{"operator":"=","value":"0"}`; verify the RED by running it against unmodified `FilterStep` (stash the
  production change) and pasting the failure output into the executor report before applying the fix.
- [x] 3.2 Add tests for numeric `=` with condition values `"0"`, `"0.0"`, a non-matching number, and a
  non-numeric condition value; verify all pass after the fix and that 3.1's assertion is on returned rows,
  not on a helper's return value.
- [x] 3.3 Add tests pinning string columns: `position = "WR"` matches, `player_id` `String "007"` does NOT
  match `= "7"`, and `String "007"` DOES match `= "007"`; verify each fails if the numeric path is widened
  to parse string row values (state this by temporarily applying the symmetric rule and pasting the red).
- [x] 3.4 Add tests for `!=` mirroring 3.2/3.3, and for null/absent row values under both `=` and `!=`;
  verify they pass and encode the pre-existing null asymmetry from design D2.
- [x] 3.5 Add a `contains` test showing numeric `10` matches `contains "1"` textually (design D4); verify by
  the test passing and by the decision being stated in `design.md`.
- [x] 3.6 Run the full backend suite `sbt test` and verify no existing filter, sort, aggregate or pipeline
  test regresses.
