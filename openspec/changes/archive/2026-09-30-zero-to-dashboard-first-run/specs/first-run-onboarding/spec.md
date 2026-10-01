## ADDED Requirements

### Requirement: A zero-dashboard workspace lands on the drop zone, with the checklist as the step-by-step path
When the dashboard collection has settled empty, the empty-workspace surface SHALL present the first-run drop zone (see `first-run-dashboard-build`) instead of the checklist. A "Set up step by step" control SHALL reveal the three-step checklist (source, pipeline, place), which remains the path for users who want to build manually and for the re-open affordance. The checklist model has three steps (source, pipeline, placement); earlier references to four steps or a "type" step are obsolete.

#### Scenario: Empty workspace
- **WHEN** a user with zero dashboards opens `/`
- **THEN** the drop zone is shown and the checklist is hidden until "Set up step by step" is chosen

#### Scenario: Step-by-step path
- **WHEN** the user chooses "Set up step by step"
- **THEN** the existing three-step checklist is shown
