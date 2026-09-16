## ADDED Requirements

### Requirement: analyzewithai is never auto-runnable
A pipeline containing an enabled `analyzewithai` step SHALL be denied by the auto-run cheapness
verdict with the `ai-step` reason code. The reason SHALL name the offending step.

#### Scenario: Auto-run denied
- **WHEN** the cheapness verdict is computed for a pipeline with an enabled `analyzewithai` step
- **THEN** the verdict is not auto-runnable and its reasons include `ai-step`

#### Scenario: Denial is attributable to the step
- **WHEN** the verdict denies a pipeline for an enabled `analyzewithai` step
- **THEN** the `ai-step` reason identifies that step's id
