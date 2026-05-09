## Why

When a user attempts to create a data-bound panel and no DataTypes are registered (i.e. no pipelines
have been run to produce output types), the DataType picker step shows nothing — leaving the user
stranded with no path forward. This confuses new users who have not yet set up pipelines and blocks
panel creation entirely even though the fix is a simple navigation to the pipeline creation flow.

## What Changes

- The DataType picker step in the panel creation modal gains an empty state UI that renders when
  no pipeline-produced DataTypes exist.
- The empty state shows an explanatory message and a "Create pipeline" link that navigates to the
  Pipelines page (or opens the pipeline create modal).
- Cosmetic panel types (Markdown, Image, Divider, Embed) are unaffected — they skip the DataType
  step entirely and are never blocked.
- No backend changes are required; the condition is derived from an already-loaded frontend slice.

## Non-goals

- Does not change the DataType picker list when DataTypes do exist.
- Does not add an empty state for data sources or any other resource type.
- Does not auto-navigate the user away from the panel modal; the link is informational/navigational.
- Does not introduce a new API endpoint.

## Capabilities

### New Capabilities
- `panel-creation-datatype-empty-state`: Empty state UI shown inside the DataType picker step when
  no pipeline-produced DataTypes are available, with explanatory copy and a pipeline creation CTA.

### Modified Capabilities
- `panel-creation-datatype-step`: Add concrete UI requirements for the empty state (exact copy,
  CTA behaviour, and that the Next button remains disabled while the empty state is shown).

## Impact

- Frontend only: `PanelCreationModal` or its DataType step sub-component
- References `panelsSlice` / pipeline slice to determine if DataTypes list is empty
- No API, schema, or backend changes
