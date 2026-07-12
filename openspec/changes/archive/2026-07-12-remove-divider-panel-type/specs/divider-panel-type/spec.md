## ADDED Requirements

### Requirement: Divider is a legacy-only panel type, not offered for interactive creation
The panel-type picker (`panel-type-selector`, `panel-type-picker-cards`, `panel-creation-modal` specs) SHALL NOT offer `divider` as a selectable type.
All other divider behavior in this spec — rendering,
`PATCH /api/panels/:id` support, response fields, and dashboard-proposal creation with an initial
orientation — remains unchanged and fully supported for back-compat. No database migration removes
the `dividerOrientation`/`dividerWeight`/`dividerColor` columns; no backend validation rejects
`type: "divider"` on `POST /api/panels` or `POST /api/dashboards/apply-proposal`, since dashboard
duplication and export/import reuse the same create path to clone dashboards that already contain a
divider panel.

#### Scenario: Divider panel created before HEL-249 continues to render
- **WHEN** a dashboard containing a pre-existing panel with `type: "divider"` is opened
- **THEN** the panel renders its styled rule exactly as before, with no visual or functional change

#### Scenario: Divider panel remains editable via the detail modal
- **WHEN** the user opens the detail modal for an existing divider panel
- **THEN** the Divider section (orientation, weight, color) is shown and remains editable

#### Scenario: Divider is absent from the interactive panel-type picker
- **WHEN** the user opens the panel creation modal
- **THEN** no `divider` card is present in the type-select step

#### Scenario: Duplicating a dashboard that contains a divider panel still works
- **WHEN** a dashboard containing a divider panel is duplicated or exported/imported
- **THEN** the resulting dashboard's divider panel is created with the same `orientation`/`weight`/`color`
  as the source, unaffected by the picker's removal of `divider` from interactive creation
