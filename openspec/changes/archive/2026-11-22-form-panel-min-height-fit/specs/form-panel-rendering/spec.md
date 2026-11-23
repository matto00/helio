## MODIFIED Requirements

### Requirement: A form panel is sized for a grid cell

The form body SHALL fit the panel card: fields stack in one column, the body scrolls vertically inside the
card when the fields exceed its height rather than overflowing it, and density tightens in a short card.
An auto-layout re-flow SHALL clamp a `form` panel to a minimum of 3 columns wide and 5 rows tall.
On the desktop grid, at every breakpoint, a `form` panel SHALL NOT be resized to fewer than 5 rows, and every
placement the client and the backend make themselves (panel create, batch create, the client's unplaced-panel
fallback and auto-layout) SHALL place a `form` panel at 5 rows or more, except a form whose only field is a `counter`
control (the compact counter), which keeps the grid's general minimum of 4 rows. A duplicate takes its source's stored
size, so duplicating a form saved below 5 rows yields a form of that height; a layout supplied by a dashboard import or
by an applied proposal keeps the heights it carries. A form whose saved layout is already below 5 rows SHALL render at its saved height, and loading it SHALL NOT
change or save its layout. Such a form SHALL resize as any panel does; when the resize ends below 5 rows, its height
SHALL become 5 rows only if the space directly below it is free of other panels, otherwise it SHALL keep the height
the resize ended at. No other panel SHALL move as a result. At 5 rows a form with two
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
