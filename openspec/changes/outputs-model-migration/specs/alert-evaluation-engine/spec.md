## MODIFIED Requirements

### Requirement: Single evaluation entry point
The system SHALL expose `AlertEvaluationService.evaluateForOutput(outputId: OutputId,
rows: Seq[PipelineRowJson.Row], triggeringRunId: Option[String]): Future[Unit]` as the sole
entry point for evaluating alert rules against freshly-produced rows for an `OutputId`, callable
identically from a pipeline-run-completion hook (invoked for every Output of every materialized
node) and a future scheduled-run trigger.

#### Scenario: Entry point requires no pipeline-run context
- **WHEN** `evaluateForOutput` is called with `triggeringRunId = None`
- **THEN** evaluation proceeds normally, and any `AlertEvent` created or updated has
  `pipelineRunId = None`

### Requirement: Load enabled rules for the target Output
`evaluateForOutput` SHALL load every enabled `AlertRule` targeting `outputId` via
`AlertRuleRepository.listEnabledByOutputInternal`, evaluating none if no enabled rule targets
that `OutputId`.

#### Scenario: No enabled rules
- **WHEN** `evaluateForOutput` is called for an `OutputId` with no enabled `AlertRule`
- **THEN** no `AlertEvent` is created, updated, or resolved, and the returned `Future` succeeds

#### Scenario: Disabled rule is skipped
- **WHEN** an `AlertRule` targeting `outputId` exists with `enabled = false`
- **THEN** that rule is not evaluated, regardless of whether its condition would breach
