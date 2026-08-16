## ADDED Requirements

### Requirement: Agent memory list displays every stored entry
The settings page SHALL fetch and display the caller's stored agent-memory entries, each showing
its kind, content, and last-used time.

#### Scenario: Populated list renders
- **WHEN** the agent-memory fetch succeeds for a caller with stored entries
- **THEN** each entry's kind, content, and last-used time are displayed

#### Scenario: Empty list renders an empty state
- **WHEN** the agent-memory fetch succeeds for a caller with no stored entries
- **THEN** an empty state is shown, not a blank list or an error

#### Scenario: Never-used entry displays without a last-used time
- **WHEN** a stored entry has no `lastUsedAt`
- **THEN** the list renders that entry without a misleading or fabricated last-used value

### Requirement: Deleting a single memory entry uses an inline confirm, never window.confirm
Deleting an individual memory entry SHALL use this codebase's established inline confirm/cancel
affordance (mirroring `MetricListTable.tsx`), not the browser's native `window.confirm`.

#### Scenario: Delete requires confirmation
- **WHEN** a user clicks delete on a memory entry
- **THEN** an inline confirm/cancel affordance appears for that entry, and the entry is not yet
  deleted

#### Scenario: Confirming delete removes the entry
- **WHEN** a user confirms the inline delete prompt for an entry
- **THEN** that entry is removed from the list and the deletion is persisted

#### Scenario: Canceling delete leaves the entry intact
- **WHEN** a user cancels the inline delete prompt
- **THEN** the entry remains in the list, unmodified

### Requirement: Clearing all memory entries uses an inline confirm, never window.confirm
Clearing all memory entries SHALL use the same inline confirm/cancel affordance shape as a
single-entry delete, applied at the list level rather than per-row.

#### Scenario: Clear all requires confirmation
- **WHEN** a user clicks "Clear all"
- **THEN** an inline confirm/cancel affordance appears, and no entries are yet removed

#### Scenario: Confirming clear all removes every entry
- **WHEN** a user confirms "Clear all"
- **THEN** every stored entry is removed from the list and the clear is persisted

#### Scenario: Canceling clear all leaves every entry intact
- **WHEN** a user cancels the "Clear all" prompt
- **THEN** every entry remains in the list, unmodified
