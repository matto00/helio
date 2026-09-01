## ADDED Requirements

### Requirement: A chart-create with an implied Output does not mistarget a follow-up edit
When a refinement turn creates a chart implying a new Output, a subsequent follow-up edit turn in
the same conversation SHALL target that newly-created Output/panel, not an unrelated pre-existing
one (re-verification of HEL-670 against the Outputs model).

#### Scenario: A follow-up edit after an implied-Output chart-create targets the right panel
- **WHEN** a refinement turn creates a chart with an implied Output, and the next turn is a
  follow-up edit referring to "the chart I just made"
- **THEN** the edit targets the panel just created for that Output, not any other panel on the
  dashboard
