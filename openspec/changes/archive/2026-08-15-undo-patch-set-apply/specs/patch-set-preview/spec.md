## ADDED Requirements

### Requirement: A successful Accept SHALL offer an Undo action that does not auto-dismiss
`PatchSetReviewPage`'s Accept flow SHALL, on a successful apply that returns an `applicationId`,
show an actionable, non-auto-dismissing "Undo" affordance before navigating away.

#### Scenario: Accepting a patch set offers Undo
- **WHEN** the user clicks Accept and the apply call returns an `applicationId`
- **THEN** a toast notification appears with an "Undo" action bound to that `applicationId`, before
  the page navigates back to the dashboard

#### Scenario: The Undo toast does not disappear on its own
- **WHEN** the Undo toast from a successful Accept has been visible for longer than the shared
  toast system's default auto-dismiss duration
- **THEN** it is still visible — only an explicit user dismissal, or a later toast replacing it,
  removes it

#### Scenario: Clicking Undo calls the undo endpoint
- **WHEN** the user clicks the "Undo" action on that toast
- **THEN** the app calls `POST /api/patch-sets/:id/undo` with that application's id

#### Scenario: An apply with no applicationId shows no Undo action
- **WHEN** the apply call succeeds but returns no `applicationId` (nothing was journaled)
- **THEN** no "Undo" action is offered
