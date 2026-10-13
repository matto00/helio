## ADDED Requirements

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
