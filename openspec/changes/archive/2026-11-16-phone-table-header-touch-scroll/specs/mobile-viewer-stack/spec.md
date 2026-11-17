## ADDED Requirements

### Requirement: Table headers never block a vertical page pan on the phone stack

On the phone dashboard stack, a vertical touch drag that starts anywhere on a Table panel's header row, including on a column-resize handle, SHALL be handled by native scrolling: it SHALL scroll the page whenever the Table's own body cannot scroll further in that direction. No element of the Table header SHALL restrict vertical panning. Column resize by mouse drag and by keyboard SHALL keep working at desktop widths.

When a Table's body overflows its phone-stack cap, the Table's own grid scroller (which also contains the sticky header) is the Table panel's only overflowing vertical scroller, so a header drag starts inside it; the "whenever the Table's own body cannot scroll further" clause above covers that case. That scroller SHALL follow standard nested-scroll behaviour: a vertical drag inside it scrolls the body until the body reaches its bound in that direction, and a drag that starts with the body already at that bound scrolls the page.

#### Scenario: Vertical drag from a resize handle scrolls the page at 375 and 430

- **WHEN** a phone dashboard (375x812 or 430x932, touch input) shows a Table panel whose body does not overflow vertically, and the user drags vertically starting on a column-resize handle in its header
- **THEN** the page scrolls in the drag's direction, and no pull-to-refresh engages while the page is scrolled away from the top

#### Scenario: Vertical drag from header text scrolls the page

- **WHEN** the same drag starts on a Table header cell's text rather than its resize handle
- **THEN** the page scrolls in the drag's direction

#### Scenario: Capped body chains to the page at its bound

- **WHEN** a Table panel's body is capped and scrollable on the phone stack, its body is scrolled to the top, the page is scrolled away from the top, and the user drags downward starting inside the body
- **THEN** the page scrolls up (content moves down) rather than the gesture being swallowed

#### Scenario: Desktop column resize still works

- **WHEN** at a desktop width a user mouse-drags a Table column-resize handle horizontally
- **THEN** that column's width changes by the drag distance (subject to the minimum width)
