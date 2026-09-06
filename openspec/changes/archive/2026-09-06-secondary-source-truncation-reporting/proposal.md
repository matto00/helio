## Why

A run that truncates a **secondary** source (`join`/`union`/`lookup`) emits structured fields that contradict each
other: `truncated: true` next to `sourceRowCount: 100` and `availableRowCount: 100`. An agent branching on
`availableRowCount > sourceRowCount` concludes nothing was lost, which is the opposite of the truth. The correct
per-source detail already exists on the backend wire as `truncatedReads` and is discarded by the MCP client, leaving
an agent with a contradictory numeric pair plus a prose sentence it would have to parse to recover what the backend
already computed. This was real, diagnosed data loss in the HEL-857 field rebuild.

## What Changes

- Resolve the scoping ambiguity **in the field names at the MCP surface**, per the existing spec decision that
  `sourceAvailableRowCount` is primary-only while `sourceTruncated` is run-wide. `RunOutcome.availableRowCount`
  becomes `primaryAvailableRowCount` and `sourceRowCount` becomes `primarySourceRowCount`, so no two same-scope
  numbers sit next to a differently-scoped boolean. **BREAKING** for readers of the `run_pipeline` tool result;
  helio-mcp is a first-party server with no pinned external consumer.
- Surface `truncatedReads` (`dataSourceName`, `rowsRead`, `availableRowCount`) on the MCP `run_pipeline` result. It is
  declared on the `RunResultResponse` wire type and mapped through `runPipeline`. This is the machine-readable form of
  the loss; the prose notice stops being the only way to recover it.
- State the scope of every returned truncation field in `run_pipeline`'s tool description.
- Cover the secondary-source case by measurement: primary NOT truncated, secondary truncated, asserting the emitted
  structure field by field.

No backend wire change, no schema change, no migration, no frontend change. The backend already computes and returns
`truncatedReads` correctly; only its scaladoc is sharpened where it is thin.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-run-truncation-reporting`: the MCP-surface requirement gains per-source `truncatedReads`, explicit
  scope-carrying field names, and a scenario for the secondary-truncated / primary-complete case that the current
  MCP scenarios cannot distinguish.

## Non-goals

- Changing the backend HTTP wire shape (`sourceTruncated` / `sourceAvailableRowCount` / `sourceRowCount` keep their
  names and meanings — they are spec'd, documented, and consumed by the frontend and `schemas/`, which a concurrent
  run is editing).
- Changing the 1000-row run cap, or making it configurable.
- Any frontend or UI work.
- Changing the composed `truncationNotice` wording.
