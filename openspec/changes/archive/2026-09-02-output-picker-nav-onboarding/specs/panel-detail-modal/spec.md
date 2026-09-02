## REMOVED Requirements

### Requirement: Panel detail modal has Appearance and Data tabs
**Reason**: Retiring the field-mapping/aggregation "Data" tab content for output-kind panels is the core of this change; rewritten wholesale rather than incrementally modified, since the original scenarios describe a two-tab structure that predates this change and, per this ticket's own live verification, no longer existed for any panel kind even before this change shipped.
**Migration**: See the new "Output-kind panel sheet has no binding controls; content-kind panels are unaffected" requirement (this same change). Content-kind panels never had a tab bar either — see that requirement's corrected wording.

### Requirement: Data tab shows a placeholder
**Reason**: Superseded by the same rewrite — an output-kind panel's sheet has no "Data" tab placeholder any more; it shows the Output link/Swap-output/placements-note content instead.
**Migration**: See the new requirement (this same change).

## ADDED Requirements

### Requirement: Output-kind panel sheet has no binding controls; content-kind panels are unaffected
For an output-kind panel, the panel detail modal (the "Panel sheet") SHALL show title override, appearance, a link to the panel's Output on its pipeline page, a "Swap output" action, and a placements note ("used on N dashboards") — it SHALL NOT show a field-mapping, aggregation, or any other visualization-configuration control, and SHALL have no "Data" tab. Content-kind panels (text, markdown, image, divider) are unaffected by this requirement: like every other panel kind, they render a single unified edit form (Appearance section plus a kind-specific section — e.g. Divider, or the literal text/markdown content editor) with no tab bar at all. This was already true before this change (there was never a tab bar for any panel kind); this requirement records it as unchanged rather than reintroducing one.

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

### Requirement: Swap output re-uses the picker
Activating "Swap output" on an output-kind panel's sheet MUST re-open the Output picker, scoped to replacing the current panel's `outputId` in place (preserving the panel's position/size) rather than creating a new placement.

#### Scenario: Swap output preserves placement position and size
- **WHEN** the user swaps an output-kind panel's Output via the picker
- **THEN** the panel's existing position and size are preserved
- **AND** only `outputId` changes
