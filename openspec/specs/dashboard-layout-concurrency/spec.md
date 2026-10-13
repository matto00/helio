# dashboard-layout-concurrency Specification

## Purpose
Keeps concurrent dashboard layout writers (browser tabs, agents, auto-layout, panel creation) from silently losing
each other's placements, and keeps layout saves from reverting a concurrent rename or appearance change.

## Requirements

### Requirement: Dashboards expose a layout version
Every dashboard SHALL carry a non-negative integer `layoutVersion`, returned on every authenticated dashboard response.
The server SHALL increase it whenever the stored layout changes, regardless of which operation changed it (layout
PATCH, auto-layout, panel create, duplicate or delete, contents replace, layout repair, patch-set apply or undo). A
write that leaves the stored layout unchanged SHALL NOT change it. Clients SHALL NOT be able to set it directly.

#### Scenario: Panel create bumps the version
- **WHEN** a panel is created on a dashboard whose `layoutVersion` is N
- **THEN** the dashboard's `layoutVersion` is greater than N afterwards

#### Scenario: Rename does not bump the version
- **WHEN** a dashboard is renamed without a layout change
- **THEN** its `layoutVersion` is unchanged

### Requirement: Layout PATCH honours an expected layout version
`PATCH /api/dashboards/:id` and `PATCH /api/dashboards/:id/update` SHALL accept an optional integer
`expectedLayoutVersion` alongside `layout`. When it is supplied and differs from the stored `layoutVersion` at write
time, the request SHALL return 409 with the current dashboard in the body and SHALL write nothing, including any name or appearance in the same request.
Supplying `expectedLayoutVersion` without `layout` SHALL return 400. A request without `expectedLayoutVersion` SHALL
still succeed when no conflicting layout write lands during its own read-and-write.

#### Scenario: Stale tab save after a concurrent panel create
- **WHEN** a client read layout version N, a panel is then created on the dashboard, and the client PATCHes a layout
  with `expectedLayoutVersion` N that omits the new panel
- **THEN** the response is 409, and the stored layout still contains the new panel's item in every breakpoint and
  every other stored item unchanged

#### Scenario: Stale save racing an in-flight placement
- **WHEN** a layout PATCH with `expectedLayoutVersion` N runs while a concurrent transaction holding the dashboard row
  commits a layout change
- **THEN** the PATCH returns 409 and the concurrent transaction's layout is what is stored

#### Scenario: Matching version saves
- **WHEN** a client PATCHes a valid layout that differs from the stored one, with `expectedLayoutVersion` equal to the
  stored version
- **THEN** the layout is saved and the response carries a greater `layoutVersion`

### Requirement: Layout writes do not rewrite name or appearance
A dashboard write SHALL store only the fields its request supplied (plus `last_updated`); a layout-only write SHALL
NOT write name or appearance, and an auto-layout SHALL write only the layout and `last_updated`.

#### Scenario: Concurrent rename survives a layout save
- **WHEN** a rename commits after a layout PATCH read the dashboard but before the PATCH wrote it
- **THEN** after both complete the dashboard has the new name and the PATCH's layout

### Requirement: Auto-layout is compare-and-set
`POST /api/dashboards/:id/auto-layout` SHALL write its packed layout only if the stored layout is still the one it
packed from, and SHALL accept an optional `expectedLayoutVersion` with the same 409 semantics as the layout PATCH.
Without a caller precondition, a conflicting write during the auto-layout SHALL cause a bounded re-read and retry,
then 409; it SHALL never overwrite a layout it did not read.

#### Scenario: Auto-layout racing a panel create keeps the panel
- **WHEN** a panel is created between auto-layout's read and its write
- **THEN** either the auto-layout is recomputed against the new layout or it returns 409, and the new panel's items
  are present afterwards

### Requirement: Web client resolves a layout conflict
The web client SHALL send `expectedLayoutVersion` with every layout save, and that version SHALL be the version of the
server layout the saved local layout was derived from, never a newer one. On a 409 it SHALL refetch the dashboard and reapply the user's changed panel items
onto the fresh layout, keeping every other item from the fresh layout, and retry once with the fresh version. If the
reapplied layout is invalid or the retry conflicts again, it SHALL show the fresh server layout and tell the user their
last layout change was not saved. A conflict resolved by the reapply-and-retry is not a rejected save and shows no
error. An edit made while a conflict is being resolved SHALL NOT be saved under a version that includes another
writer's items it lacks.

#### Scenario: Edit during conflict resolution
- **WHEN** the user drags again while a 409 reapply-and-retry is in flight, and the retry succeeds
- **THEN** the next save either conflicts and reapplies again or sends a layout containing the other writer's items;
  the other writer's items are never dropped

#### Scenario: Drag after a concurrent agent placement
- **WHEN** an agent creates a panel while the user has an unsaved drag in an open tab, and the tab saves
- **THEN** both the agent's panel and the user's dragged position are stored, with no user-visible error

### Requirement: Placement responses carry the new layout version
`POST /api/panels`, `POST /api/panels/:id/duplicate` and `POST /api/panels/batch` SHALL return the dashboard's
`layoutVersion` as stored by the same transaction that appended the placed items, alongside those items. For the
single create and the duplicate it SHALL be a top-level `layoutVersion` on the panel response; for the batch it SHALL
be one top-level `layoutVersion` on the batch response, present whenever at least one panel was created. The value
SHALL equal the `layoutVersion` a subsequent authenticated dashboard read returns, unless another layout write
happened after the placement.

#### Scenario: Create returns the bumped version
- **WHEN** a panel is created on a dashboard whose `layoutVersion` is N and no other layout write happens concurrently
- **THEN** the create response carries `layoutVersion` N+1, and a dashboard read afterwards returns N+1

#### Scenario: Duplicate returns the bumped version
- **WHEN** a panel is duplicated on a dashboard whose `layoutVersion` is N and no other layout write happens concurrently
- **THEN** the duplicate response carries `layoutVersion` N+1

#### Scenario: Batch returns one version for the whole batch
- **WHEN** three panels are batch-created on a dashboard whose `layoutVersion` is N
- **THEN** the batch response carries a single top-level `layoutVersion` N+1

#### Scenario: A concurrent layout write before the create is reflected
- **WHEN** another writer changes the layout of a dashboard at version N, and a panel is then created on it
- **THEN** the create response carries `layoutVersion` N+2

### Requirement: Web client adopts a placement version only when consecutive
After its own panel create or duplicate, the web client SHALL advance the layout version its next save sends as
`expectedLayoutVersion` to the response's `layoutVersion` only when that value is exactly one more than the version
the client's saved-layout baseline was derived from, and the placed items were appended to that baseline. In every
other case it SHALL keep the previous version, so invariant I1 (the version sent is never newer than the server layout
the saved local layout was derived from) holds and a concurrent writer's change still produces a 409.

#### Scenario: Create then drag saves once
- **WHEN** the user creates a panel in a tab whose baseline is at version N, the response carries N+1, and the user
  then drags a panel and the layout is saved
- **THEN** the save sends `expectedLayoutVersion` N+1 and succeeds with a single 200, with no 409 and no rebase

#### Scenario: Concurrent writer races the create
- **WHEN** another writer changes the layout after the tab's baseline version N and before the tab's create, so the
  create response carries N+2, and the user then drags and saves
- **THEN** the save sends `expectedLayoutVersion` N (not N+2), receives a 409, and the rebase keeps the other writer's
  items
