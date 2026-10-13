# dashboard-layout-validation Specification

## Purpose
Guarantee that a dashboard layout the server stores never contains out-of-bounds or overlapping panels in a breakpoint it newly writes, using the same geometry rules as the frontend grid, while leaving previously stored bad layouts editable.

## Requirements

### Requirement: Layout geometry contract is identical on client and server

A breakpoint layout SHALL be valid when every item has `x >= 0`, `y >= 0`, `w >= 1`, `h >= 1`, `x + w <= cols` for that breakpoint, and no two items overlap. Two items overlap when `a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y` (touching edges do not overlap). Column counts SHALL be `lg=12, md=10, sm=6, xs=2`. The frontend and backend SHALL agree on every case in one shared fixture file that both test suites read.

#### Scenario: Shared fixture agreement
- **WHEN** the frontend `isLayoutValid`/`findOverlaps` and the backend validator are run over every case in the shared fixture
- **THEN** both report exactly the fixture's expected verdict, offending panel ids and violation kinds

### Requirement: A changed breakpoint must be valid or the whole write is rejected

For every layout write that carries caller-supplied breakpoints (REST `PATCH /api/dashboards/:id` and `PATCH /api/dashboards/:id/update`, MCP layout tools, proposal apply, contents replace, auto-layout), each supplied breakpoint that is not identical to the stored breakpoint SHALL be validated. If any is invalid the server SHALL respond `400` with a message naming the breakpoint and the offending panel ids (overlapping pairs, out-of-bounds items) and SHALL persist nothing, including breakpoints that were valid. The server SHALL NOT clamp, reflow or otherwise alter a caller-supplied breakpoint. Dashboard import is the one exception: an imported breakpoint that is invalid SHALL be stored repaired (see "Import stores bad breakpoints repaired") rather than rejected.

#### Scenario: Overlap at xs is rejected
- **WHEN** a PATCH sets `xs` with two panels at the same cell
- **THEN** the response is `400`, the message names `xs` and both panel ids, and the stored layout is unchanged

#### Scenario: Out-of-bounds at xs is rejected
- **WHEN** a PATCH sets `xs` with a panel `x=1, w=2`
- **THEN** the response is `400` naming `xs` and that panel id, and nothing is saved

#### Scenario: One bad breakpoint rejects the whole write
- **WHEN** a PATCH sets a valid `lg` and an invalid `xs`
- **THEN** the response is `400` and `lg` is not saved either

### Requirement: Breakpoints identical to the stored one pass through untouched

A supplied breakpoint SHALL be considered identical to the stored breakpoint when both contain the same multiset of `(panelId, x, y, w, h)` items, regardless of array order. An identical breakpoint SHALL NOT be validated and SHALL NOT be rewritten (stored order retained). A breakpoint absent from a PATCH SHALL be preserved as stored.

#### Scenario: Editing lg on a dashboard with a stored-bad xs
- **WHEN** a dashboard's stored `xs` overlaps and a client PATCHes all four breakpoints with a changed `lg` and the stored `xs` unchanged (possibly reordered)
- **THEN** the write succeeds and the stored `xs` is byte-identical to before

#### Scenario: Touching a stored-bad breakpoint requires it to be valid
- **WHEN** a client PATCHes a stored-bad `xs` with a different but still overlapping `xs`
- **THEN** the response is `400` naming `xs`

#### Scenario: Partial PATCH
- **WHEN** a PATCH supplies only `xs`
- **THEN** `lg`, `md`, `sm` are preserved exactly

### Requirement: System-computed layouts are valid by construction

Layouts the server computes itself (default placement of a new panel, proposal apply, contents replace, auto-layout) SHALL derive each of `md/sm/xs` by reflowing at that breakpoint's own column count rather than scaling x/w proportionally, and SHALL never produce an overlap or out-of-bounds item. A new panel's default placement SHALL be at the bottom of each breakpoint's own existing items. Restoring a previously stored layout (patch-set rollback/undo) and duplicating a dashboard SHALL copy stored values faithfully and are exempt from validation.

