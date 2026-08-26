## Purpose

Provides a mechanical regression guard that the three inline-rename form controls migrated in this change stay on
the shared `TextField` primitive instead of regressing to a hand-rolled raw `<input>`.

## ADDED Requirements

### Requirement: Migrated rename inputs render via TextField, not a raw input

`PanelCard.tsx`, `PipelineDetailFooter.tsx`, and `TypeDetailPanel.tsx` SHALL render their rename/text-edit control
— the element with accessible name `"Panel title"`, `"Pipeline name"`, and `"Data type name"` respectively —
using the shared `TextField` primitive (`frontend/src/shared/ui/TextField.tsx`, identified by its `ui-input`
class), never a bare, unclassed `<input>`. This requirement is scoped to the named rename controls specifically;
it does not constrain other raw `<input>` elements these components may legitimately render for unrelated
purposes (e.g. `TypeDetailPanel.tsx`'s per-field `type="checkbox"` nullable toggles — a raw-element exception no
current shared primitive covers, out of this change's scope).

#### Scenario: Rename mode renders TextField
- **WHEN** a user activates rename/edit mode on a panel title, a pipeline name, or a data type name in one of the
  three migrated views
- **THEN** the element with that control's accessible name carries `TextField`'s `ui-input` class

#### Scenario: No raw-input regression on the named rename control
- **WHEN** the guard test renders each of the three migrated components in edit/rename mode and queries by the
  rename control's accessible name specifically (`"Panel title"` / `"Pipeline name"` / `"Data type name"`)
- **THEN** the matched element is `TextField`'s rendered `<input>` (carries the `ui-input` class), not a bare
  `<input>` lacking it — other unrelated raw `<input>` elements in the same rendered output (e.g. checkbox
  toggles) are out of scope for this assertion
