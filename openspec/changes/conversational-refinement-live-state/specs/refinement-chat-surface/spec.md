## ADDED Requirements

### Requirement: The refinement drawer SHALL target the currently-open dashboard
`RefinementChatDrawer` SHALL send `target: {kind: "dashboard", id: <selectedDashboardId>}` on every
turn, taking that dashboard id from the app's already-selected dashboard, never a user-typed id.

#### Scenario: A refinement message targets the open dashboard
- **WHEN** a user submits a message in the refinement drawer while dashboard `D` is open
- **THEN** the request sent to `POST /api/refinements` has `target.id` equal to `D`'s id

### Requirement: A successful turn SHALL hand off to the existing patch-set review UI on explicit action only
The drawer SHALL NOT automatically navigate on a turn's completion — navigation to
`/patch-sets/review`, with `location.state.patchSet` set to the returned patch set, SHALL happen only
when the user explicitly activates "Review & apply."

#### Scenario: A completed turn keeps the drawer open for a follow-up
- **WHEN** a refinement turn completes with a valid `PatchSet`
- **THEN** the drawer appends the turn to the visible thread and stays open, ready for a follow-up
  message, rather than navigating away automatically

#### Scenario: Review & apply hands off the latest patch set unchanged
- **WHEN** the user activates "Review & apply" at any point in a refinement conversation
- **THEN** the app navigates to `/patch-sets/review` with `location.state.patchSet` set to the most
  recently returned patch set, and nothing has been written to any resource before this navigation

### Requirement: Nothing is written until the user accepts in patch-set review
No resource a returned patch set references SHALL be modified between a successful
`POST /api/refinements` response and the user's explicit Accept on `/patch-sets/review`.

#### Scenario: Closing the drawer or the review page without accepting leaves everything unchanged
- **WHEN** a user receives a refinement turn's patch set and closes the drawer or the review page
  without clicking Accept
- **THEN** every resource named in that patch set is byte-for-byte unchanged in the database
