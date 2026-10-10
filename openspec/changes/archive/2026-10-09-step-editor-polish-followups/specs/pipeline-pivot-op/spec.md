## ADDED Requirements

### Requirement: Pivot config is validated at write time and a rejected save is shown on the offending control
A non-empty `agg` outside the supported set SHALL be rejected at write time. An empty or absent `agg` is an unconfigured draft and SHALL stay saveable. In the editor, a rejected save SHALL be shown as an inline error. The user's chosen aggregation SHALL be kept, and the aggregation control SHALL be marked invalid and described by that error.

#### Scenario: Invalid pivot aggregation is rejected at write time
- **WHEN** a step create, step update, pipeline-proposal validate/apply or patch-set apply carries a pivot config whose `agg` is non-empty and unsupported
- **THEN** the write is rejected with the existing step-config validation error response (e.g. 422 on REST) naming the unsupported aggregation function, and nothing is persisted

#### Scenario: Draft pivot config with no agg stays saveable
- **WHEN** a pivot config with an empty or absent `agg` is written
- **THEN** the write succeeds, and analyze and execution still report the missing aggregation

#### Scenario: Rejected save keeps the choice and marks the aggregation control invalid
- **WHEN** a pivot step's config save is rejected with a 422
- **THEN** the editor shows the server's message as an inline error, keeps the selected aggregation, and the aggregation control has `aria-invalid="true"` and `aria-describedby` referencing the error's id
