## ADDED Requirements

### Requirement: Add panel opens a searchable Output picker grouped by pipeline
"Add panel" on a dashboard MUST open a single modal that lists every Output the user can place, grouped by pipeline, with a search/type-ahead filter. Each Output card MUST show its kind, its name, and its current placement count, plus an "already on this board" state when it is already placed on the dashboard being edited. A content-panel row (text, markdown, image, divider) MUST be shown below the Output groups.

A live per-card thumbnail/value/sparkline (rendered from the last dry or live run) was scoped out for this cycle (HEL-909 evaluator cycle-1 finding 2; `tasks.md` 1.4 records it as deferred): with a dashboard's Output list realistically in the tens and the picker's placement-count fetch already an accepted N+1 that has produced live `429`s (see this delta's sibling `useOutputPickerData` note), fetching a live preview per card as well would multiply that load rather than merely add to it. A future cycle MAY add this once placement counts are served in bulk (a single list-response field) rather than N+1, at which point a per-card preview fetch would no longer be adding a second independent N+1.

#### Scenario: Picker groups Outputs by pipeline
- **WHEN** the Output picker opens with Outputs from more than one pipeline
- **THEN** the list is grouped under each pipeline's name, not a single flat list

#### Scenario: Already-placed Output is marked
- **WHEN** an Output already appears as a panel on the current dashboard
- **THEN** its card in the picker shows an "already on this board" indicator

#### Scenario: Search filters by name across groups
- **WHEN** the user types into the picker's search field
- **THEN** only Outputs (and pipelines with a matching Output) remain visible

### Requirement: Selecting an Output places it with the server-owned default size
Selecting an Output in the picker MUST call `POST /api/panels` with `{dashboardId, kind: "output", outputId, title?}` and **no** `layout`. The response's placed layout (server-computed per the kind's decision-15 default) is what the dashboard grid renders. The frontend MUST NOT compute or optimistically render a layout before the response arrives.

#### Scenario: Placing an Output uses the server's returned layout
- **WHEN** the user selects an Output in the picker
- **THEN** `POST /api/panels` is sent with no `layout` field
- **AND** the panel is rendered on the grid using the layout returned in the response

### Requirement: Picker is keyboard-operable
The picker MUST be fully operable by keyboard: arrow keys move focus through the grouped list, and Enter places the currently focused item. Every interactive element MUST have an accessible name per DESIGN.md §8.

#### Scenario: Arrow keys and Enter place an Output
- **WHEN** the user presses arrow keys to focus an Output card and then presses Enter
- **THEN** that Output is placed exactly as a click would place it

### Requirement: Picker offers an escape hatch when no Output fits
When no existing Output satisfies the user's need, the picker MUST offer links to start a new pipeline and to ask the assistant, rather than leaving the user with only a dead-end empty state.

#### Scenario: Empty search result still offers next steps
- **WHEN** a search in the picker matches no Output
- **THEN** the empty state shows links to "New pipeline" and "Ask the assistant"
