## Why

The current panel creation flow embeds a title field and type selector together in a single form, burying the type choice among other inputs. Surfacing type selection as the first and only step in a dedicated modal creates a clearer, more intentional creation experience and aligns with how users think about adding panels: pick what kind of panel you want, then fill in details.

## What Changes

- The inline panel create form is replaced by a multi-step modal dialog
- Step 1: a type picker — user selects one of the available panel types (metric, chart, text, table, image, markdown, divider); no other inputs are shown
- Step 2 (future): any type-specific configuration; for now a panel title input
- The "Add panel" button triggers the new modal instead of the old inline form
- The existing `PanelTypeSelector` component is reused/adapted within the modal
- Panel creation API call and Redux flow remain unchanged

## Capabilities

### New Capabilities
- `panel-creation-modal`: A type-first, multi-step modal that replaces the inline panel create form; step 1 is type selection only

### Modified Capabilities
- `frontend-panel-creation`: The trigger and UX of panel creation changes from an inline form to a modal; backend interaction and post-create refresh behaviour are unchanged
- `panel-type-selector`: The type selector now exists as step 1 of the modal rather than as a secondary input within a combined form; reset behaviour on close/submit is unchanged

## Impact

- `frontend/src/components/` — new `PanelCreationModal` component
- `frontend/src/features/panels/` — update panel creation trigger and Redux interaction
- `openspec/specs/frontend-panel-creation/` — delta spec: UX trigger changes to modal
- `openspec/specs/panel-type-selector/` — delta spec: type selection is now step 1 of the modal, not a secondary form field

## Non-goals

- Backend API changes — the panel creation endpoint is unchanged
- Type-specific configuration forms beyond panel title (future work)
- Animations or transitions between modal steps
