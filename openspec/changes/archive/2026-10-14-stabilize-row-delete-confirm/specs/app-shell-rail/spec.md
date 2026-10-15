## ADDED Requirements

### Requirement: The overview row Delete confirm stays put under a double-click and opens in view
Wherever the page can scroll enough to compensate, opening, re-rendering or switching the row Delete confirm on the
Data Pipelines and Data Sources overviews SHALL NOT move the activated row's Delete button under the pointer: both presses of a double-click SHALL land on the same
button, and exactly one confirm, naming that row, SHALL open, including on rows created moments earlier whose
relative-time labels are still in their first minute. Relative-time labels in these tables SHALL change only on a
shared periodic tick, never because of an unrelated re-render. A keyboard activation SHALL reveal the confirm
immediately; a pointer activation SHALL reveal it once the double-click window has passed. At phone widths every
reveal SHALL leave the confirm's bottom at or above the top of the floating BottomNav. Where the page cannot scroll far
enough to hold the row still (near the top, or a page that does not scroll), the confirm's Confirm and Cancel SHALL
ignore the second click of a double-click, so no press of a double-click on Delete can delete or cancel anything.

#### Scenario: Double-click on a freshly created row at 375px
- **WHEN** the user double-clicks the Delete of a source created seconds ago, at 375px, with the row near the
  viewport bottom
- **THEN** both presses land on that row's Delete, the row's top moves by less than 2px, and one confirm naming that
  row opens

#### Scenario: Keyboard reveal clears the BottomNav
- **WHEN** at 375px the user presses Enter on a Delete near the bottom of the visible area
- **THEN** the confirm is scrolled into view with its bottom at or above the BottomNav's top, and it holds focus

#### Scenario: Pointer reveal of a bottom row
- **WHEN** the user clicks the Delete of the last visible row whose confirm would open below the viewport
- **THEN** the row does not move during the double-click window, and afterwards the confirm is fully in view (above
  the BottomNav at phone widths)

#### Scenario: Switching the confirm to another row
- **WHEN** a confirm is open under one row, the page can scroll far enough to compensate for the closing confirm, and
  the user double-clicks the Delete of a row below it
- **THEN** both presses land on the second row's Delete and only its confirm is open

#### Scenario: Switching near the top of the page deletes nothing
- **WHEN** a confirm is open under row A, the page is scrolled to the top, and the user double-clicks the Delete of
  the row below A
- **THEN** no delete request is sent and exactly one confirm is open
