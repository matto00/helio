## MODIFIED Requirements

### Requirement: A stored-bad breakpoint is defined by the shared layout validity contract

A stored breakpoint SHALL be stored-bad exactly when the HEL-1071 validity contract rejects its stored items as stored,
including entries for panels that no longer exist. The contract requires items in bounds for that breakpoint's column
count, with no two items overlapping. A breakpoint SHALL be incomplete when it is not stored-bad but lacks an item for
at least one live panel of the dashboard. A breakpoint with no items, on a dashboard with live panels, is incomplete. A
breakpoint is repairable when it is stored-bad or incomplete. A breakpoint that is both stored-bad and missing
a live panel is treated as stored-bad. This reverses HEL-1233's rule that a valid breakpoint
merely missing panels is never written, by owner ruling `extend-owner-repair` (HEL-1260, 2026-10-05).

#### Scenario: Missing panels are not stored-bad
- **WHEN** a dashboard's stored `md` is valid but holds no item for one of its live panels
- **THEN** `md` is incomplete (repairable) and not stored-bad

#### Scenario: Overlap is stored-bad
- **WHEN** a dashboard's stored `xs` has two items sharing a grid cell
- **THEN** `xs` is stored-bad

#### Scenario: Complete valid breakpoint is not repairable
- **WHEN** a dashboard's stored `lg` is valid and holds an item for every live panel
- **THEN** `lg` is not repairable

### Requirement: The owner's client repairs stored-bad breakpoints once on open

When the signed-in user opens a dashboard they own, and that dashboard's panels have loaded, the web client SHALL send
the layout it displays (the render-time resolution) for every repairable breakpoint, and only those, to the repair
endpoint. It SHALL do so at most once per open. For an incomplete breakpoint, the displayed layout keeps every stored
item of a live panel exactly where it is stored and adds the missing live panels where they are displayed. This SHALL
happen at any viewport width; at phone width it SHALL be the only layout write (no layout PATCH, no unsaved-layout
state). A failed repair SHALL NOT be shown as an error to the user and SHALL NOT be retried during that open. The
resulting store update SHALL NOT add an undo/redo history entry, SHALL NOT set the unsaved-layout (dirty) indicator, and
SHALL NOT change the displayed position of any panel at a repaired breakpoint. If the user has already changed the
layout locally by the time the response arrives, the client SHALL keep the local layout. A user who does not own the
dashboard SHALL keep render-time placement only.

#### Scenario: Owner opens a stored-bad dashboard
- **WHEN** the owner opens a dashboard whose stored `xs` overlaps and whose other breakpoints are complete
- **THEN** exactly one repair request is sent carrying only `xs`, the stored `xs` becomes valid, no undo entry is added
  and the dirty indicator never appears

#### Scenario: Owner opens a dashboard with an orphaned panel
- **WHEN** the owner opens a dashboard whose stored breakpoints are all valid but hold no item for one live text panel
- **THEN** exactly one repair request is sent carrying every breakpoint missing that panel; afterwards every stored
  breakpoint holds the panel at the position that was displayed, every previously stored item is unchanged, no undo
  entry is added and the dirty indicator never appears

#### Scenario: Reopen writes nothing
- **WHEN** the owner opens the same dashboard again after the repair
- **THEN** no repair request and no layout write is sent

#### Scenario: Valid dashboard
- **WHEN** the owner opens a dashboard with no repairable breakpoint
- **THEN** no repair request is sent

#### Scenario: Non-owner client never sends a repair
- **WHEN** a user who does not own the dashboard views it (shared grantee or public/share-token viewer)
- **THEN** no repair request is sent and the stored layout is unchanged

### Requirement: The repair endpoint is owner-only, validated and idempotent

`POST /api/dashboards/:id/layout/repair` SHALL accept a subset of breakpoints. The server SHALL determine ownership
from the stored dashboard, not from the request. A caller with no access SHALL receive `404`. A caller who can see the
dashboard but does not own it (any grant role) SHALL receive `403`. Neither writes anything. For each supplied
breakpoint whose stored value is not repairable, the server SHALL ignore the supplied value.

