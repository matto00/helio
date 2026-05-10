# HEL-193 — Pipeline operation: Limit

## Title
Pipeline operation: Limit

## Description
Step type: cap the output to N rows. Useful for top-N panels. UI: numeric input for row count. Applied after any sort steps.

## Acceptance Criteria
- A "Limit rows" step can be added to a pipeline in the UI
- The step has a numeric input for row count (N); N must be > 0
- When executed, only the first N rows are passed downstream
- The analyze endpoint treats limit as a pass-through (output schema = input schema)
- The InProcessPipelineEngine applies the limit by truncating the row sequence to N
- Config shape: `{"count": <int>}`
- Invalid or missing count is a no-op (engine treats it as no limit); UI rejects N <= 0
- Backend tests cover: limit to N rows, count=0 no-op, count > row count returns all rows
- Frontend: LimitConfig component with numeric input, wired into PipelineDetailPage

## Parent
HEL-141 (pipeline epic)
