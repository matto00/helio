## Why

The panel creation modal currently collects a type and title but gives no visual feedback about
what the panel will look like. Users must commit to creating a panel before seeing how it renders,
which slows iteration and reduces confidence — especially for new users unfamiliar with panel types.

## What Changes

- A live preview pane is added to the title/configuration step of the panel creation modal
- The preview renders using the same panel type components already used in the dashboard grid
- The preview updates in real-time as the user changes the title or other settings (e.g. content for
  markdown, image URL for image panels)
- The preview shows the panel in its unbound/placeholder state for types that require data binding
  (metric, chart, table) since no data source is connected during creation

## Capabilities

### New Capabilities

- `panel-creation-preview`: Live preview pane shown in the panel creation modal's configuration
  step. Renders the selected panel type using existing panel type components, reflecting the current
  title and any type-specific fields the user has entered.

### Modified Capabilities

- `panel-creation-modal`: The title/configuration step layout changes to include a preview pane
  alongside the form inputs. The step now has a two-column layout (form | preview) on wider viewports
  and a stacked layout on narrow viewports.

## Impact

- Frontend only — no backend changes required
- Touches the panel creation modal component and the configuration step layout
- Reuses existing panel type rendering components (no duplication)
- No API contract changes

## Non-goals

- Live data preview (binding a data source during creation)
- Editing panel content (e.g. markdown body, image URL) from within the creation modal — only
  the title field is configurable at creation time; other fields can be edited after creation
- Animated transitions in the preview area
