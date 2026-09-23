## Purpose

Automatically refreshes dashboard panels bound to a pipeline's Output when that pipeline's run
completes successfully, by fanning a single shared SSE subscription per pipeline out to every
interested panel, so a write-triggered auto-run is visible without a manual refresh or reload.

## ADDED Requirements

### Requirement: Panels bound to a succeeded pipeline's Output refetch automatically
While a dashboard is mounted, for every distinct `pipelineId` backing at least one currently-mounted
output-bound panel, the frontend SHALL maintain a subscription to that pipeline's run-status SSE
channel (`GET /api/pipelines/:id/run-events`). When a `succeeded` event is received for a watched
pipeline, every currently-mounted panel whose bound Output's `pipelineId` matches SHALL refetch its
data, without a manual refresh action and without a full page reload.

#### Scenario: A chart panel refreshes after its pipeline's auto-run succeeds
- **WHEN** a form panel submit triggers a downstream pipeline's auto-run, and that pipeline's run
  reaches `succeeded`
- **THEN** a chart panel on the same dashboard, bound to an Output of that pipeline, refetches and
  renders the updated data without the user taking any refresh action

#### Scenario: A failed run does not trigger a refetch
- **WHEN** a watched pipeline's run reaches `failed` rather than `succeeded`
- **THEN** panels bound to that pipeline's Outputs do not refetch

### Requirement: One SSE connection per relevant pipeline per dashboard, not per panel
When more than one currently-mounted panel is bound to Outputs of the same `pipelineId`, the
frontend SHALL open exactly one SSE subscription for that `pipelineId` for the dashboard, and SHALL
dispatch a received `succeeded` event to every one of those panels — not one subscription per panel.

#### Scenario: Two panels bound to the same pipeline both refresh from one connection
- **WHEN** two panels on a dashboard are bound to different Outputs of the same pipeline, and that
  pipeline's run succeeds
- **THEN** both panels refetch, and at no point were two concurrent SSE connections open for that
  pipeline from the same dashboard

### Requirement: Refetch is scoped to affected panels only
A `succeeded` event for a given pipeline SHALL NOT cause a panel bound to a different pipeline's
Output (or a non-output panel) to refetch or re-render.

#### Scenario: An unrelated panel is unaffected
- **WHEN** pipeline A's run succeeds
- **THEN** a panel bound to an Output of unrelated pipeline B does not refetch

### Requirement: The watch subscription survives across multiple runs
After a watched pipeline's run reaches a terminal status, the frontend SHALL re-establish the
subscription for that pipeline (as long as it still backs a currently-mounted panel), so a
subsequent write-triggered run is also caught while the dashboard remains open.

#### Scenario: A second write after the first run also refreshes the panel
- **WHEN** a watched pipeline's run succeeds and refreshes its bound panel, and a second form submit
  later triggers a second auto-run of the same pipeline that also succeeds
- **THEN** the bound panel refetches again for the second run, with no reload of the dashboard page
  in between

### Requirement: The subscription recovers from a transient connection failure
If the SSE connection for a watched `pipelineId` fails to establish or drops without ever emitting a
terminal `run-status` event (a non-2xx response, a non-event-stream response, a network error, or an
unexpected stream end), the frontend SHALL retry the connection with a bounded exponential backoff
(capped at 30 seconds between attempts) for as long as at least one panel remains bound to that
pipeline, rather than permanently abandoning the subscription for the rest of the dashboard session.

#### Scenario: A transient connection failure recovers automatically
- **WHEN** the SSE connection for a watched pipeline fails to establish due to a transient error, and
  a subsequent retry attempt succeeds
- **THEN** the connection is re-established without any user action, and a later `succeeded` event for
  that pipeline still refreshes its bound panels

### Requirement: A refetch update is announced to assistive technology
When a panel's data changes as a result of this fan-out refetch, the update SHALL be exposed via a
computed accessible state change (e.g. an `aria-live` region's accessible text actually changing, or
an equivalent computed ARIA property) — the mere presence of a live region in the DOM, with no
computed value change, does not satisfy this requirement.

#### Scenario: Screen reader users are notified of the refreshed panel
- **WHEN** a chart panel refetches new data as a result of a watched pipeline's `succeeded` event
- **THEN** the accessible name or description computed for the panel's live region changes to reflect
  the update, verifiable via the browser's computed accessibility tree — not merely by the presence
  of an `aria-live` attribute in markup
