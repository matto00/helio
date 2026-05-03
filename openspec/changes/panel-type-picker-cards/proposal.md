## Why

The panel type picker in the creation modal currently has no specified visual treatment — the spec says "type picker" but leaves the UI form undefined.
A visual card grid with icon, name, and one-line description makes all available panel types immediately scannable and gives users clear affordance for selection.

## What Changes

- The type picker in the panel creation modal renders as a grid of visual cards, one per panel type
- Each card displays: a representative icon, the panel type name, and a one-line description of what the type is for
- The selected card is visually highlighted (distinct active state)
- All currently supported panel types are covered: metric, chart, text, table, markdown, image, divider

## Capabilities

### New Capabilities
- `panel-type-picker-cards`: Visual card grid component for the panel type selection step — icon, name, description per type, with highlighted selection state

### Modified Capabilities
- `panel-type-selector`: The requirement for how the type picker presents types now specifies a card grid UI (currently unspecified) — add visual card layout requirement and per-type icon/description metadata

## Impact

- Frontend only — no backend or API changes required
- New `PanelTypeCard` (or similar) component within the panel creation modal
- Panel type metadata (icon + description) added as a frontend constant/registry
- `panel-type-selector` spec gains a visual presentation requirement

## Non-goals

- No changes to which types are available or their names
- No changes to the panel creation flow steps or the title input step
- No backend schema changes
- No per-type configuration or capability gating
