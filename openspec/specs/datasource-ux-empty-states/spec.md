# datasource-ux-empty-states Specification

## Purpose
Meaningful empty states for the DataSourceList and TypeRegistryBrowser components, replacing blank views with explanatory messages and actionable CTAs.
## Requirements
### Requirement: DataSourceList renders a meaningful empty state
When no data sources exist, `DataSourceList` SHALL render an empty state containing a short explanatory message and a CTA button labelled "Add a data source" that triggers the add-source modal. The existing plain text message SHALL be replaced.

#### Scenario: Empty state shows message and CTA
- **WHEN** `GET /api/data-sources` returns an empty list and the component renders
- **THEN** the text "No data sources yet" is visible and a button labelled "Add a data source" is rendered

#### Scenario: CTA opens add-source modal
- **WHEN** the user clicks the "Add a data source" CTA in the empty state
- **THEN** the AddSourceModal opens

### Requirement: TypeRegistryBrowser renders a meaningful empty state
When no DataTypes exist, `TypeRegistryBrowser` SHALL render an empty state containing a short explanatory
message and a working primary call to action directing the user toward **creating a pipeline**, which is
the only thing that produces a data type. It SHALL NOT direct the user to add a data source, and SHALL NOT
offer any path claiming to create a type directly.

This requirement previously specified guidance "directing the user to add a data source". That was already
false of the shipped component, whose copy explains that types are created by pipelines, and it is wrong
on the merits: adding a data source alone never produces a type under the strict
source→pipeline→type→panel model, so following that guidance would leave the registry exactly as empty.
The empty state also previously carried no action at all; it now carries one.

#### Scenario: Empty state shows guidance message
- **WHEN** the Redux dataTypes list is empty and the component renders
- **THEN** a message is visible explaining that types are produced by pipelines

#### Scenario: Empty state offers a pipeline call to action
- **WHEN** the Redux dataTypes list is empty and the component renders
- **THEN** a primary call to action is rendered which opens the pipeline creation flow

#### Scenario: No create-type path is offered
- **WHEN** the registry empty state renders
- **THEN** no action claiming to create a data type directly, and no add-data-source guidance, is shown

