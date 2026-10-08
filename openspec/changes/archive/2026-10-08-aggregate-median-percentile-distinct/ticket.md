# HEL-1310: aggregate step: add median, percentile and count-distinct

## Description

Found while designing the CI Health dashboard in helio-news: duration p50/p90/p95 and distinct failing-test counts. These were computed in Python.

Evidence: `backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala:74` `SupportedFunctions = Vector("sum", "avg", "min", "max", "count")`; execution at `:124-128`.

Add `median`, `percentile` (parameterised, p50/p90/p95 or 0-100), and `count_distinct`, with apply/infer parity, allowedOps wiring, schema and StepCard UI (see the pipeline op wiring checklist).

## Acceptance criteria

- [ ] median/percentile/count_distinct produce correct values on grouped and ungrouped input, including empty/null handling (tests).
- [ ] analyze/infer output types match apply.
- [ ] The functions are selectable in the step editor and accepted by MCP/proposal validation.
