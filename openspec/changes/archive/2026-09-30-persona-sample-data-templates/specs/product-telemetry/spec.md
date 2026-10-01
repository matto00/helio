## ADDED Requirements

### Requirement: Template slugs roll up under their own slug
The rollup of `firstrun_template_chosen` SHALL bucket each of `streamer`, `founder`, `ops`, `finance` under its own slug, and any other value under `other`.

#### Scenario: Known slug
- **WHEN** a `firstrun_template_chosen` event with template `streamer` is stored and rolled up
- **THEN** the rollup row's property value is `streamer`, not `other`