Every remaining supplied breakpoint SHALL:
- be valid under the HEL-1071 validity contract;
- contain each panel id at most once;
- reference only panels of that dashboard;
- contain every panel of that dashboard that the stored breakpoint contains.

A supplied replacement for an incomplete (not stored-bad) breakpoint SHALL be append-only. Every stored item of a live
panel SHALL appear with identical `x`, `y`, `w` and `h`, and every added item SHALL be a live panel the stored
breakpoint lacked. Entries for deleted panels may be omitted. If any of these checks fails, the response SHALL be `400`
naming the breakpoint, and nothing SHALL be written.

When nothing remains to write, the server SHALL respond `200` with the stored dashboard and write nothing. A repair
SHALL write only the layout: it SHALL NOT change the dashboard's name, appearance or last-updated time, and SHALL leave
every breakpoint not written exactly as stored. If the stored layout changed between the server's read and its write,
the server SHALL respond `409` and write nothing.

#### Scenario: Grantee cannot repair
- **WHEN** a user holding an editor grant on the dashboard calls the repair endpoint with a valid replacement
- **THEN** the response is `403` and the stored layout is unchanged

#### Scenario: Owner repair under row-level security
- **WHEN** the owner calls the repair endpoint while the database enforces row-level security for the application role
- **THEN** the repaired breakpoint is stored

#### Scenario: Replacement that drops a live panel is rejected
- **WHEN** the stored `xs` holds panels A and B and the supplied `xs` holds only A
- **THEN** the response is `400` naming `xs` and nothing is stored

#### Scenario: Entries for deleted panels may be dropped
- **WHEN** the stored `xs` holds panel A and an entry for a deleted panel, and the supplied valid `xs` holds only A
- **THEN** the repair is stored

#### Scenario: A panel with no stored item may be added
- **WHEN** a dashboard panel has no item in the stored bad `xs` and the supplied valid `xs` places it
- **THEN** the repair is stored

#### Scenario: Orphan appended to an incomplete breakpoint
- **WHEN** the stored valid `lg` holds panel A and lacks live panel B, and the supplied valid `lg` holds A unchanged
  plus B
- **THEN** the repair is stored and A's stored item is unchanged

#### Scenario: Incomplete breakpoint repair that moves a stored item is rejected
- **WHEN** the stored valid `lg` holds panel A at `y = 0` and lacks live panel B, and the supplied `lg` adds B but
  moves A to `y = 4`
- **THEN** the response is `400` naming `lg` and nothing is stored

#### Scenario: Stored-bad rules win over append-only
- **WHEN** the stored `xs` overlaps and lacks live panel B, and the supplied valid `xs` moves the overlapping items and
  adds B
- **THEN** the repair is stored

#### Scenario: Concurrent layout change wins
- **WHEN** the stored layout changes after the repair request's read and before its write
- **THEN** the response is `409` and the concurrently stored layout is kept

#### Scenario: Concurrent rename survives
- **WHEN** the dashboard is renamed while a repair is in flight
- **THEN** after the repair the dashboard keeps the new name

#### Scenario: Second call is a no-op
- **WHEN** the same repair is sent twice
- **THEN** the second response is `200` and performs no write

### Requirement: The client's repaired layout passes the server validator

There SHALL be one shared fixture of repairable dashboards. It SHALL include a panel with no stored item in a stored-bad
breakpoint, an entry for a deleted panel, and an incomplete-but-valid breakpoint missing a live panel. For every case,
the breakpoints the web client sends SHALL equal the fixture's expected repair, and the server SHALL accept that
expected repair through the repair endpoint.

#### Scenario: Seam fixture agreement
- **WHEN** the client repair computation and the server repair endpoint are each run over every shared fixture case
- **THEN** the client output equals the fixture and the server stores it with `200`
