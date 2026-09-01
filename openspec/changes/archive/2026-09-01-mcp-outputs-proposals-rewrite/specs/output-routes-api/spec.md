## ADDED Requirements

### Requirement: Teardown-by-tag cascades to an Output's placements
Removing a tagged pipeline's Outputs via the teardown/tag-cascade path SHALL also remove any
dashboard placements referencing those Outputs.

#### Scenario: Tag-cascade delete removes placements along with outputs
- **WHEN** `teardown_resources` removes all resources under a tag that includes a pipeline with
  placed Outputs
- **THEN** both the pipeline's Outputs and the dashboard placements referencing them are removed
