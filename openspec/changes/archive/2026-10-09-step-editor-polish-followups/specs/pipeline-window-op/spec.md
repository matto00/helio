## ADDED Requirements

### Requirement: Window config is validated at write time and a rejected save is shown on the offending control
A non-empty `function` outside the supported set, or `lag`/`lead` with an explicit `offset` <= 0, SHALL be rejected at write time. An empty `function`, or a `running_sum`/`lag`/`lead` with no `field`, is an unconfigured draft and SHALL stay saveable. In the editor, a rejected save SHALL be shown as an inline error, the user's choice SHALL be kept, and the function control SHALL be marked invalid and described by that error.

#### Scenario: Invalid window function or offset is rejected at write time
- **WHEN** a step create, step update, pipeline-proposal validate/apply or patch-set apply carries a window config with a non-empty unsupported `function`, or `lag`/`lead` with `offset` <= 0
- **THEN** the write is rejected with the existing step-config validation error response (e.g. 422 on REST) naming the problem, and nothing is persisted

#### Scenario: Draft window configs stay saveable
- **WHEN** a window config with an empty `function`, or a `lag`/`lead`/`running_sum` with no `field`, is written
- **THEN** the write succeeds, and analyze and execution still report the incomplete config

#### Scenario: Missing field is reported before a bad offset at run time
- **WHEN** a stored `lag` or `lead` step has no `field` and a non-positive `offset`, and it executes
- **THEN** execution fails with the "requires 'field'" step configuration error, not the offset error

#### Scenario: Unsupported function is still reported first at run time
- **WHEN** a stored window step has an unsupported `function` and no `field`, and it executes
- **THEN** execution fails with the unsupported-function error

#### Scenario: Rejected save keeps the choice and marks the function control invalid
- **WHEN** a window step's config save is rejected with a 422
- **THEN** the editor shows the server's message as an inline error, keeps the selected function, and the function control has `aria-invalid="true"` and `aria-describedby` referencing the error's id
