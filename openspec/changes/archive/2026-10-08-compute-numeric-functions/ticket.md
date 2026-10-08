# HEL-1315: compute step: numeric functions (floor, round, mod, abs)

## Description

Found while designing the CI Health dashboard in helio-news: rounded pass-rate percentages and bucketed values were
computed in Python.

Evidence: `backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala:31` function calls limited to
`concat, substring, lower, upper, length`.

What: Add `floor`, `ceil`, `round(x[, digits])`, `mod`, `abs` to the expression evaluator, with infer/apply parity.

## Acceptance criteria

- [ ] Each function returns correct values including negatives and null input (tests).
- [ ] Inferred types match applied types.
- [ ] Unsupported-function error message lists the new functions.

## Related (not absorbed)

HEL-1070 (compute conditional/boolean logic), HEL-1314 (date/time arithmetic), HEL-1310 (aggregate median/percentile).
