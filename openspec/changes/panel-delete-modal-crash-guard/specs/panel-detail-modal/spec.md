## ADDED Requirements

### Requirement: Modal closes automatically when its backing panel is removed
The panel detail modal SHALL close automatically, rather than continue to render, once the panels
list is known up to date (a successfully-loaded panels list) and no longer contains the panel
backing it — for any reason, including the panel being deleted from another surface, deleted by
another actor (a second tab, an MCP/agent apply, or a proposal apply), or the parent dashboard
being removed. This applies regardless of which mode (view or edit) the modal was in, including
when the modal has unsaved edits — the auto-close bypasses the ordinary discard-confirmation
prompt in this case, since the panel itself no longer exists and there is nothing left to save.
The modal SHALL NOT render with an undefined backing panel at any time, including during a
transient panels-list loading or failed-refetch state — during such a transient state the modal is
not rendered (it is not visible to the user), but it SHALL NOT be permanently dismissed either: its
underlying "which panel is this for" state SHALL be preserved through the transient state, so that
if the panels list subsequently loads successfully with the panel still present, the modal is shown
again for that same panel. The modal is only permanently closed once the list is confirmed
successfully loaded and still missing the panel. (Any in-progress unsaved edits within the modal are
not preserved across this not-rendered window regardless of outcome — out of scope for this
requirement; see design.md.)

#### Scenario: Modal closes when its own panel is deleted
- **GIVEN** a panel's detail modal is open
- **WHEN** that same panel is deleted
- **THEN** the modal closes automatically
- **AND** no error is thrown

#### Scenario: Modal closes when its panel is removed by another actor
- **GIVEN** a panel's detail modal is open
- **WHEN** the backing panel is removed from the panels list by a source other than this modal's own
  interactions (e.g. a concurrent update), and the panels list has finished loading successfully
  without the panel present
- **THEN** the modal closes automatically
- **AND** no error is thrown

#### Scenario: Modal closes without a discard prompt when open in edit mode with unsaved changes
- **GIVEN** a panel's detail modal is open in edit mode with unsaved changes
- **WHEN** the backing panel is removed from the panels list (panels list successfully reloaded
  without it)
- **THEN** the modal closes automatically
- **AND** no discard-confirmation prompt is shown
- **AND** no error is thrown

#### Scenario: Modal recovers, rather than being permanently dismissed, after a transient panels-list refetch failure
- **GIVEN** a panel's detail modal is open
- **WHEN** the panels list enters a loading or failed state (e.g. a transient refetch failure)
- **THEN** no error is thrown
- **WHEN** the panels list subsequently loads successfully with the panel still present
- **THEN** the modal is shown again for that same panel (it was not permanently closed by the
  transient state)
