## ADDED Requirements

### Requirement: FillNull config is validated at write time and a rejected save is shown on the offending control
A non-empty `strategy` outside the supported set SHALL be rejected at write time. An empty `strategy`, or `constant` with no `value`, is an unconfigured draft and SHALL stay saveable. In the editor, a rejected save SHALL be shown as an inline error spaced from the controls above it by the editor's tokenized gap. The user's chosen value SHALL be kept, and the strategy control SHALL be marked invalid and described by that error.

#### Scenario: Invalid fillnull strategy is rejected at write time
- **WHEN** a step create, step update, pipeline-proposal validate/apply or patch-set apply carries a fillnull config whose `strategy` is non-empty and not one of `constant`, `forwardFill`, `mean`, `median`, `mode`
- **THEN** the write is rejected with the existing step-config validation error response (e.g. 422 on REST) naming the unsupported strategy, and nothing is persisted

#### Scenario: Draft fillnull configs stay saveable
- **WHEN** a fillnull config with an empty strategy, or strategy `constant` with no `value`, is written
- **THEN** the write succeeds, and analyze and execution still report the incomplete config

#### Scenario: Rejected save keeps the choice and marks the strategy control invalid
- **WHEN** a fillnull step's config save is rejected with a 422
- **THEN** the editor shows the server's message as an inline error, keeps the selected strategy, and the strategy control has `aria-invalid="true"` and `aria-describedby` referencing the error's id

#### Scenario: A non-validation save failure does not mark the control invalid
- **WHEN** a fillnull step's config save fails with a network error or a 5xx
- **THEN** the editor shows the error message but no control is marked `aria-invalid`
