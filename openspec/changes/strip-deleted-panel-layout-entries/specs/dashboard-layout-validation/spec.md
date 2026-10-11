## ADDED Requirements

### Requirement: Deleting a panel removes its layout items from every breakpoint

When a panel row is deleted by any path (single delete, bulk delete by Output, patch-set apply/rollback/undo, or a
database cascade from an Output, pipeline step, pipeline, pipeline root or data-source delete), the system SHALL remove
every item for that panel id from the lg, md, sm and xs breakpoints of its dashboard's stored layout, in the same
transaction as the row delete. The dashboard row SHALL be locked for the write so a concurrent panel create on the same
dashboard is serialized against it and neither change is lost. Items for other panels SHALL be kept unchanged and in
stored order.

#### Scenario: Single delete strips the panel from every breakpoint
- **WHEN** a dashboard holds panels A and B with items in every breakpoint and B is deleted via `DELETE /api/panels/:id`
- **THEN** the stored layout holds no item for B in lg, md, sm or xs, and A's items are unchanged

#### Scenario: Creating a panel after a delete leaves no gap
- **WHEN** panel A is at the top, panel B below it, B is deleted, and panel C is then created
- **THEN** C's item in every breakpoint starts at A's bottom, not B's old bottom

#### Scenario: Auto-layout after a delete adds no offset
- **WHEN** a panel is deleted and auto-layout then packs the remaining panels
- **THEN** no packed item is offset below the deleted panel's old position

#### Scenario: Cascade delete strips the panels bound to an Output
- **WHEN** an Output bound to panels on one or more dashboards is deleted, directly or through a pipeline step,
  pipeline or data-source delete
- **THEN** none of those dashboards' stored layouts holds an item for any of the removed panels

#### Scenario: Deleting a dashboard is unaffected
- **WHEN** a dashboard with panels is deleted
- **THEN** the delete succeeds exactly as before

### Requirement: Stored layouts hold no items for deleted panels

A one-off repair SHALL remove every stored layout item whose panel id is not a panel of that dashboard, in every
breakpoint, leaving live panels' items unchanged and in stored order.

#### Scenario: Existing ghost items are stripped
- **WHEN** a dashboard's stored layout holds items for a panel id that no longer exists on that dashboard
- **THEN** after the repair those items are gone and every live panel's item is byte-for-byte unchanged

### Requirement: Layout writes never store items for panels not on the dashboard

Every dashboard layout update (`PATCH /api/dashboards/:id` from any client, and internal restores of a previously
stored layout such as patch-set undo/rollback) SHALL drop, before validation and storage, every supplied item whose
`panelId` is not a panel of that dashboard, keeping all other items unchanged and in order; such items are silently dropped, not rejected. A write that was valid
before the filter SHALL NOT be rejected because of it.

#### Scenario: A PATCH carrying a deleted panel's item stores no ghost
- **WHEN** panel B has been deleted and a client PATCHes a breakpoint that still holds B's item
- **THEN** the stored and returned layout holds no item for B, and the other items are stored as sent

#### Scenario: Restoring a pre-delete layout stores no ghost
- **WHEN** a patch-set undo restores a dashboard layout recorded before panel B was deleted
- **THEN** the stored layout holds no item for B

#### Scenario: A stale stored ghost in an unsent breakpoint is not written back
- **WHEN** the layout read by an update still holds a deleted panel's item in a breakpoint the patch does not supply
- **THEN** the written layout holds no item for that panel in any breakpoint

### Requirement: Patch-set undo ignores layout items for panels no longer on the dashboard

The patch-set undo conflict check SHALL compare a dashboard's live and journaled layouts restricted to the dashboard's
current panels, so the automatic removal of a deleted panel's items never by itself marks the dashboard as changed.

#### Scenario: Undo of a patch set that updated a dashboard and deleted one of its panels
- **WHEN** a patch set updated dashboard D and deleted panel P on D, and nothing else changed D
- **THEN** undo is not refused as a conflict on D
