## Purpose
Lets an agent read, configure and remove a pipeline's refresh schedule entirely over MCP, so an agent asked for a
daily-refreshing dashboard can both deliver that and verify it afterwards rather than silently failing to.

## ADDED Requirements

### Requirement: get_pipeline_schedule MCP tool
The MCP server SHALL expose a `get_pipeline_schedule` tool that accepts a `pipelineId`, calls
`GET /api/pipelines/:id/schedule`, and returns the pipeline's schedule including its `kind`, `expression`,
`enabled`, `timezone`, and its `nextRunAt`/`lastRunAt` when the backend has computed them. The tool SHALL surface
the backend's 404 verbatim rather than translating an absent schedule into an empty or synthesised success value,
so that "this pipeline has no schedule" and "this pipeline does not exist" remain distinguishable to the agent.

#### Scenario: Agent reads a schedule it configured
- **WHEN** an agent calls `get_pipeline_schedule` for a pipeline that has a schedule
- **THEN** the tool returns that schedule's `kind`, `expression`, `enabled` and `timezone` as stored, together with
  `nextRunAt` and `lastRunAt` when present

#### Scenario: Pipeline has no schedule
- **WHEN** an agent calls `get_pipeline_schedule` for a pipeline that exists but has no schedule
- **THEN** the tool surfaces the backend's 404 "Pipeline schedule not found" rather than returning a success value

#### Scenario: A schedule created in the UI is readable over MCP
- **WHEN** a schedule is created through the pipeline schedule UI and an agent then calls `get_pipeline_schedule`
- **THEN** the agent reads back exactly that schedule — there is no second, divergent MCP-side source of truth

### Requirement: set_pipeline_schedule MCP tool
The MCP server SHALL expose a `set_pipeline_schedule` tool that accepts a `pipelineId`, a required `kind`, a
required `expression`, a required `timezone`, and an optional `enabled`, and calls `PUT /api/pipelines/:id/schedule`.
The call SHALL be an upsert: it creates the schedule when absent and replaces it when present, matching the backend's
`PUT`. The tool's description SHALL state the accepted grammar exactly as the backend validates it — `kind` is one of
`cron` or `interval`; a `cron` expression is five space-separated fields (minute hour day-of-month month day-of-week);
an `interval` expression is `<n><unit>` with `n` greater than zero and `unit` one of `s`/`m`/`h`/`d`; `timezone` is a
valid IANA zone id — and SHALL state that omitting `enabled` results in an enabled schedule.

#### Scenario: Agent configures a daily refresh
- **WHEN** an agent calls `set_pipeline_schedule` with a `cron` kind, a daily expression, and an IANA timezone
- **THEN** the schedule is persisted and a subsequent `get_pipeline_schedule` returns that same cadence

#### Scenario: Omitted enabled defaults to enabled
- **WHEN** an agent calls `set_pipeline_schedule` without an `enabled` argument
- **THEN** no `enabled` key is sent on the wire and the resulting schedule is enabled

#### Scenario: Setting a schedule twice replaces rather than duplicates
- **WHEN** an agent calls `set_pipeline_schedule` for a pipeline that already has a schedule
- **THEN** the existing schedule is replaced in place, keeping its id, rather than a second schedule being created

#### Scenario: An invalid expression is surfaced, not swallowed
- **WHEN** an agent calls `set_pipeline_schedule` with an expression the backend rejects for that `kind`
- **THEN** the tool surfaces the backend's validation error, naming the offending expression, and no schedule is
  written

#### Scenario: A schedule set over MCP is visible in the UI
- **WHEN** an agent sets a schedule via `set_pipeline_schedule`
- **THEN** the pipeline schedule UI shows that same schedule, because both read the one backend resource

### Requirement: delete_pipeline_schedule MCP tool
The MCP server SHALL expose a `delete_pipeline_schedule` tool that accepts a `pipelineId` and calls
`DELETE /api/pipelines/:id/schedule`, removing the schedule so the pipeline no longer refreshes on a cadence. The
tool SHALL surface the backend's 404 when there is no schedule to delete rather than reporting a successful deletion.

#### Scenario: Agent removes a refresh cadence
- **WHEN** an agent calls `delete_pipeline_schedule` for a pipeline that has a schedule
- **THEN** the schedule is deleted and a subsequent `get_pipeline_schedule` reports that none exists

#### Scenario: Deleting an absent schedule is not reported as success
- **WHEN** an agent calls `delete_pipeline_schedule` for a pipeline with no schedule
- **THEN** the tool surfaces the backend's 404 rather than returning a success value
