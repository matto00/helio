## Standing Constraints

- [C1] Budget is a fixed 2 s per step evaluation shared by all rows; no environment variable (owner ruling, escalation HEL-1676-1792518291055-95c8d3).
- [C2] No frontend file changes; no RE2/J; no validation-time pattern rejection.

## 1. Red tests

- [x] 1.1 Add a stringops `extractRegex` test with `^(.*a){12}$` on a long `a...b` value, awaited with a bounded timeout, asserting a step error naming the step within 2 s + slack; confirm it fails on unfixed code (bounded, record the red output)
- [x] 1.2 Same for an assert step with a `regex` rule (step error, not a rule result); confirm red
- [x] 1.3 Add a multi-row accumulation test (each row well under 2 s, total well over 2 s)
- [x] 1.4 Add a draft-preview route test: the timed-out request finishes with an `error` line naming the step, then two concurrent draft-preview requests are both admitted

## 2. Implementation

- [x] 2.1 Add `RegexTimeBox.scala` (fixed 2 s `StepBudget`, deadline, deadline-checking `CharSequence`, `RegexTimeBudgetExceeded extends IllegalArgumentException`)
- [x] 2.2 Route `StringOpsStep.extractRegexFn` matching through one step-level deadline
- [x] 2.3 Route `AssertStep` `regex` rule matching through one step-level deadline and let the timeout propagate as a step error

## 3. Verification

- [x] 3.1 Add a corpus test proving wrapped and plain matching give identical results (anchors before `\n`, `.` vs `\r`/`\u0085`, `\s` vs `\u000B`, lookaround, backreference, unicode)
- [x] 3.2 Record mutation checks: no throw -> red; per-row deadline -> 1.3 red; assert swallow -> 1.2 red
- [x] 3.3 Existing StringOps, Assert, draft-preview and engine specs green unchanged; `sbt testFull` under the lock
