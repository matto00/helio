## MODIFIED Requirements

### Requirement: Output-kind panel sheet has no binding controls; content-kind panels are unaffected
For an output-kind panel, the panel detail modal (the "Panel sheet") SHALL show title override, appearance, a link to the panel's Output on its pipeline page, a "Swap output" action, and a placements note ("used on N dashboards") — it SHALL NOT show a field-mapping, aggregation, or any other visualization-configuration control, and SHALL have no "Data" tab. Content-kind panels (text, markdown, image, divider) are unaffected by this requirement: like every other panel kind, they render a single unified edit form (Appearance section plus a kind-specific section — e.g. Divider, or the literal text/markdown content editor) with no tab bar at all. This was already true before this change (there was never a tab bar for any panel kind); this requirement records it as unchanged rather than reintroducing one. A `form` panel follows the same unified, tab-free shape: its kind-specific section is the form builder (see the `form-panel-builder` capability), which participates in the sheet's unified Save/Discard and unsaved-changes handling exactly as the other kind-specific editors do.

#### Scenario: Output panel sheet has no binding controls
- **WHEN** the user opens the detail sheet for an output-kind panel
- **THEN** the sheet shows title override, appearance, an Output link, and Swap output
- **AND** no field-mapping or aggregation control is rendered anywhere in the sheet
- **AND** no "Data" tab is shown

#### Scenario: Output link opens the Output's pipeline page
- **WHEN** the user activates the Output link in the panel sheet
- **THEN** the user is navigated to `/pipelines/:id` with that Output's sheet opened

#### Scenario: Content panel keeps its unified, tab-free edit form
- **WHEN** the user opens the detail sheet for a text, markdown, image, or divider panel
- **THEN** a single edit form is shown with an Appearance section and that kind's literal-content editor, with no tab bar and no "Data" tab — unchanged from before this change

#### Scenario: Form panel sheet renders the builder as its kind-specific section
- **WHEN** the user opens the detail sheet for a `form` panel
- **THEN** a single edit form is shown with an Appearance section and the form builder, with no tab bar; the
  builder's unsaved edits make the sheet report unsaved changes, and the sheet's Save persists them
