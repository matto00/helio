## MODIFIED Requirements

### Requirement: Drag-reorder operates within a lane
Drag-reorder and move up/down SHALL be available on the trunk lane of EVERY root (not only the first root),
SHALL reorder steps within the lane the moved step belongs to, and SHALL NOT move a step into a different
lane or root. Non-trunk (branch) lanes SHALL NOT offer reorder controls, because the reorder endpoint does
not permute them. Each Move up/down control SHALL have an accessible name that identifies its lane (the root's
source name for a root lane), SHALL be keyboard-operable, and keyboard focus SHALL remain on the moved step's
corresponding Move control after the reorder. A reorder SHALL persist across reload.

#### Scenario: Reordering inside the second lane
- **WHEN** the user drags the second step of lane 1 above the first step of lane 1
- **THEN** lane 1's step order changes and persists
- **THEN** no step in any other lane changes position or parent

#### Scenario: Reordering a non-first root's lane with the keyboard
- **WHEN** a pipeline has two roots and the user activates "Move step up" on the second step of root 2's lane
- **THEN** that step moves above the first step of root 2's lane, persists across a reload, and keyboard focus
  stays on that step's Move control
- **THEN** root 1's lane order and every step's owning root are unchanged

#### Scenario: Move controls name their lane
- **WHEN** a pipeline has two roots with lanes
- **THEN** each lane's Move controls have an accessible name that includes that root's source name

#### Scenario: Branch lanes offer no reorder controls
- **WHEN** a step has a branch (non-trunk) lane
- **THEN** that lane's step cards render no Move up/down buttons and no drag handle
