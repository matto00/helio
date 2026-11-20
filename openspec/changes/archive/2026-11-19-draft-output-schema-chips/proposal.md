## Why

During a pipeline draft the "Output schema" chips above "Rows after step N" render the SAVED analyze output schema while
the grid below renders the draft frame (HEL-1631, HEL-1732). A draft rename makes them disagree (chips `region`, grid
`zone`), and the renamed grid column has no type caption because types are looked up by name in the saved schema.

## What Changes

- While a draft is active and the step shows a draft frame, the chips (inline chips and the large-schema
  `OutputSchemaDisclosure`) list exactly the grid's draft columns, in the grid's order, from one shared field list.
- A column the shown step's draft rename produced takes the type of the column it was renamed from, in both the grid's
  type caption and the shared field list.
- No new request: everything is derived from data the page already holds (HEL-1732's `draft.columnOrder`, the draft
  frame, the saved analyze schemas, the step's draft config).

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-draft-mode-ui`: adds a requirement that the draft step preview's "Output schema" chips match the grid.

## Impact

Frontend only: `features/pipelines/ui/spine/StepPreviewTable.tsx` and a small pure helper under
`features/pipelines/state/`, plus tests. No backend, schema, wire or migration change.

## Non-goals

- The draft-preview NDJSON `step` line `schema` hash order (server) is unchanged.
- No type display is added to the chips (they show names, as today).
- Steps with no draft frame on screen (not previewed, first computation pending) keep today's saved chips.
