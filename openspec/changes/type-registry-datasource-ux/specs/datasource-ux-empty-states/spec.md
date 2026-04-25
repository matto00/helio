## ADDED Requirements

### Requirement: DataSourceList renders a meaningful empty state
When no data sources exist, `DataSourceList` SHALL render an empty state containing a short explanatory message and a CTA button labelled "Add a data source" that triggers the add-source modal. The existing plain text message SHALL be replaced.

#### Scenario: Empty state shows message and CTA
- **WHEN** `GET /api/data-sources` returns an empty list and the component renders
- **THEN** the text "No data sources yet" is visible and a button labelled "Add a data source" is rendered

#### Scenario: CTA opens add-source modal
- **WHEN** the user clicks the "Add a data source" CTA in the empty state
- **THEN** the AddSourceModal opens

### Requirement: TypeRegistryBrowser renders a meaningful empty state
When no DataTypes exist, `TypeRegistryBrowser` SHALL render an empty state containing a short explanatory message and a CTA note directing the user to add a data source. The existing plain text message SHALL be replaced.

#### Scenario: Empty state shows guidance message
- **WHEN** the Redux dataTypes list is empty and the component renders
- **THEN** a message "No types yet" (or similar) is visible with guidance text directing the user to add a data source
