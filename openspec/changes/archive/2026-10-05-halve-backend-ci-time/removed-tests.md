# Removed tests ledger (HEL-1287)

Survey method and every kept candidate are in profile.md "Redundancy survey". One test removed.

| # | removed (suite : test) | reason class | surviving test (file:line) | surviving assertion (quoted) |
|--|--|--|--|--|
| 1 | `backend/src/test/scala/com/helio/domain/steps/DateBucketStepSpec.scala` : "does not fail on a partially-parseable input — still nulls the unparseable row, doesn't fail the step" (was at line 144, inside "DateBucketStep.evaluate — zero-parse-rate guard") | duplicate (identical rows, identical `evaluate(rows, step(granularity = "day"))` call, identical assertions) | `backend/src/test/scala/com/helio/domain/steps/DateBucketStepSpec.scala:98` "a partially-parseable input nulls only the unparseable row, without failing the step (discriminate parser, per-row null-on-failure preserved)" | line 104 `result.head("ts") shouldBe "2026-03-17"` and line 105 `result(1)("ts").asInstanceOf[AnyRef] shouldBe null`, with `evaluate` not throwing (an exception would fail the test) |

Removal was not motivated by flakiness.
