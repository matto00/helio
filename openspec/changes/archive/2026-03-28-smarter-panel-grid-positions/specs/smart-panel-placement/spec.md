## ADDED Requirements

### Requirement: New panels are placed in the first available horizontal slot
The layout system MUST compute the next available grid position for a new panel by scanning existing placed items left-to-right, row-by-row, for the first slot that fits the default panel dimensions without overlapping any occupied cell.

#### Scenario: First panel on an empty grid
- **WHEN** a fallback position is generated for a panel and no items are already placed
- **THEN** the panel is placed at x=0, y=0

#### Scenario: Second panel beside the first on a wide breakpoint
- **WHEN** a fallback position is generated for a second panel
- **AND** the first panel occupies x=0, y=0 with default width and height
- **AND** the grid has sufficient column width remaining in row 0
- **THEN** the second panel is placed adjacent to the first in the same row (x = first.x + first.w, y=0)

#### Scenario: Panel wraps to a new row when horizontal space is exhausted
- **WHEN** a fallback position is generated for a panel
- **AND** all column slots in existing rows are occupied or too narrow to fit the default panel width
- **THEN** the panel is placed at x=0, y = bottom of the lowest existing item

#### Scenario: Panel fills an interior gap left by a removed panel
- **WHEN** a fallback position is generated for a panel
- **AND** an earlier row has a gap wide enough to fit the default panel width
- **THEN** the panel is placed in that gap rather than appended at the bottom

### Requirement: Smart placement applies at all responsive breakpoints
The position-finding logic MUST operate independently for each breakpoint (lg, md, sm, xs) using that breakpoint's column count and default item width.

#### Scenario: Placement uses breakpoint-specific column counts
- **WHEN** fallback positions are generated for a set of panels
- **THEN** lg and md use a 4-column-wide default item on a 12 and 10 column grid respectively
- **AND** sm uses a 3-column-wide default item on a 6 column grid
- **AND** xs uses a 2-column-wide default item on a 2 column grid

### Requirement: Existing panel positions are not disturbed by new panel creation
The smart placement algorithm MUST only assign positions to panels that have no saved layout entry. Panels with existing saved positions MUST retain those positions unchanged.

#### Scenario: Existing panel keeps its saved position
- **WHEN** a dashboard layout is resolved after a new panel is added
- **AND** the existing panel has a saved layout entry
- **THEN** the existing panel retains its saved x, y, w, h values
- **AND** only the newly added panel receives a generated position
