## MODIFIED Requirements

### Requirement: Modal dismisses on Escape, backdrop click, and Cancel
The modal MUST close when the user presses Escape (in view mode), clicks the backdrop (in view
mode), or clicks the close (✕) button (in view mode) — with a discard warning if there are
unsaved changes and the modal is in edit mode. In edit mode, Escape, the close (✕) button,
backdrop click, and Cancel all return to view mode (not close the modal) — including after
confirming the discard warning; see the `panel-edit-mode-save-cancel` capability for the full
Cancel/Esc flow.

HEL-716: the close (✕) button previously closed the modal outright from edit mode — both when
clicked with no unsaved changes, and after confirming the discard warning — unlike Escape,
backdrop click, and Cancel, which always returned to view mode in both of those cases. Migrating
onto the shared `Modal` primitive unifies its three dismiss vectors (close button, backdrop
click, Escape) behind a single `onClose` callback with no way to distinguish which vector
triggered it, so the close button's distinct "closes outright" behavior could not survive
alongside that unification. It now matches Escape/backdrop/Cancel: dismissing from edit mode —
by any vector, in either the clean or the dirty-then-confirmed case — always returns to view
mode rather than closing the modal component. Only a dismiss from view mode actually closes it.

#### Scenario: Escape closes the modal from view mode
- **GIVEN** the modal is in view mode
- **WHEN** the user presses Escape
- **THEN** the modal closes immediately

#### Scenario: Backdrop click closes the modal from view mode
- **GIVEN** the modal is in view mode and no changes have been made
- **WHEN** the user clicks outside the modal content area
- **THEN** the modal closes

#### Scenario: Close (✕) button closes the modal from view mode
- **GIVEN** the modal is in view mode
- **WHEN** the user clicks the close (✕) button
- **THEN** the modal closes immediately

#### Scenario: Close (✕) button with no unsaved changes returns to view mode from edit mode
- **GIVEN** the modal is in edit mode with no unsaved changes
- **WHEN** the user clicks the close (✕) button
- **THEN** the modal transitions to view mode
- **AND** the modal does not close

#### Scenario: Dismiss with unsaved changes from edit mode shows a warning
- **GIVEN** the user has changed a value in edit mode
- **WHEN** the user presses Escape, clicks the close (✕) button, or clicks Cancel
- **THEN** an inline discard warning is shown instead of closing or returning to view mode immediately

#### Scenario: Confirming discard returns to view mode, regardless of which vector triggered it
- **GIVEN** the discard warning is shown (triggered by Escape, the close (✕) button, backdrop
  click, or Cancel)
- **WHEN** the user confirms discard
- **THEN** the modal transitions to view mode and changes are not persisted
- **AND** the modal does not close
