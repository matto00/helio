## MODIFIED Requirements

### Requirement: The active rail item is marked with the accent and aria-current
The rail item for the current section SHALL carry `aria-current="page"` and SHALL be the only rail item painted with
the accent (`--app-accent-dim` wash, `--app-accent` icon). On `/home` that item SHALL be Home; on `/dashboards` and
`/dashboards/:id` it SHALL be Dashboards. The indicator SHALL be static (no slide) until the motion foundation ships.

#### Scenario: Exactly one active item on a dashboard
- **WHEN** the user is on `/dashboards`
- **THEN** exactly one rail item has `aria-current="page"` and it is Dashboards

#### Scenario: Exactly one active item on Home
- **WHEN** the user is on `/home`
- **THEN** exactly one rail item has `aria-current="page"` and it is Home

### Requirement: Context list content follows the section
The context list SHALL show: on dashboard routes, the dashboard filter and folders (see `dashboard-folders`); on
Data Pipelines routes, a Recent group and a Scheduled group of scheduled pipelines with their next run; on Data
Sources routes, a Recent group and a Scheduled group of sources that feed a scheduled pipeline, each with the soonest
next run among those pipelines (both from one `GET /api/pipeline-schedules` request, see
`pipeline-schedule-list-api`); on Assistant routes, the existing conversation list; on Home, Connectors, Settings and
review routes, no context list (rail only, without changing the saved collapsed state). Recent groups SHALL come from
the existing recent-visits history, show at most 8 items, and offer a "View all" link to the section overview and the
section's add action. The Sources and Pipelines lists SHALL NOT list every item of the section.

#### Scenario: Pipelines list no longer duplicates the table
- **WHEN** a user with 30 pipelines, 2 of them recently visited, opens `/pipelines`
- **THEN** the context list shows those 2 under Recent and no list of all 30 pipelines

#### Scenario: Scheduled pipelines show their next run
- **WHEN** the user owns a pipeline with an enabled schedule whose next run is 14:00
- **THEN** the Pipelines context list shows it under Scheduled with its next run time in mono type

#### Scenario: Sources show the soonest scheduled run
- **WHEN** a source feeds two of the user's scheduled pipelines, next running at 14:00 and 09:00
- **THEN** the Sources context list shows that source once under Scheduled with 09:00 and the pipeline running then

#### Scenario: Home has no context list
- **WHEN** the user opens `/home` with the context list expanded
- **THEN** no context list renders, and returning to `/dashboards` shows it expanded again
