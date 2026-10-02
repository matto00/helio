## Purpose
Guarantee that a dashboard layout the server stores never contains out-of-bounds or overlapping panels in a breakpoint it newly writes, using the same geometry rules as the frontend grid, while leaving previously stored bad layouts editable.

## ADDED Requirements

### Requirement: Layout geometry contract is identical on client and server

A breakpoint layout SHALL be valid when every item has `x >= 0`, `y >= 0`, `w >= 1`, `h >= 1`, `x + w <= cols` for that breakpoint, and no two items overlap. Two items overlap when `a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y` (touching edges do not overlap). Column counts SHALL be `lg=12, md=10, sm=6, xs=2`. The frontend and backend SHALL agree on every case in one shared fixture file that both test suites read.

#### Scenario: Shared fixture agreement
- **WHEN** the frontend `isLayoutValid`/`findOverlaps` and the backend validator are run over every case in the shared fixture
- **THEN** both report exactly the fixture's expected verdict, offending panel ids and violation kinds

### Requirement: A changed breakpoint must be valid or the whole write is rejected

For every layout write that carries caller-supplied breakpoints (REST `PATCH /api/dashboards/:id` and `PATCH /api/dashboards/:id/update`, MCP layout tools, proposal apply, contents replace, auto-layout, dashboard import), each supplied breakpoint that is not identical to the stored breakpoint SHALL be validated. If any is invalid the server SHALL respond `400` with a message naming the breakpoint and the offending panel ids (overlapping pairs, out-of-bounds items) and SHALL persist nothing, including breakpoints that were valid. The server SHALL NOT clamp, reflow or otherwise alter a caller-supplied breakpoint.

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

The web client SHALL NOT send a layout breakpoint that differs from the last server-acknowledged layout and is invalid; it SHALL send the breakpoint as displayed (the render-time resolved layout) instead. After creating a panel the client SHALL adopt the server's stored placement for every breakpoint. A rejected layout save SHALL be shown to the user and the client SHALL re-sync the dashboard layout from the server.

#### Scenario: Undo to a bad snapshot after repair
- **WHEN** a user repairs a stored-bad `xs` by dragging and then undoes
- **THEN** the save succeeds and the stored `xs` is the displayed (valid) layout

#### Scenario: Create panel then drag
- **WHEN** a user creates a panel and then drags another panel in `lg`
- **THEN** the layout save is accepted

#### Scenario: Rejected save is visible
- **WHEN** the server responds `400` to a layout save
- **THEN** the user sees the server's message and the grid re-syncs from the server layout