#### Scenario: Proposal with three tiles reaches xs without overlap
- **WHEN** a proposal places three 4-wide panels side by side on lg and is applied
- **THEN** the stored `xs` has no overlapping or out-of-bounds item

#### Scenario: Invalid proposal layout fails before any panel is created
- **WHEN** a proposal's lg layout has two overlapping panels
- **THEN** apply returns `400` naming `lg` and the proposal panels, and no panel is created

### Requirement: The web client never persists an invalid changed breakpoint and never fails silently

The web client SHALL NOT send a layout breakpoint that differs from the last server-acknowledged layout and is invalid among the panels this tab has loaded; it SHALL send the breakpoint as displayed (the render-time resolved layout) instead. Items of panels this tab has not loaded are not judged by the client: they are sent as authored and the server is the authority on their validity. When it sends the displayed breakpoint in place of an invalid one, it SHALL also send the authored items of panels this tab has not loaded, unchanged, so a substitution never drops another writer's panel item; the server adjudicates those items (an item of a deleted panel is dropped, an overlap with a live panel is rejected). After creating a panel the client SHALL adopt the server's stored placement for every breakpoint. A rejected layout save SHALL be shown to the user in human-readable client copy that contains no raw panel ids, and the client SHALL re-sync the dashboard layout from the server.

#### Scenario: Undo to a bad snapshot after repair
- **WHEN** a user repairs a stored-bad `xs` by dragging and then undoes
- **THEN** the save succeeds and the stored `xs` is the displayed (valid) layout

#### Scenario: Create panel then drag
- **WHEN** a user creates a panel and then drags another panel in `lg`
- **THEN** the layout save is accepted

#### Scenario: Substitution keeps an unloaded panel's item
- **WHEN** a changed breakpoint is invalid and the authored breakpoint holds an item for a panel this tab has not loaded
- **THEN** the breakpoint sent is the displayed layout of the loaded panels plus that panel's authored item, unchanged

#### Scenario: Filling a deleted panel's slot still saves
- **WHEN** a user deletes a panel and then moves another panel into the deleted panel's former position
- **THEN** the layout save is accepted and the user sees no error

#### Scenario: Overlap with a live unloaded panel is rejected visibly
- **WHEN** the substituted breakpoint's displayed items overlap the item of a live panel this tab has not loaded, the re-sync from the server succeeds, and this tab's panel list is loaded for the dashboard and did not fail to load
- **THEN** the server responds `400`, nothing is stored, and the user sees the existing "layout was changed elsewhere" copy

#### Scenario: Rejected save is visible
- **WHEN** the server responds `400` to a layout save
- **THEN** the user sees human-readable copy with no raw panel ids and the grid re-syncs from the server layout

#### Scenario: Rejection with no proof of an unloaded panel
- **WHEN** a layout save is rejected with a status other than `400` or `409`, or this tab's panel list is not loaded for the dashboard, or the panel list failed to load, or the re-sync failed, or the re-synced layout holds no item of a panel this tab has not loaded
- **THEN** the user sees the generic "Failed to save dashboard layout." copy, not the server's message

#### Scenario: Rejection caused by an unloaded panel
- **WHEN** a layout save is rejected with `400`, the re-sync from the server succeeds, this tab's panel list is loaded for the dashboard and did not fail to load, and the re-synced server layout holds items of panels this tab has not loaded
- **THEN** the user sees the existing "layout was changed elsewhere" copy, not the server's message

### Requirement: Import stores bad breakpoints repaired

`POST /api/dashboards/import` SHALL store each invalid breakpoint of the snapshot repaired: valid under the HEL-1071
contract and holding exactly the same panels as the snapshot's breakpoint (no panel dropped or added). Valid
breakpoints SHALL be stored exactly as supplied. A layout entry that references no snapshot panel SHALL still be
rejected with `400`.

#### Scenario: Exported bad dashboard imports
- **WHEN** a snapshot whose `xs` has two panels at the same cell is imported
- **THEN** the import succeeds, the stored `xs` is valid and holds both panels, and `lg`/`md`/`sm` are stored as supplied

