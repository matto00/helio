## Purpose

Provides a minimal, read-only frontend surface, reachable from the settings/account area, that lets a user review their own audit history in human-readable form.

## ADDED Requirements

### Requirement: Read-only audit event list
The system SHALL render the authenticated user's own audit events as a table, showing a human-readable action, resource, actor, source, and timestamp for each row. Since every row is by construction the caller's own, the "actor" column SHALL be derived from the event's `source` (e.g. "You (browser)" for a UI-sourced event, "You (API token)" for a PAT-sourced event, "System" for a system-sourced event) rather than displaying the caller's own raw user id. The view SHALL offer no controls that mutate, delete, or export audit data.

#### Scenario: Viewing audit history
- **WHEN** an authenticated user with audit events navigates to the audit history view
- **THEN** the view displays their events with readable action, resource, actor, source, and timestamp values, most recent first

#### Scenario: No mutation affordance
- **WHEN** the audit history view is rendered
- **THEN** no button, link, or control on the view can modify or remove an audit event

### Requirement: First-page truncation is visible, not silent
The view SHALL show only the first page of results (v1 scope, no pagination controls) but SHALL make truncation visible whenever the total exceeds what is shown, rather than silently dropping older events with no indication.

#### Scenario: More events than one page holds
- **WHEN** a user has more audit events than the single page displayed
- **THEN** the view shows a caption indicating how many of the total events are currently shown

### Requirement: Source is represented honestly
The system SHALL NOT present `source=pat` events attributable to MCP calls as a distinguishable "MCP" source, since the backend does not currently record MCP calls with a distinguishing value; the UI SHALL label such events consistently with how the API represents them (e.g. as PAT-sourced) rather than inventing a distinction the data cannot support.

#### Scenario: PAT-sourced event is labeled as PAT
- **WHEN** an event with `source=pat` is displayed
- **THEN** the UI labels it using only the source value returned by the API, without inferring or labeling it as "MCP"

### Requirement: Empty and error states
The view SHALL render a distinct empty state when the user has no audit events, and a distinct error state when the request fails, without breaking the surrounding page.

#### Scenario: No audit events yet
- **WHEN** an authenticated user with zero audit events opens the view
- **THEN** the view shows an empty-state message instead of an empty table with no explanation

#### Scenario: Request failure
- **WHEN** the audit events request fails
- **THEN** the view shows an error state and does not crash the page
