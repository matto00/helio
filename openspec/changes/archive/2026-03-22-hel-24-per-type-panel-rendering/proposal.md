## Why

All panels currently render the same static placeholder body regardless of type. Now that `type` is persisted (HEL-22) and user-selectable (HEL-23), the grid should reflect it visually so users can distinguish panel types at a glance. This is the third step of the panel type system — making the type meaningful in the UI before real data ingestion is added.

## What Changes

- The static placeholder body in each panel card is replaced by a type-specific content component
- Each type renders a distinct, recognisable placeholder that hints at its eventual function:
  - **Metric** — large "--" value with a sub-label
  - **Chart** — simple CSS bar-chart skeleton
  - **Text** — two lines of faded placeholder text
  - **Table** — a mini 3-row table skeleton with column headers
- Routing happens inside `PanelGrid` based on `panel.type`; no Redux or API changes required

## Capabilities

### New Capabilities

- `panel-type-rendering`: Each panel type in the grid renders a visually distinct placeholder body that indicates its type

### Modified Capabilities

- `panel-type-field`: Existing requirement "Panel response always includes type" is already satisfied; no spec change needed. However, the rendering requirement is new and logically extends this capability — captured as a new capability above rather than a modification.

## Impact

- `frontend/src/components/PanelGrid.tsx` — replaces static body with type-routed content
- `frontend/src/components/PanelContent.tsx` (new) — type-switch + four placeholder components
- `frontend/src/components/PanelContent.css` (new) — placeholder styles
- No backend changes, no schema changes, no Redux changes
