## ADDED Requirements

### Requirement: Pipeline detail page renders at /pipelines/:id
The frontend SHALL render a `PipelineDetailPage` component when the user navigates to `/pipelines/:id`. The page SHALL display three sections: source selector bar at the top, river view in the scrollable middle, and footer bar at the bottom.

#### Scenario: Route renders detail page
- **WHEN** the user navigates to `/pipelines/some-id`
- **THEN** `PipelineDetailPage` is rendered

### Requirement: Back navigation to pipeline list
The pipeline detail page SHALL provide a back navigation affordance that links to `/pipelines`.

#### Scenario: Back link is present and correct
- **WHEN** `PipelineDetailPage` is rendered
- **THEN** a link element pointing to `/pipelines` is visible on the page

### Requirement: Source selector bar loads from API
The source selector bar SHALL fetch data sources via the `fetchSources` thunk and render one chip per source. Each chip SHALL display the source name.

#### Scenario: Sources are rendered from API
- **WHEN** the API returns a list of data sources
- **THEN** a chip for each source is visible in the source selector bar

### Requirement: River view empty state
When no transformation steps have been added, the river view SHALL display an empty state message containing "Add your first transformation step".

#### Scenario: Empty state shown with no steps
- **WHEN** the pipeline detail page is first rendered (steps array is empty)
- **THEN** the text "Add your first transformation step" is visible

### Requirement: Adding a transformation step
The user SHALL be able to add a transformation step. After adding, the step SHALL appear in the river view and the empty state SHALL no longer be visible.

#### Scenario: Step appears after adding
- **WHEN** the user triggers the add-step action
- **THEN** a new step card appears in the river view

### Requirement: Removing a transformation step
The user SHALL be able to remove a transformation step from the river view. After removal, the step SHALL no longer appear in the list.

#### Scenario: Step removed after removal action
- **WHEN** the user removes an existing step
- **THEN** that step is no longer visible in the river view

### Requirement: Editable output name in footer
The footer bar SHALL display an output name field. The user SHALL be able to edit the output name inline.

#### Scenario: Output name is editable
- **WHEN** the user activates the output name field
- **THEN** an input element is rendered allowing the name to be changed

### Requirement: Run pipeline button shows placeholder
The "Run pipeline" button in the footer bar SHALL be visible. When clicked, it SHALL display a placeholder message indicating execution is not yet available.

#### Scenario: Run button shows placeholder on click
- **WHEN** the user clicks the "Run pipeline" button
- **THEN** a placeholder message is shown (e.g. via alert or inline toast)
