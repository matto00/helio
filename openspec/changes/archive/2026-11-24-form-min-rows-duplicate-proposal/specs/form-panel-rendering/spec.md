## MODIFIED Requirements

### Requirement: A form panel is sized for a grid cell

The form body SHALL fit the panel card: fields stack in one column, the body scrolls vertically inside the
card when the fields exceed its height rather than overflowing it, and density tightens in a short card.
An auto-layout re-flow SHALL clamp a `form` panel to a minimum of 3 columns wide and 5 rows tall.
On the desktop grid, at every breakpoint, a `form` panel SHALL NOT be resized to fewer than 5 rows, and every
placement the client and the backend make themselves (panel create, batch create, the client's unplaced-panel
fallback and auto-layout) SHALL place a `form` panel at 5 rows or more, except a form whose only field is a `counter`
control (the compact counter), which keeps the grid's general minimum of 4 rows. A panel duplicate SHALL take its
source's stored size, except that a duplicate of a `form` panel that is not a compact counter SHALL be at least 5 rows
tall in every breakpoint; the duplicate is appended below every stored item, so no other panel moves. When a
proposal is applied, or a dashboard's contents are replaced, an authored `lg` placement of a `form` panel that is not a
compact counter and is below 5 rows SHALL become 5 rows tall only if the space directly below it is free of the other
authored panels, otherwise it SHALL keep its authored height; no other panel SHALL move as a result, and a compact
counter SHALL keep its authored height. A layout supplied by a dashboard import, or copied by a dashboard duplicate,
SHALL keep the heights it carries. A form whose saved layout is already below 5 rows SHALL render at its saved height,
and loading it SHALL NOT change or save its layout. Such a form SHALL resize as any panel does; when the resize ends
below 5 rows, its height SHALL become 5 rows only if the space directly below it is free of other panels, otherwise it
SHALL keep the height the resize ended at. No other panel SHALL move as a result. At 5 rows a form with two
fields SHALL show its submit control without scrolling the form body.

#### Scenario: Overflowing fields scroll inside the card
- **WHEN** a form panel's fields are taller than its card
- **THEN** the body scrolls within the card and the card's own bounds are unchanged

#### Scenario: Auto-layout clamps an undersized form
- **WHEN** an auto-layout request includes a `form` panel with `w: 1, h: 2`
- **THEN** the packed item is at least `w: 3, h: 5`

#### Scenario: A form cannot be resized below 5 rows
- **WHEN** an editor drags a multi-field form panel's resize handle upward past 5 rows on the desktop grid
- **THEN** the panel stops at 5 rows

#### Scenario: A compact counter can still be resized to 4 rows
- **WHEN** an editor drags a compact counter form panel's resize handle upward past 4 rows
- **THEN** the panel stops at 4 rows

#### Scenario: A saved 4-row form is not bumped on load
- **WHEN** a dashboard whose saved layout holds a multi-field form at 4 rows is opened
- **THEN** the form renders at 4 rows and no layout change is saved

#### Scenario: A saved 4-row form with free space below grows on its next resize
- **WHEN** an editor widens a saved 4-row multi-field form whose space directly below is free
- **THEN** when the resize ends the form is 5 rows tall

#### Scenario: A saved 4-row form with a panel directly below stays at 4
- **WHEN** an editor widens a saved 4-row multi-field form that has another panel directly below it
- **THEN** the width change is applied, the form stays 4 rows tall, and the panel below does not move

#### Scenario: A two-field form at the minimum shows its submit control
- **WHEN** a two-field form panel is at 5 rows on a 1280 px wide desktop viewport, in either theme
- **THEN** its submit control is fully visible without scrolling the form body

#### Scenario: Duplicating a 4-row form gives 5 rows
- **WHEN** a multi-field form panel stored at 4 rows in every breakpoint is duplicated
- **THEN** the duplicate is 5 rows tall in every breakpoint and every other stored item is unchanged

#### Scenario: Duplicating a 4-row compact counter keeps 4 rows
- **WHEN** a compact counter form panel stored at 4 rows is duplicated
- **THEN** the duplicate is 4 rows tall

#### Scenario: A proposal placing a form at 4 rows with free space below gives 5 rows
- **WHEN** a proposal is applied whose authored `lg` placement puts a multi-field form at 4 rows with nothing directly below it
- **THEN** the created form is 5 rows tall in `lg` and no other created panel moves

#### Scenario: A proposal placing a form at 4 rows directly above another panel keeps 4 rows
- **WHEN** a proposal is applied whose authored `lg` placement puts a multi-field form at 4 rows with another authored panel directly below it
- **THEN** the created form stays 4 rows tall and the panel below keeps its authored placement

#### Scenario: Replacing contents with a form at 4 rows gives 5 rows
- **WHEN** a dashboard's contents are replaced with a multi-field form authored at 4 rows with nothing directly below it
- **THEN** the stored form is 5 rows tall in `lg`

#### Scenario: A proposal placing a compact counter at 4 rows keeps 4 rows
- **WHEN** a proposal is applied, or contents replaced, with a compact counter authored at 4 rows
- **THEN** the created counter is 4 rows tall

#### Scenario: Import and dashboard duplicate keep a saved 4-row form
- **WHEN** a dashboard whose layout holds a multi-field form at 4 rows is imported, or duplicated as a dashboard
- **THEN** the resulting form is 4 rows tall
