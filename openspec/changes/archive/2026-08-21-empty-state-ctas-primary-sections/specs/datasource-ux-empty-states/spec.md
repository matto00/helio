## MODIFIED Requirements

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
