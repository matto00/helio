# app-shell-rail Specification

## Purpose
The desktop and tablet app shell: a 56px icon rail that keeps every section one click away, and a resizable,
collapsible context list beside it whose content depends on the current section (DESIGN.md §9).

## Requirements

### Requirement: Icon rail is always visible above the 768 breakpoint
At viewport widths above 768px (the phone layout applies under the existing `max-width: 768px` query, so 768px itself
stays a phone layout, as every page stylesheet already treats it) the shell SHALL render a 56px icon rail containing, in order, Home,
Dashboards, Data Sources, Data Pipelines, Connectors and Assistant, with Settings and the user's avatar menu at its
foot. Every rail item SHALL be a link or button with an accessible name and a `title` tooltip. The rail SHALL remain
rendered and operable when the context list is collapsed. At 768px and below the rail SHALL NOT render.

#### Scenario: Every section is one click away with the list collapsed
- **WHEN** the context list is collapsed at a 1280px or an 820px viewport
- **THEN** each of Home, Dashboards, Data Sources, Data Pipelines, Connectors, Assistant and Settings is a single
  visible rail control that navigates to its route on one click

#### Scenario: Rail is absent on phones
- **WHEN** the viewport is 390px or 768px wide
- **THEN** no rail renders and the glass bottom nav renders, with Home added as its first tab (see `nav-section-registry`)

### Requirement: The active rail item is marked with the accent and aria-current
The rail item for the current section SHALL carry `aria-current="page"` and SHALL be the only rail item painted with
the accent (`--app-accent-dim` wash, `--app-accent` icon). On `/home` that item SHALL be Home; on `/dashboards` and
`/dashboards/:id` it SHALL be Dashboards. The indicator SHALL be static (no slide) until the motion foundation ships.

#### Scenario: Exactly one active item on a dashboard
- **WHEN** the user is on `/dashboards`
- **THEN** exactly one rail item has `aria-current="page"` and it is Dashboards

#### Scenario: Exactly one active item on Home
- **WHEN** the user is on `/home`
- **THEN** exactly one rail item has `aria-current="page"` and it is Home

### Requirement: Context list resizes by pointer and keyboard within clamps
The context list SHALL have a focusable separator (`role="separator"`, `aria-orientation="vertical"`,
`aria-valuemin=200`, `aria-valuemax=400`, `aria-valuenow` = current width, an accessible name). Dragging the separator
SHALL resize the list; Arrow Left/Right SHALL change the width in steps; Home/End SHALL jump to the minimum/maximum.
The width SHALL always be clamped to 200..400px, and SHALL default to 248px.

#### Scenario: Keyboard resize clamps at the maximum
- **WHEN** the separator is focused and Arrow Right is pressed repeatedly
- **THEN** the list widens and `aria-valuenow` stops at 400

#### Scenario: Pointer drag clamps at the minimum
- **WHEN** the separator is dragged 500px to the left
- **THEN** the list width is 200px

### Requirement: Context list collapses to rail-only and state persists per user
The context list SHALL collapse to rail-only via a labelled button, by double-clicking the separator, and by Enter on
the focused separator; a rail control SHALL re-expand it. The width and collapsed state SHALL persist server-side per
user (see `user-ui-preferences`) and SHALL be applied on the first paint of the authenticated shell, with no visible
jump from a default width or state. A pointer drag SHALL issue at most one preference write, at drag end; keyboard
resizing SHALL be debounced so a burst of key presses issues one write.

#### Scenario: State survives a reload and follows the user to another browser
- **WHEN** the user resizes the list to 320px, collapses it, then signs in on a different browser
- **THEN** the list renders collapsed on first paint, and on expanding it is 320px wide

#### Scenario: A drag writes once
- **WHEN** the user drags the separator across 200px in one gesture
- **THEN** exactly one preference write is sent, after the pointer is released

#### Scenario: Another user on the same browser gets their own state
- **WHEN** a different user, who has never resized the list, signs in on the same browser
- **THEN** the list renders expanded at 248px

### Requirement: Context list content follows the section
The context list SHALL show: on dashboard routes, the dashboard filter and folders (see `dashboard-folders`); on
Data Pipelines routes, a Recent group and a Scheduled group of scheduled pipelines with their next run; on Data
Sources routes, a Recent group and a Scheduled group of sources that feed a scheduled pipeline, each with the soonest
next run among those pipelines (both from one `GET /api/pipeline-schedules` request, see
`pipeline-schedule-list-api`); on Assistant routes, the existing conversation list; on Home, Connectors, Settings and
review routes, no context list (rail only, without changing the saved collapsed state). Recent groups SHALL come from
the existing recent-visits history, show at most 8 items, and offer a "View all" link to the section overview and the
section's add action. The Sources and Pipelines lists SHALL NOT list every item of the section.

#### Scenario: Pipelines list no longer duplicates the table
- **WHEN** a user with 30 pipelines, 2 of them recently visited, opens `/pipelines`
- **THEN** the context list shows those 2 under Recent and no list of all 30 pipelines

#### Scenario: Scheduled pipelines show their next run
- **WHEN** the user owns a pipeline with an enabled schedule whose next run is 14:00
- **THEN** the Pipelines context list shows it under Scheduled with its next run time in mono type

#### Scenario: Sources show the soonest scheduled run
- **WHEN** a source feeds two of the user's scheduled pipelines, next running at 14:00 and 09:00
- **THEN** the Sources context list shows that source once under Scheduled with 09:00 and the pipeline running then

#### Scenario: Home has no context list
- **WHEN** the user opens `/home` with the context list expanded
- **THEN** no context list renders, and returning to `/dashboards` shows it expanded again

### Requirement: Delete lives on the overview rows
Pipelines and sources SHALL stay deletable after the full lists leave the sidebar: the Data Pipelines and Data Sources
overview tables SHALL offer Delete as a row action on every row, and the detail pages SHALL NOT offer it (owner
ruling 2026-10-14). The action SHALL be reachable by keyboard and named with the item (for example "Delete Sales
Pipeline"), and SHALL sit behind the same confirmation the sidebar rows had. A pipeline delete SHALL warn that panels
bound to its Outputs will stop working. A source delete SHALL show the server's reference warning and, on a refused
delete, the conflict notice. A successful delete SHALL leave the user on the overview with the row gone; a refused one
SHALL leave the row in place and say why.

#### Scenario: Delete a pipeline from the overview
- **WHEN** the user opens `/pipelines`, chooses Delete on a row and confirms
- **THEN** the pipeline is deleted, the row disappears and the browser stays on `/pipelines`

#### Scenario: Refused source delete shows the conflict notice
- **WHEN** the user deletes a source still referenced by a pipeline from `/sources` and the server answers 409
- **THEN** the conflict notice renders on the overview and the source row remains

#### Scenario: Detail pages offer no Delete
- **WHEN** the user opens `/pipelines/:id` or `/sources/:id`
- **THEN** the header actions contain no Delete item

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
