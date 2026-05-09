## ADDED Requirements

### Requirement: Legacy-bound panels display an inline migration warning banner
A panel whose `typeId` resolves to a DataType with a non-null `sourceId` SHALL display an inline
warning banner inside the panel card, above the panel body content area. The banner SHALL instruct
the user to attach a pipeline in place of the direct DataSource binding. The panel SHALL continue
to render its last known data normally; the warning is additive and does not block usage.

#### Scenario: Legacy-bound panel shows warning banner
- **WHEN** a panel has a non-null `typeId` that resolves to a DataType with `sourceId != null`
- **THEN** the panel card displays an inline warning banner reading "This panel is using a legacy
  data source binding. Attach a pipeline to migrate."

#### Scenario: Pipeline-bound panel does not show warning banner
- **WHEN** a panel has a non-null `typeId` that resolves to a DataType with `sourceId == null`
- **THEN** no warning banner is displayed on that panel card

#### Scenario: Unbound panel does not show warning banner
- **WHEN** a panel has `typeId == null`
- **THEN** no warning banner is displayed on that panel card

#### Scenario: Legacy-bound panel still renders data
- **WHEN** a panel shows the legacy binding warning banner
- **THEN** the panel content area below the banner still renders the panel's last known data
  (or the loading/error/no-data state as appropriate)

### Requirement: Warning detection uses the dataTypesSlice state
The frontend SHALL determine legacy binding status by cross-referencing `panel.typeId` with
`state.dataTypes.items`. A panel is legacy-bound if and only if there exists a DataType in
`state.dataTypes.items` with `id === panel.typeId` and `sourceId !== null`. This check SHALL be
encapsulated in a dedicated hook `useLegacyBoundPanel(panel)` returning a boolean.

#### Scenario: useLegacyBoundPanel returns true for legacy DataType
- **WHEN** `panel.typeId` matches a DataType in the store with `sourceId` set
- **THEN** `useLegacyBoundPanel` returns `true`

#### Scenario: useLegacyBoundPanel returns false when DataTypes not yet loaded
- **WHEN** `dataTypesSlice.items` is empty (loading state)
- **THEN** `useLegacyBoundPanel` returns `false` (no false positives during load)

#### Scenario: useLegacyBoundPanel returns false for unbound panel
- **WHEN** `panel.typeId` is `null`
- **THEN** `useLegacyBoundPanel` returns `false`
