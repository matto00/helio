## MODIFIED Requirements

### Requirement: Save persists appearance and closes the modal
Clicking Save MUST stage the title and ONLY the appearance fields the user changed (background, color, transparency), flushed to the backend by the batched save, and transition the modal to view mode on success. A save that changed nothing stages nothing. The modal SHALL NOT close after a save.

#### Scenario: Save submits appearance changes and returns to view mode
- **WHEN** the user modifies appearance values and clicks Save
- **THEN** only the changed appearance fields are staged for the backend
- **AND** the modal transitions to view mode (tab bar hidden, footer hidden)
- **AND** the modal does not close

## ADDED Requirements

### Requirement: Modal save preserves appearance fields it does not edit

Saving the panel detail modal SHALL NOT change any appearance field the user did not edit in that save. In particular a
stored `appearance.chart` object and an untouched background, color or transparency SHALL be preserved, both in the
server-stored panel and in the client's in-memory panel state (and therefore the rendered panel) immediately after save,
without requiring a reload.

#### Scenario: Title-only save keeps a stored chart appearance and background

- **WHEN** a panel has a non-default stored `appearance.chart` and a non-default background, and the user opens the
  detail modal, changes only the title and saves
- **THEN** reading the panel back from the server returns the same `appearance.chart` and background as before the save,
  and the new title

#### Scenario: Client state keeps the chart appearance after save

- **WHEN** the same title-only save completes in the browser
- **THEN** the panel in client state still carries the stored `appearance.chart` before the pending batch is flushed,
  so the panel renders with the same chart type throughout, not only after the flush or a reload

#### Scenario: Title-only save keeps a non-whole-percent transparency exactly

- **WHEN** a panel's stored transparency is not a whole percent (for example 0.555) and the user saves the modal after
  changing only the title
- **THEN** the stored transparency is still exactly 0.555 afterwards

#### Scenario: Editing one appearance field leaves the others intact

- **WHEN** the user changes only the background in the modal and saves
- **THEN** the background updates and `appearance.chart`, color and transparency are unchanged on the server and in
  client state

#### Scenario: Two partial modal saves before a flush both reach the server

- **WHEN** the user saves the modal with only the background changed, then reopens it and saves with only the color
  changed, both before the pending batch is flushed
- **THEN** the flushed batch carries both the new background and the new color, and after the flush the panel keeps
  both on the server and in client state
