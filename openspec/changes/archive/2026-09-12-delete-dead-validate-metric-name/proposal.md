## Why

`RequestValidation.validateMetricName` has had zero callers since Metrics were retired
in HEL-903/904, flagged as dead code during the HEL-1118 triage. Dead code carries
maintenance and comprehension cost with no behavioral upside.

## What Changes

- Remove `RequestValidation.validateMetricName` from
  `backend/src/main/scala/com/helio/api/http/RequestValidation.scala`.
- Remove any tests that exist solely to exercise it (none found — no dedicated
  `RequestValidationSpec` exists and no test references the method).

## Non-goals

- Deleting `ExpressionEvaluator.validateTolerant` — still exercised by
  `ExpressionEvaluatorSpec`; explicitly out of scope per the ticket.
- Any other dead-code cleanup surfaced incidentally will be noted in the closing
  comment as a follow-up candidate, not acted on here.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — pure dead-code removal, no spec-level behavior change; `skip_specs: true`)

## Impact

- `backend/src/main/scala/com/helio/api/http/RequestValidation.scala` (method removed)
- No callers, no API surface, no schema/spec changes.
