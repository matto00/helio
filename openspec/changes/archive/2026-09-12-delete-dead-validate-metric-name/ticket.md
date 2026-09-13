# HEL-1126: Delete dead RequestValidation.validateMetricName

## Description

Found during the HEL-1118 triage (2026-09-12): `RequestValidation.validateMetricName` is dead code with no callers since Metrics were retired (HEL-903/904).

**Scope:** delete it, and any tests that exist only for it.

**Do NOT delete** `ExpressionEvaluator.validateTolerant`, which the same triage flagged as a candidate. It is still exercised by `ExpressionEvaluatorSpec`.

**AC:** verify the zero-callers claim with a fresh grep before deleting; compile and the full backend test suite are green.

## Acceptance Criteria

- Fresh grep confirms zero callers of `RequestValidation.validateMetricName` before deletion.
- `RequestValidation.validateMetricName` is removed from `backend/src/main/scala/com/helio/api/http/RequestValidation.scala`.
- Any tests that exist solely to exercise `validateMetricName` are removed (none found as of premise validation — no dedicated `RequestValidationSpec` exists).
- `ExpressionEvaluator.validateTolerant` is left untouched.
- `sbt compile` and the full `sbt test` backend suite are green.
- Any line-number-pinned CI check scripts (e.g. `check:scala-quality`) are re-run, not just `sbt test`, since a comment/method deletion can shift pinned line numbers.
