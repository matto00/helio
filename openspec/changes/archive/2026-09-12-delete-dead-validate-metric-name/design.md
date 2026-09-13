## Context

`RequestValidation.scala` (`backend/src/main/scala/com/helio/api/http/RequestValidation.scala`)
holds `validateMetricName` at line 144, a leftover from the retired Metrics feature
(HEL-903/904). A fresh repo-wide grep (Scala main+test, TS/TSX, md, json, yaml,
excluding node_modules) confirms zero live callers — only the method's own
definition and mentions inside archived openspec planning docs
(`openspec/changes/archive/2026-08-10-metric-crud-service-routes/*`,
`openspec/changes/archive/2026-09-12-fix-stale-datatype-comments/*`). No dedicated
`RequestValidationSpec` test file exists, and no test references the method by name.

## Goals / Non-Goals

**Goals:**
- Remove the dead method and any doc comment attached to it.
- Leave every other member of `RequestValidation` untouched.

**Non-Goals:**
- Do not touch `ExpressionEvaluator.validateTolerant` (a different class, still
  exercised by `ExpressionEvaluatorSpec`) — explicitly excluded by the ticket.
- Do not perform any broader dead-code sweep; other candidates surfaced
  incidentally go in the closing comment as follow-up notes only.

## Decisions

- **Delete `validateMetricName` outright**, including its scaladoc, rather than
  deprecating it — it has zero callers, so there is no migration window needed.
- **No test deletion needed**: confirmed no test file exists solely (or at all) for
  this method, so this ticket's "delete tests that exist only for it" clause is a
  no-op, not skipped.
- **No spec delta**: this is a pure implementation-level removal with no
  API/behavior surface change (the method was never called), so `skip_specs: true`
  is set in `.openspec.yaml` per the proposal.
- **Gate-chain check**: the diff does not touch `.husky/**` or any pre-commit
  script — the CON-132 checklist section does not apply to this change.
- **Line-number-pinned baselines**: per driver context, deleting a method (and its
  scaladoc) can shift line numbers that some CI check scripts pin against (e.g.
  `check:scala-quality`). The executor must run the actual CI check scripts (not
  just `sbt test`) after the deletion, and update any pinned baseline if one
  references a line inside or after the deleted range.

## Risks / Trade-offs

- Low risk: dead code with confirmed zero callers, single-file diff.
- Main risk is a stale line-number baseline elsewhere in CI config; mitigated by
  running the actual check scripts as part of verification, not just `sbt test`.

## Planner Notes

- Self-approved: no design-gate-worthy architectural decision here beyond "delete
  it cleanly and verify no baseline references its old line range." No escalation
  raised for this ticket.
