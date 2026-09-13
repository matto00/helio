### Backend

- [x] 1.1 Run a fresh repo-wide grep for `validateMetricName` (Scala main+test, TS/TSX, md/json/yaml, excluding node_modules) and confirm zero live callers remain.
- [x] 1.2 Delete `validateMetricName` (including its scaladoc) from `backend/src/main/scala/com/helio/api/http/RequestValidation.scala`.
- [x] 1.3 Confirm `ExpressionEvaluator.validateTolerant` is untouched.
- [x] 1.4 Confirm no test file exists solely for `validateMetricName`; delete one if found (none expected).

### Tests

- [x] 2.1 `sbt compile` is green.
- [x] 2.2 `sbt test` (full backend suite) is green.
- [x] 2.3 Run the repo's actual CI check scripts (e.g. `check:scala-quality`), not just `sbt test`, since deleting a method/comment can shift line-number-pinned baselines; update any stale pinned baseline if one references the deleted range.
