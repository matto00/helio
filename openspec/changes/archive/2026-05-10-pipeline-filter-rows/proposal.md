## Why

Helio's pipeline editor needs a Filter Rows step so users can discard unwanted rows before downstream
transformations. This is the fourth of eight v1 pipeline ops (after Select, Rename, Cast) and unblocks
meaningful end-to-end pipeline workflows. The existing stub `applyFilter` uses a legacy expression-based
config that must be replaced with a structured, UI-friendly condition format.

## What Changes

- **BREAKING (internal)**: Replace `applyFilter`'s `{"expression":"..."}` config shape with the structured
  `{"combinator":"AND|OR","conditions":[{field,operator,value}]}` format. Only the one existing test for
  the expression-based filter is affected; no external API shape changes.
- Add structured `applyFilter` in `InProcessPipelineEngine` supporting 9 operators: `=`, `!=`, `>`, `>=`,
  `<`, `<=`, `contains`, `is null`, `is not null`.
- Add `FilterConfig` React component: a row-per-condition editor with field/operator/value controls and a
  top-level AND/OR combinator toggle.
- Wire `FilterConfig` into `PipelineDetailPage`'s `StepCard` alongside Select, Rename, and Cast.
- Seed initial filter config as `{"combinator":"AND","conditions":[]}` on step creation.

## Capabilities

### New Capabilities

- `pipeline-filter-op`: Structured filter-rows pipeline step with multi-condition AND/OR evaluation.

### Modified Capabilities

- `pipeline-edit-flow`: Filter step config is now wired into the step card editor (was a placeholder).

## Non-goals

- Nested condition groups (defer to a future ticket)
- Date-type-aware comparison (dates treated as strings for v1)
- Spark-path filter pushdown (in-process engine only for v1)
- Filter step validation errors surfaced in the analyze endpoint (identity fallback already handles this)

## Impact

- `InProcessPipelineEngine.scala`: replaces `applyFilter` method body and its one existing test
- `PipelineAnalyzeService.scala`: no change needed (filter is already identity)
- `PipelineDetailPage.tsx`: adds `parseFilterConfig`, filter state, `handleFilterChange`, and wires
  `FilterConfig` in `StepCard`
- New files: `FilterConfig.tsx`, `FilterConfig.test.tsx`
- Backend tests: `InProcessPipelineEngineSpec.scala` — old expression test replaced; 9+ new tests added
