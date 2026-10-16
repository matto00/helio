# home-summary-api Specification

## Purpose
One authenticated call that gives the Home page everything it shows about pipelines and dashboard changes: the last 24
hours of runs, upcoming scheduled fires, items that need attention, and change times for requested dashboards.

## Requirements

### Requirement: One call returns runs, upcoming fires and attention items

`GET /api/home-summary` SHALL return `{serverNow, windowStart, horizonEnd, pipelines, pipelinesWithActivity, attention,
upNext, dashboardChanges}` where `windowStart` is `serverNow` minus 24 hours and `horizonEnd` is `serverNow` plus 6 hours.
Each `pipelines` item SHALL be `{pipelineId, name, runs, runsOmitted, upcoming}`: `runs` lists the pipeline's real
(non-dry) runs started at or after `windowStart`, newest first, at most 150, each `{runId, status, startedAt,
completedAt, triggerSource, rowCount, errorLog}` with `status` one of `queued|running|succeeded|failed` and `errorLog`
truncated to 500 characters; a `queued` or `running` run started before `windowStart` SHALL NOT appear in `runs` (it can
only appear in `attention`); `runsOmitted` counts the window's runs beyond 150; `upcoming` lists the projected fire
instants of the pipeline's enabled schedule before `horizonEnd`, at most 24, anchored on the schedule's stored next fire
time: when that time is at or after `serverNow` it is the first fire; when it is earlier (the fire is due), the first
fire is `serverNow`; each later fire is the schedule's next fire after the previous one (an interval schedule adds its
interval; a cron schedule takes the next matching time in its timezone). Unauthenticated calls
SHALL return `401`. The response SHALL validate against `schemas/home/home-summary-response.schema.json`.

#### Scenario: Runs and fires for an owned pipeline
- **WHEN** at 10:07 A owns pipeline P with a succeeded run 2h ago, a failed run 30h ago and an hourly cron schedule (`0 * * * *`)
- **THEN** P's item lists only the 2h-old run and six upcoming fires from 11:00 to 16:00

#### Scenario: Interval fires follow the stored next fire, not now
- **WHEN** the clock is 10:07 and an every-2h interval schedule's stored next fire is 11:00
- **THEN** `upcoming` is 11:00, 13:00 and 15:00

#### Scenario: A due fire is projected at now
- **WHEN** an every-2h interval schedule's stored next fire is 3 minutes before `serverNow`
- **THEN** `upcoming` starts at `serverNow`, followed by fires two hours apart, and there is no `missed` item

#### Scenario: Dry runs are excluded
- **WHEN** P's only run in the window is a dry run
- **THEN** P's `runs` is empty

#### Scenario: Unauthenticated
- **WHEN** the request carries no valid session or token
- **THEN** the response is `401`

### Requirement: Top eight pipelines, failures pinned

A pipeline SHALL be eligible when it has at least one run in the window or at least one upcoming fire. `pipelines`
SHALL hold at most 8 eligible pipelines: first every eligible pipeline with a failed run in the window or an attention
item (most recent such event first), then the rest ranked by (runs in the window + upcoming fires) descending, ties by
latest run start descending, then name. `pipelinesWithActivity` SHALL be the number of eligible pipelines.

#### Scenario: A quiet failing pipeline beats a busy healthy one
- **WHEN** A has nine busy healthy pipelines and one pipeline whose single run in the window failed
- **THEN** the failing pipeline is among the 8 returned and `pipelinesWithActivity` is 10

#### Scenario: Idle pipelines are not listed
- **WHEN** a pipeline has no run in the window and no enabled schedule
- **THEN** it is not in `pipelines` and not counted

### Requirement: Attention items cover failed, stuck and missed runs

`attention` SHALL list, newest first: for each pipeline, its most recent failed run in the window as `{kind: "failed",
pipelineId, pipelineName, runId, at, reason, resolvedAt}` where `reason` is the run's `errorLog` (truncated to 500
characters) and `resolvedAt` is the start of a later succeeded run, or `null`; each run in status `queued` or `running`
started more than 15 minutes before `serverNow` as `kind: "stuck"`; and each enabled schedule whose stored next fire is
more than 10 minutes before `serverNow` as `kind: "missed"` with `runId` null and `at` the missed fire time. Every item
SHALL carry `inFlight`, true when its pipeline has a `queued` or `running` run.

#### Scenario: A failed run needs attention with its error
- **WHEN** P's latest run failed 3h ago with error "source returned 0 rows"
- **THEN** `attention` holds a `failed` item for P with that reason and `resolvedAt` null

#### Scenario: A later success resolves but keeps the failure visible
- **WHEN** P failed 5h ago and succeeded 2h ago
- **THEN** the `failed` item has `resolvedAt` equal to the later run's start

#### Scenario: Stuck and missed
- **WHEN** a run has been `running` for 20 minutes and another pipeline's enabled schedule was due 12 minutes ago
- **THEN** `attention` has one `stuck` and one `missed` item

### Requirement: Up next lists the soonest fires

`upNext` SHALL list the 5 soonest fires across the caller's enabled schedules, each `{pipelineId, pipelineName, at}`,
where a schedule contributes its first projected fire (as defined for `upcoming`), regardless of the 6-hour horizon.

#### Scenario: Soonest five
- **WHEN** A has seven scheduled pipelines
- **THEN** `upNext` has five entries in ascending `at` order

### Requirement: Owner scoping is enforced by row-level security in one bounded set of queries

Runs, schedules and attention items SHALL come only from pipelines the caller owns: the queries SHALL filter on the
caller as pipeline owner, and the row-level security policies on `pipeline_runs` and `pipeline_schedules` SHALL independently enforce the same scoping for the caller's session (a role without
BYPASSRLS). The number of database queries per request SHALL NOT grow with the number of pipelines.

#### Scenario: Scoped even on a connection that bypasses RLS
- **WHEN** B requests the summary over a superuser connection while A owns scheduled pipelines with runs
- **THEN** B's response contains none of A's pipelines

#### Scenario: Another user's runs are invisible
- **WHEN** B requests the summary while A owns pipelines with runs and schedules
- **THEN** B's response contains none of A's pipelines, runs, fires or attention items

### Requirement: Change times for requested dashboards

`dashboardIds` (comma-separated, optional, at most 20) SHALL return `dashboardChanges` items `{dashboardId,
contentUpdatedAt, dataUpdatedAt}` with exactly the semantics and access rules of `dashboard-change-signals` (omitted
when not readable; `400` for more than 20 ids or an empty id). Without the parameter `dashboardChanges` SHALL be empty.

#### Scenario: Unreadable dashboard omitted
- **WHEN** B passes A's private dashboard id
- **THEN** the response is `200` with no item for it

#### Scenario: Too many ids
- **WHEN** 21 ids are passed
- **THEN** the response is `400`
