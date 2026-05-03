## MODIFIED Requirements

### Requirement: Panel detail modal has Appearance and Data tabs
The modal MUST present an Appearance tab and a Data tab. The Appearance tab MUST be active by default **when in edit mode**. Tabs are not visible in view mode.

#### Scenario: Appearance tab is active on entering edit mode
- **WHEN** the user clicks Edit to enter edit mode
- **THEN** the Appearance tab is selected and its content is visible

#### Scenario: User switches to the Data tab in edit mode
- **WHEN** the user clicks the Data tab while in edit mode
- **THEN** the Data tab content is shown and Appearance tab content is hidden
