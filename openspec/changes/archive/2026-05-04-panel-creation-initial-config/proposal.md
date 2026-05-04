## Why

After selecting a panel type in the creation modal, users must immediately open the detail modal to set
basic properties like a metric's unit or a chart's type — adding friction to a flow that should be
complete in a single step. Surfacing these initial config fields in step 2 (the title/config step)
reduces that friction without bloating the creation flow.

## What Changes

- Step 2 of the panel creation modal gains a type-specific config section below the title field
- Metric panels: adds value label (text) and unit (text) inputs
- Chart panels: adds chart type selector (line / bar / pie)
- Image panels: adds image URL (text) input
- Divider panels: adds orientation selector (horizontal / vertical)
- Text, Table, and Markdown panels: no additional fields (unchanged)
- Panel creation payload includes the optional type-specific fields when provided
- Backend `POST /api/panels` accepts and persists these fields on create (they are already accepted
  on PATCH; this aligns CREATE to accept the same optional properties)

## Capabilities

### New Capabilities
- `panel-creation-type-config`: Type-specific configuration fields shown in step 2 of the panel
  creation modal, mapped per panel type and submitted as part of the creation payload.

### Modified Capabilities
- `panel-creation-modal`: Step 2 requirement changes — the title-entry step now includes optional
  type-specific fields below the title input.
- `frontend-panel-creation`: Creation thunk must forward the new optional type-config fields in the
  create request body.

## Impact

- `frontend/src/components/panels/PanelCreationModal.tsx` (or equivalent): add per-type config
  fields to step 2
- `frontend/src/store/panelsSlice.ts` (or equivalent): include optional config fields in create
  thunk payload
- Backend `POST /api/panels` route: verify it already accepts `metricConfig`, `chartConfig`,
  `imageConfig`, `dividerConfig` on create (same as PATCH). Add acceptance if missing.
- No new API endpoints; no schema-level breaking changes
- Existing panels unaffected; new fields are optional with server-side defaults

## Non-goals

- Complex settings (colors, weights, field mappings, data bindings) remain in the detail modal
- No changes to step 1 (type picker) or template selection step
- No changes to existing detail modal flows
