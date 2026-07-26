## Why

`helio-news`'s `build_bound_panel()` needs 6 sequential MCP round-trips (source → pipeline →
N×step → run → panel → bind → appearance) to build one panel; a failure at any step orphans
prior resources. HEL-337's shape-instantiation composition (HEL-399/400) deliberately solved a
sibling problem client-side, with **no new backend endpoint and no rollback** — the right call
for a human who can retry visually. An unattended agent has neither luxury: it needs one HTTP
call with real up-front validation and defined failure semantics. This ticket adds that endpoint.

## What Changes

- New `POST /api/panels/bound` endpoint + `BoundPanelService`, composing existing
  `DataSourceService`/`PipelineService`/`PipelineRunService`/`PanelService` calls (no new tables).
- **Validate before the first write**: given `source` (inline schema) or `sourceDataSourceId`
  (existing, read-only), and the requested pipeline steps, compute the projected output schema via
  `PipelineAnalyzeService` and check it against the requested panel type/`fieldMapping` using
  HEL-365's `PanelBindingSpec` — reject an unsatisfiable binding with 400 before creating anything.
- Pipeline run is synchronous (verified against `PipelineRunService`) — the response returns
  source/pipeline/DataType/panel ids with rows already written.
- **Failure semantics**: post-validation-gate failures name the failed stage and trigger
  best-effort compensating cleanup — delete the newly created output DataType (FK-cascades to the
  pipeline + steps) and, if created inline, the new DataSource — never leaving a bound-to-nothing
  panel. A zero-row run is success, not failure.
- Reuses `PanelService.buildForCreate` (HEL-363 precedent) for panel construction, so V41
  pipeline-only-binding enforcement and appearance-at-creation both apply for free.
- MCP `create_bound_panel` tool (`helio-mcp/src/tools/write.ts` + `helioApi.ts`) wrapping the
  endpoint; `schemas/` + `openspec/` contract updates.

## Non-goals

Batch/multi-panel creation (HEL-370), new step types or shape presets (HEL-336/337), layout
placement (HEL-367), resource tagging (HEL-366), panel id key (HEL-368) — not absorbed here.

## Capabilities

### New Capabilities

- `bound-panel-composition`: the compound `POST /api/panels/bound` contract — request/response
  shape, validate-before-write gate, synchronous-run semantics, compensating-cleanup failure
  behavior, and multi-tenant scoping of every resource in the chain.

### Modified Capabilities

- `mcp-panel-composition-tools`: add the `create_bound_panel` tool requirement (collapses
  `build_bound_panel`'s 6 calls into 1; existing granular tools are unchanged/still offered).

## Impact

Backend: new route file, new `BoundPanelService`, composes 4 existing services read-only where
possible. `helio-mcp`: new tool + client method. `schemas/`, `openspec/specs/`: new/updated
contracts. No migration expected (no new tables/columns).
