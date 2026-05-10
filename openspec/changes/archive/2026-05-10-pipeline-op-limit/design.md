## Context

The pipeline op suite already handles `"limit"` in `PipelineAnalyzeService` (line 64: pass-through).
The gap is `InProcessPipelineEngine`, which falls through to `Future.failed` for the `"limit"` op,
and the frontend, which has no `LimitConfig` component or op-type entry.

Config shape used by existing ops: JSON objects stored as strings in `PipelineStepRow.config`.
Filter uses `{"combinator":…,"conditions":[…]}`, aggregate uses `{"groupBy":[],"aggregations":[]}`.
Limit uses the simplest possible shape: `{"count": <int>}`.

## Goals / Non-Goals

**Goals:**
- Wire `"limit"` into `InProcessPipelineEngine.applyStep` with a safe, pure implementation
- Add `LimitConfig` component in the frontend (numeric input, N > 0 validation)
- Wire `LimitConfig` into `PipelineDetailPage` (op type entry, initial config, parse helper, render)
- Verify analyze service already handles limit correctly (it does — no changes needed)

**Non-Goals:**
- Spark-side limit execution
- Sort-then-limit ordering guarantee (limit truncates whatever order rows arrive in)

## Decisions

**D1: Config shape `{"count": <int>}`**  
Simplest possible shape; mirrors `{"fields":[]}` (select) and `{"renames":{}}` (rename) precedents.
Backend parses with `cfg.fields.get("count").map(_.convertTo[Int]).getOrElse(Int.MaxValue)` so
missing/invalid count is a safe no-op (returns all rows).

**D2: Count <= 0 is a no-op in the engine, UI rejects it**  
Engine: treat count <= 0 as `Int.MaxValue` (no limit) — this prevents crashes on bad data.
UI: disable/reject N <= 0 with inline validation text. This split keeps the backend robust while
giving users clear feedback.

**D3: No changes to `PipelineAnalyzeService`**  
Already handles `"limit"` on line 64 (`case "filter" | "limit" | "sort" => (inputSchema, None)`).
Output schema = input schema. Verified by existing test coverage.

**D4: `LimitConfig` is a thin component**  
Single numeric input (type="number", min=1). Calls `onChange` with JSON string on every valid change,
matching the pattern used by `FilterConfig` and `AggregateConfig`.

## Risks / Trade-offs

[Risk] Engine silently ignores invalid count → Mitigation: UI rejects N <= 0; engine no-op is safe.
[Risk] Forgetting to add the op to `OP_TYPES` in `PipelineDetailPage` → Mitigation: tasks checklist.

## Planner Notes

Self-approved — no new external dependencies, no API contract changes, no breaking changes.
The `PipelineAnalyzeService` already accounts for this op; the engine gap is the only backend change.
