## ADDED Requirements

### Requirement: A user can open the chat surface, submit a goal, and see a streamed response
The chat surface SHALL provide a text input for a goal and, on submit, open a streaming connection
to `POST /api/authoring/dashboard?stream=true`, rendering a visible in-progress state while
`authoring-progress` events arrive.

#### Scenario: Submitting a goal opens a streaming connection and shows progress
- **WHEN** a user types a goal and submits it
- **THEN** the chat surface issues `POST /api/authoring/dashboard?stream=true` with the goal, and
  displays an in-progress state while streamed events arrive, before any terminal event lands

### Requirement: A terminal result hands the proposal to the existing Proposal Review UI unmodified
On an `authoring-result` SSE event, the chat surface SHALL navigate to `/proposals/review` passing
the proposal via `location.state.proposal`, the exact shape `ProposalReviewPage` already reads — no
new or modified apply path.

#### Scenario: A successful result navigates to the existing review route
- **WHEN** a stub streaming response emits `authoring-progress` events followed by a terminal
  `authoring-result` event carrying a valid `DashboardProposal`
- **THEN** the chat surface navigates to `/proposals/review` with `location.state.proposal` equal to
  that `DashboardProposal`, and no `POST /api/dashboards/apply-proposal` call is made by the chat
  surface itself

### Requirement: Nothing is written until the user explicitly accepts in the review UI
The chat surface SHALL NOT call the apply-proposal endpoint at any point in its own flow; only the
existing `ProposalReview` UI's Accept action (dispatching `applyProposal`) may do so.

#### Scenario: No dashboard is created by the chat surface alone
- **WHEN** a goal is submitted and a valid proposal is streamed back
- **THEN** no dashboard or panel is created as a result of the chat surface's own behavior — creation
  only happens if the user subsequently accepts in the review UI

### Requirement: A terminal error or connection failure surfaces inline without navigating away
On an `authoring-error` SSE event, or a connection failure/drop, the chat surface SHALL display an
inline error and SHALL NOT navigate to the review route.

#### Scenario: An authoring error is shown inline
- **WHEN** a stub streaming response emits a terminal `authoring-error` event
- **THEN** the chat surface displays that error message inline and does not navigate to
  `/proposals/review`

#### Scenario: A connection failure is shown inline
- **WHEN** the streaming `fetch` call itself fails or the response is not a valid SSE stream
- **THEN** the chat surface displays a connection-error state and does not navigate to
  `/proposals/review`

### Requirement: An intermediate repair status is surfaced, not raw mid-stream JSON
On an `authoring-status` event, the chat surface SHALL surface the status label (e.g. "repairing")
rather than silently continuing to display raw, incomplete JSON text.

#### Scenario: A repair status is visible to the user
- **WHEN** a stub streaming response emits an `authoring-status` event with label `"repairing"`
  between two `authoring-progress` sequences
- **THEN** the chat surface's displayed state reflects that a repair attempt is in progress

### Requirement: A discoverable entry point opens the chat surface
An "Author with AI" (or equivalently labeled) affordance SHALL be reachable from the existing
dashboard-creation area of the app and SHALL open the chat surface when activated.

#### Scenario: The entry point opens the chat surface
- **WHEN** a user activates the "Author with AI" affordance
- **THEN** the chat surface opens, ready to accept a goal