#### Scenario: Out-of-bounds breakpoint imports
- **WHEN** a snapshot's `md` holds an item with `x + w = 12`
- **THEN** the import succeeds and the stored `md` is within 10 columns

### Requirement: Every panel create stores a valid layout item at every breakpoint

Every server path that creates a panel on a dashboard SHALL, in the same transaction as the panel insert, store one
layout item for the new panel in each of `lg`, `md`, `sm` and `xs`. This applies to:
- single create of any kind (`output`, `text`, `markdown`, `image`, `divider`, `form`);
- every item of a batch create;
- panel duplicate;
- proposal apply and contents replace, including a panel with no authored placement.

Each item SHALL be placed at `x = 0`, below the lowest stored item of that breakpoint or below items placed earlier in
the same request. Sizes:
- An `output` panel SHALL use its Output kind's default size, scaled to the breakpoint's column count as before.
- A `text`, `markdown`, `image`, `divider` or `form` panel SHALL be `5` rows high, at width `4` at `lg`, `4` at `md`,
  `3` at `sm` and `2` at `xs`. This is the size the client renders an unplaced panel at. An `output` panel whose
  Output cannot be resolved SHALL take the same size.
- A duplicated panel SHALL be sized per `panel-duplication` (source stored size, else scaled source `lg`, else the
  kind default above).

After the write:
- A breakpoint that was valid before the create SHALL be valid under the HEL-1071 contract.
- A breakpoint that was stored-bad SHALL keep its existing items unchanged and gain an item that overlaps none of them.

Two concurrent creates on the same dashboard SHALL both end up stored; neither placement may be lost.

Dashboard duplicate and dashboard import are copies, not panel creates. They SHALL keep copying the source or snapshot
layout as already specified. A panel they carry without an item is left to the owner's stored-layout repair
(`stored-layout-repair`).

#### Scenario: Text panel create stores an item per breakpoint
- **WHEN** the owner creates a `text` panel on a dashboard whose stored layout is empty
- **THEN** the stored `lg`, `md`, `sm` and `xs` each hold exactly one item for that panel, and each breakpoint is valid

#### Scenario: Content panel default size per breakpoint
- **WHEN** a `text` panel is created on a dashboard with an empty layout
- **THEN** its stored items are `w 4 h 5` at `lg`, `w 4 h 5` at `md`, `w 3 h 5` at `sm` and `w 2 h 5` at `xs`, all at
  `x 0, y 0`

#### Scenario: Every kind is placed
- **WHEN** a panel of each kind `output`, `text`, `markdown`, `image`, `divider` and `form` is created on one dashboard
- **THEN** every created panel has an item in every stored breakpoint and no two items overlap in any breakpoint

#### Scenario: Created item passes the layout write validator
- **WHEN** a client takes the stored layout after a create and sends every breakpoint back unchanged in a layout PATCH
- **THEN** the PATCH is accepted with `200`

#### Scenario: Concurrent creates both persist
- **WHEN** two panels are created on the same dashboard concurrently
- **THEN** the stored layout holds an item for both panels in every breakpoint, and no two items overlap

#### Scenario: Editor grantee create is placed under row-level security
- **WHEN** a user holding an editor grant creates a panel while the database enforces row-level security for the
  application role
- **THEN** the panel and its item in every breakpoint are stored

#### Scenario: Proposal panel without an authored placement is placed
- **WHEN** a proposal is applied in which one panel has an authored `lg` placement and another has none
- **THEN** both panels have an item in every stored breakpoint, the authored one keeps its `lg` placement, and every
  breakpoint is valid

#### Scenario: Duplicated dashboard keeps an orphan for the owner repair
- **WHEN** a dashboard holding a panel with no stored item is duplicated or exported and imported
- **THEN** the new dashboard's stored layout for its other panels is copied as specified, and the owner repair
  endpoint accepts the orphan appended to it with every prior item unchanged

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
