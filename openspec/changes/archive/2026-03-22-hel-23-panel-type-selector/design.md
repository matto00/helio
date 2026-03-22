## Context

The panel create form in `PanelList` currently has a title input and a submit button. With the `type` field now on the data model (HEL-22), we need to expose it in the create UI. There are four types (`metric`, `chart`, `text`, `table`) with `metric` as the default.

## Goals / Non-Goals

**Goals:**
- Add a type selector to the inline create form that passes the chosen type to `POST /api/panels`
- Reset the selector to `metric` when the form is dismissed (cancelled or submitted)
- Keep the form compact and visually consistent with the existing style

**Non-Goals:**
- Editing a panel's type after creation (future PATCH flow)
- Per-type icons or descriptions in the selector

## Decisions

**Segment control (styled radio group) over `<select>`**
Four fixed options fit comfortably in a horizontal button group, which is more scannable and avoids an extra click to open a dropdown. A `<select>` would be fine but feels over-engineered for 4 items. The segment control follows the same pattern used for other multi-value choices in the app (e.g., grid background picker).

Implementation: `<fieldset>` + `<legend>` + `<input type="radio">` buttons, styled as a pill row via CSS. One radio per type, `metric` pre-checked.

**Local component state, not Redux**
The selected type is ephemeral form state — it only matters during the create interaction and is discarded on cancel or successful submit. No need for a global action.

**No schema changes**
`create-panel-request.schema.json` already accepts an optional `type` field (added in HEL-22). The service and thunk already forward it. This change is purely UI.

## Risks / Trade-offs

- [Narrow form at small viewport] The four-button segment might wrap or crowd on small viewports. Mitigation: CSS `flex-wrap: wrap` or fall back to a `<select>` at narrow widths if needed after visual testing.
