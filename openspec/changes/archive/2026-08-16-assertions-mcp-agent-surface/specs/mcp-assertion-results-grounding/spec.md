## ADDED Requirements

### Requirement: get_workspace_context reports each pipeline's latest-run assertion summary
`WorkspaceContext.pipelines[]` SHALL include a `lastRunAssertions` field for every pipeline — a compact
summary (`passed`/`warnFailed`/`errorFailed` counts, plus a `failures` list of failing rules' kind/field/
severity/message) sourced from `GET /api/pipelines/:id/run-history`'s most-recent entry's `assertions`
field. `lastRunAssertions` SHALL always be present (never omitted), zero-valued (`passed: 0, warnFailed:
0, errorFailed: 0, failures: []`) when the pipeline has no `assert` step or has never run.

#### Scenario: A pipeline with a recent failing assertion reports it in context
- **WHEN** `get_workspace_context` is called for a workspace containing a pipeline whose latest run had
  one error-severity assertion failure
- **THEN** that pipeline's `lastRunAssertions.errorFailed` is `1` and `failures` names the failing rule

#### Scenario: A pipeline with no assert steps reports a zero-valued summary
- **WHEN** `get_workspace_context` is called for a pipeline with no `assert` steps
- **THEN** that pipeline's `lastRunAssertions` is present with all counts `0` and an empty `failures`
  list — not omitted

#### Scenario: A pipeline with no runs yet reports a zero-valued summary
- **WHEN** `get_workspace_context` is called for a pipeline that has never been run
- **THEN** that pipeline's `lastRunAssertions` is present with all counts `0` and an empty `failures`
  list

### Requirement: get_workspace_context's description explains assertion trustworthiness
The `get_workspace_context` tool description SHALL explain `lastRunAssertions` as the mechanism for
reasoning about a pipeline's data trustworthiness (the description does not currently explain
`lastRunStatus` either — this is the first such explanation added, not a second one alongside an
existing one).

#### Scenario: Tool description mentions assertion trustworthiness
- **WHEN** an MCP client inspects the `get_workspace_context` tool's description
- **THEN** the description explains that `lastRunAssertions` reflects whether the pipeline's last run's
  data can be trusted
