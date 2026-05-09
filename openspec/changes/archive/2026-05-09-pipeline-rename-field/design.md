## Context

The rename op exists in `allowedOps` (PipelineStepRoutes) and `inferRename` (PipelineAnalyzeService)
but the two sides use divergent config shapes. `InProcessPipelineEngine.applyRename` parses
`{"mappings": [{"from":"x","to":"y"}]}` while `PipelineAnalyzeService.inferRename` parses
`{"renames": {"x": "y"}}`. This mismatch means a rename step would produce an incorrect outputSchema
from analyze (using the map shape) but fail at runtime (engine would not find the `mappings` key).

HEL-187 (select op) established the full integration pattern: engine op, backend tests, a dedicated
`SelectFieldsConfig` component, and wiring in `PipelineDetailPage` using `getAnalyzeColumns` +
`updatePipelineStep`.

## Goals / Non-Goals

**Goals:**
- Align `applyRename` config parsing to the `{"renames": {"from":"to"}}` map shape used by
  `inferRename` — single source of truth
- Implement `RenameFieldsConfig` component following the `SelectFieldsConfig` pattern
- Wire into `PipelineDetailPage`: initial config `'{"renames":{}}'`, hydration, PATCH on change
- Full test coverage on both sides

**Non-Goals:**
- No new REST endpoints or schema changes
- No Spark execution path

## Decisions

**Config shape: map, not array of objects**
`inferRename` (PipelineAnalyzeService, HEL-233) uses `{"renames": {"oldName":"newName"}}`. The engine
must match this. The existing `mappings` array was added in the engine before HEL-233 and is now
superseded. Using a map is also simpler to merge/update from the frontend — a single key assignment
rather than array splice.

**RenameFieldsConfig receives `columns` (from analyze inputSchema) and `renames` (from persisted config)**
Mirrors `SelectFieldsConfig` which takes `columns` and `selectedFields`. The rename UI shows one row
per column with a text input. An empty string value means "no rename" (preserve original name).

**Persist via `updatePipelineStep(step.id, newConfig)` in StepCard**
Same pattern as select: fire-and-forget PATCH on each user interaction; keep local state as truth.
The real backend step ID (not `step-N` counter) is used — guaranteed once the POST for step creation
resolves and the temp step is replaced with the persisted step (existing logic in `handleAddStep`).

**Initial config: `'{"renames":{}}'`**
Empty object means no renames are active. `inferRename` handles this correctly (identity pass-through).

**Hydration: parse `step.config` in StepCard during-render sync (same pattern as selectedFields)**
The existing `prevConfig` / `prevOpTypeId` guard pattern in `StepCard` is extended to also sync
`renames` state. No new hooks needed.

## Risks / Trade-offs

- `applyRename` change is a breaking fix for any existing rename steps persisted with the old
  `mappings` shape. Risk is low: rename was not reachable from the frontend (no config UI) and any
  existing rename rows in the DB would have been manually inserted during development only.
  → Mitigation: no data migration needed; devs can re-create steps.

- Map shape loses ordering guarantees vs the array approach.
  → For rename, order does not matter (each mapping is independent), so this is acceptable.

## Planner Notes

Self-approved decisions:
- Fix engine to match analyze service (not vice-versa) because analyze service is the authoritative
  HEL-233 implementation and is used by the frontend field picker
- No migration script needed — rename UI was never shipped so no production rename step rows exist
- `RenameFieldsConfig` is a new file, not inlined in `PipelineDetailPage`, matching the pattern
  from `SelectFieldsConfig`
