## MODIFIED Requirements

### Requirement: The pipeline's own page shows why auto-run is denied and offers a manual run
When a pipeline's analyze response has `costVerdict.autoRunnable` false, the pipeline detail page
SHALL render each reason using the same rule-code-to-copy mapping as the toast, and SHALL show a
"Run to update" control when `costVerdict.canRun` is true for the viewing user. A `step-config-invalid`
reason SHALL be rendered with copy that says a step is misconfigured and the pipeline cannot run until it is fixed,
never the generic fallback message.

#### Scenario: An AI-gated pipeline's page names the rule
- **WHEN** a pipeline's analyze response denies auto-run with reason code `ai-step`
- **THEN** the pipeline detail page displays that the pipeline calls AI, not a generic message

#### Scenario: A non-permitted viewer sees the reason without a run control
- **WHEN** a pipeline's analyze response denies auto-run and `costVerdict.canRun` is false for the
  viewing user
- **THEN** the denial reason is shown but no "Run to update" control is rendered

#### Scenario: A misconfigured step names the problem and offers no run control
- **WHEN** the owner's analyze response carries a `step-config-invalid` reason and `costVerdict.canRun` is false
- **THEN** the pipeline detail page shows the misconfigured-step copy and no "Run to update" control is rendered
