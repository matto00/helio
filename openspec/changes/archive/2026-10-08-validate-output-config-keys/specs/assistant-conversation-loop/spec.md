## ADDED Requirements

### Requirement: Assistant Output-config surfaces document the known-key set
Every in-app assistant surface that lets Claude write an Output's `config` SHALL carry, in the text Claude sees, the
per-kind known config keys and the chart `{ groupBy, agg, yField }` / metric `{ agg }` or `{ value, agg }` aggregation
shapes, rendered from the same key table the backend validator enforces (one source, so prompt and validator cannot
drift). The surfaces are: the pipeline-proposal Output `config` schema (`propose_pipeline` / `propose_combined`), the
`propose_patch_set` tool's Output-edit `patch` description, and the `/api/refinements` Output-edit instructions.

#### Scenario: Every surface lists every kind's keys
- **WHEN** the pipeline-proposal Output config schema, the `propose_patch_set` patch description and the refinement
  Output-edit text are rendered
- **THEN** each contains every Output kind's known config keys and both aggregation shapes

#### Scenario: Prompt follows the validator
- **WHEN** a key is added to or removed from the validator's per-kind key table
- **THEN** all three surfaces change accordingly with no separate edit
