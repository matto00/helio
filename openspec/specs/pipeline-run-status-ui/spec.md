# pipeline-run-status-ui Specification

## Purpose
TBD - created by archiving change run-status-indicator. Update Purpose after archive.
## Requirements
### Requirement: usePipelineRunEvents hook manages SSE connection lifecycle
The frontend SHALL provide a `usePipelineRunEvents(pipelineId: string, active: boolean)` hook that
opens an `EventSource` to `GET /api/pipelines/:id/run-events` when `active` is `true`. The hook
SHALL parse each `run-status` event's JSON data and return `{ status, rowCount, errorLog }`. On a
terminal event (`succeeded`, `failed`, `dry_run`) the hook SHALL close the connection automatically.
When `active` transitions to `false` the hook SHALL close any open connection.

#### Scenario: Hook opens SSE connection when active becomes true
- **WHEN** `usePipelineRunEvents` is called with `active: true`
- **THEN** an `EventSource` is created targeting `/api/pipelines/:id/run-events`

#### Scenario: Hook returns status from received events
- **WHEN** the SSE stream emits a `run-status` event with `{ status: "running" }`
- **THEN** the hook's returned `status` value is `"running"`

#### Scenario: Hook closes connection on terminal event
- **WHEN** the SSE stream emits `{ status: "succeeded" }`
- **THEN** the `EventSource` is closed

#### Scenario: Hook closes connection when active flips to false
- **WHEN** `active` changes from `true` to `false`
- **THEN** any open `EventSource` is closed

#### Scenario: Hook surfaces rowCount on succeeded event
- **WHEN** the SSE stream emits `{ status: "succeeded", rowCount: 42 }`
- **THEN** the hook's returned `rowCount` is `42`

#### Scenario: Hook surfaces errorLog on failed event
- **WHEN** the SSE stream emits `{ status: "failed", errorLog: "Division by zero" }`
- **THEN** the hook's returned `errorLog` is `"Division by zero"`

### Requirement: StatusBadge renders running and queued transient states
The `StatusBadge` component SHALL render a spinner animation for the `running` status and a pulsing
indicator for the `queued` status, in addition to the existing `succeeded`, `failed`, and `dry_run`
static states.

#### Scenario: Running status shows spinner
- **WHEN** `StatusBadge` receives `status="running"`
- **THEN** the badge renders with a spinner element and appropriate accessible label

#### Scenario: Queued status shows pulsing indicator
- **WHEN** `StatusBadge` receives `status="queued"`
- **THEN** the badge renders with a pulsing/animated indicator

#### Scenario: Succeeded status unchanged from prior behavior
- **WHEN** `StatusBadge` receives `status="succeeded"`
- **THEN** the badge renders the checkmark style as before

#### Scenario: Failed status unchanged from prior behavior
- **WHEN** `StatusBadge` receives `status="failed"`
- **THEN** the badge renders the error style as before

### Requirement: PipelineDetailPage wires SSE hook and shows live run status
`PipelineDetailPage` SHALL activate `usePipelineRunEvents` immediately when a run is submitted and
display the streaming status inline. On a terminal SSE event the page SHALL refresh run history.
The run button SHALL remain disabled while `status` is `queued` or `running`.

#### Scenario: Run button disabled during active run
- **WHEN** `status` is `running` or `queued`
- **THEN** the Run and Dry Run buttons are disabled

#### Scenario: Run history refreshes after terminal SSE event
- **WHEN** the SSE stream emits `succeeded`, `failed`, or `dry_run`
- **THEN** `fetchPipelineRunHistory` is dispatched so the history panel reflects the new record

#### Scenario: Succeeded state shows row count
- **WHEN** `status` is `succeeded` and `rowCount` is available
- **THEN** the inline status label includes the row count

#### Scenario: Failed state shows error message
- **WHEN** `status` is `failed` and `errorLog` is non-empty
- **THEN** the inline status label includes the error message

