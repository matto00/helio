# first-run-dashboard-build Specification

## Purpose
The deterministic, no-AI first-run build: a CSV dropped or linked on an empty workspace becomes a source, a rule-built pipeline and a full-width dashboard, with beta-only assistant refinement.

## Requirements

### Requirement: The first run is deterministic and makes no Claude call
The system SHALL build a first dashboard from an uploaded or URL-referenced CSV source by rule, without any Claude/LLM call, for every tier. The builder SHALL NOT be tier-gated and SHALL have no ClaudeClient dependency.

#### Scenario: Free-tier build makes zero Claude calls
- **WHEN** a free-tier user builds a first dashboard from a CSV source
- **THEN** the dashboard is created and a counting Claude transport double records zero calls

### Requirement: Column typing and shape selection follow a stated rule
Because CSV columns materialize as strings, the builder SHALL sample up to 200 rows and classify each column as numeric (>= 90% parseable), date-like (>= 90% parseable by the datebucket step's own date parser, tested only for non-numeric columns), categorical or text; SHALL prepend a `cast` step (double) for numeric columns only; SHALL always produce a passthrough table output; SHALL add a `time-series` output when a date-like and a numeric column exist and a `top-n` output (preceded by an aggregate group-by) when a categorical and a numeric column exist.

#### Scenario: Date, category and numeric columns
- **WHEN** the CSV has a date-like, a categorical and a numeric column
- **THEN** the pipeline has a cast step and three outputs: table, time-series and top-n, each bound to one panel

#### Scenario: No numeric column
- **WHEN** the CSV has no numeric column
- **THEN** a dashboard with a single table panel is produced and no cast step exists

### Requirement: The build is atomic, runs the pipeline, and lays out safely
The builder SHALL apply the pipeline (including running it) and then the dashboard; a failure in the dashboard phase SHALL roll the pipeline back. Every panel SHALL carry an explicit full-width layout at lg (x=0, w=12, cumulative y) so items stack full width without overlap at lg, md, sm and xs.

#### Scenario: Dashboard phase fails
- **WHEN** dashboard creation fails after the pipeline was applied
- **THEN** the pipeline is rolled back and an error is returned

#### Scenario: Mobile layout
- **WHEN** a dashboard with 1, 2 or 3 panels is built
- **THEN** no two layout items overlap at any breakpoint

### Requirement: The user lands on a dashboard URL
After a successful build the client SHALL navigate to the authenticated route `/dashboards/:id`, which selects and renders that dashboard.

#### Scenario: Landing
- **WHEN** the build succeeds
- **THEN** the URL is `/dashboards/<new id>` and the panels render real rows

### Requirement: Drop zone with keyboard/touch equivalent and announced progress
The empty-workspace landing SHALL offer a drop zone, a "Choose a file" button and a paste-a-URL field; progress SHALL be announced via a polite live region and errors via an alert role.

#### Scenario: Keyboard-only
- **WHEN** a user only uses the keyboard
- **THEN** the file picker and URL field are reachable and operable

#### Scenario: Failures
- **WHEN** the CSV is unparseable/empty, oversized, the URL fails to fetch, or a request fails
- **THEN** a specific error is announced and the user can retry; a CSV with no numeric columns still yields a table dashboard

### Requirement: Refine with the assistant is beta/owner only
The landed dashboard SHALL show "Refine with the assistant" only when the user's tier is `beta` or `owner`; for `free` it SHALL NOT be rendered. Activating it SHALL open the chat with a draft naming the new source and pipeline.

#### Scenario: Tier visibility
- **WHEN** a beta user and a free user view the landed dashboard
- **THEN** only the beta user sees the action

### Requirement: First-run telemetry
The drop zone SHALL emit `firstrun_file_dropped` and a successful build SHALL emit `firstrun_dashboard_created` via `track()`, and SHALL NOT emit `first_dashboard_rendered`.

#### Scenario: Events
- **WHEN** a file is dropped and the build succeeds
- **THEN** both events are tracked once each
