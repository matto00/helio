# mobile-dashboard-sheet Specification

## Purpose
Provides a tappable command-bar title and a top-anchored sheet picker so phone-width viewers can
switch dashboards, sources, pipelines, and registry items — the item-level navigation the collapsed
sidebar used to carry — without forking state or introducing a second overlay mechanism. The sheet
descends from the command bar that triggers it and carries a section-appropriate create action, so
no section is a dead end on phone.
## Requirements
### Requirement: Tappable command-bar title on phone
Below the 768px breakpoint the command bar SHALL render a tappable title control showing the current
dashboard name on `/` (and the current section/item name on `/sources`, `/pipelines`, `/registry`) with a
small chevron glyph so it visibly reads as a control. At 768px and wider the desktop breadcrumb markup and
behavior SHALL be unchanged. The control SHALL open the top-anchored navigation sheet, and SHALL close it
again when tapped while the sheet is open. Its chevron glyph SHALL indicate the sheet's open/closed state.

#### Scenario: Title visible and tappable on phone
- **WHEN** a dashboard is selected and the viewport is narrower than 768px
- **THEN** the command bar shows the dashboard name with a chevron, and tapping it opens the top-anchored
  navigation sheet

#### Scenario: The chevron reflects sheet state
- **WHEN** the sheet is open
- **THEN** the trigger's chevron indicates the open state rather than continuing to point toward an
  unopened sheet

#### Scenario: Desktop unchanged
- **WHEN** the viewport is 768px or wider
- **THEN** the phone title control is not rendered and the existing breadcrumb appears as before

### Requirement: Sheet dismissal and surface compliance
The sheet SHALL be an opaque `--app-surface-strong` surface rendered through the existing overlay
infrastructure (portal + `useOverlay` registration, following the `Modal`/`Popover` patterns — no third
overlay mechanism). It SHALL dismiss on backdrop tap, on a drag toward its anchored edge (upward, past the
dismiss threshold), and on Escape, with a single entrance animation that respects `prefers-reduced-motion`.
The drag affordance SHALL be presented at the sheet's free edge — the bottom edge — rather than at the
pinned top edge, and its pointer-tracked region SHALL be at least 44px in its drag dimension. Focus SHALL be
trapped while the sheet is open and restored to the control that opened it on close.

#### Scenario: Backdrop dismisses
- **WHEN** the sheet is open and the user taps the backdrop
- **THEN** the sheet dismisses without changing the selection

#### Scenario: Swipe-up dismisses
- **WHEN** the user drags the sheet upward past the dismiss threshold
- **THEN** the sheet dismisses without changing the selection

#### Scenario: The drag strip remains a usable target
- **WHEN** the sheet is open at a 430px-wide viewport
- **THEN** the computed height of the pointer-tracked drag strip is at least 44px

#### Scenario: The sheet clears the floating bottom nav
- **WHEN** the sheet is open with a full list at a 430px-wide viewport
- **THEN** the drag strip's bottom edge sits above the floating bottom nav's top edge, so the sheet neither
  overlaps the capsule nor places its upward dismissal gesture in the home-indicator band

#### Scenario: Reduced motion disables the entrance
- **WHEN** `prefers-reduced-motion: reduce` is emulated on the running application and the sheet opens
- **THEN** the computed animation-name is `none` for both the sheet panel and its clipping element — the
  sheet appears in its final position rather than playing a shortened animation

#### Scenario: Initial focus lands on the list, not the create action
- **WHEN** the sheet opens
- **THEN** focus moves to the active item, or the first item when none is active — never to the create
  action, so that confirming immediately switches rather than creates

#### Scenario: Focus returns to the trigger
- **WHEN** the sheet is dismissed by any means
- **THEN** focus is restored to the command-bar control that opened it

### Requirement: Same sheet mechanism for section item navigation
The frontend SHALL reuse the same title control and sheet component on `/sources`, `/pipelines`, and
`/registry` at phone width to list that section's items (the data `SidebarItemList` renders), navigating on
tap and exposing no editing affordances beyond the section's create action. The frontend MUST NOT introduce
a second overlay/list mechanism for this. When a section has no items, the sheet SHALL render the shared
`EmptyState` primitive rather than a bare paragraph, carrying that section's create action as its
call-to-action where one exists. The empty-state icon, title and description SHALL come from a single shared per-section
table consumed by the sheet, and a test SHALL lock that table against the desktop sidebar's rendered copy
for the sections the sidebar owns, so the two cannot drift.

#### Scenario: Pick a pipeline on phone
- **WHEN** the user is on `/pipelines` at phone width and opens the sheet
- **THEN** the pipelines list appears, tapping one navigates to/selects it, and the sheet dismisses

#### Scenario: Empty section offers a way forward
- **WHEN** a section with a create action has no items and the user opens the sheet
- **THEN** the shared `EmptyState` primitive is rendered with that section's create action as its CTA, and
  the sheet can be dismissed normally

#### Scenario: Empty section without a create action is still not a dead end
- **WHEN** a section with no create action has no items and the user opens the sheet
- **THEN** the shared `EmptyState` primitive is rendered with its message and no CTA, and the sheet can be
  dismissed normally

#### Scenario: Phone and desktop empty states agree
- **WHEN** the same section is empty on the phone sheet and in the desktop sidebar, for a section whose
  sidebar empty state is owned by the shared sidebar body
- **THEN** both render the same empty-state icon, title and description

### Requirement: Sheet rows meet the 44px touch-target minimum
Every tappable element in the sheet SHALL have a rendered height of at least 44 CSS px at phone width —
dashboard rows, section-item rows, the section create action, and the drag strip alike — following the
codebase's established 44px tap-target convention. The minimum SHALL be enforced in CSS and locked by a
static CSS regression test, and SHALL additionally be verified by computed-style measurement on the running
application at 430px and 768px, because a rule that reads correctly can still compute to less.

#### Scenario: Dashboard rows measure at least 44px
- **WHEN** the dashboard picker sheet is open at a 390px-wide viewport
- **THEN** every dashboard row's bounding-client-rect height is at least 44px

#### Scenario: Section item rows measure at least 44px
- **WHEN** the sheet is open on `/sources`, `/pipelines`, or `/registry` at a 390px-wide viewport
- **THEN** every item row's bounding-client-rect height is at least 44px

#### Scenario: Computed measurement confirms the floor
- **WHEN** the sheet is open at 430px and at 768px on the running application
- **THEN** the computed height of every row, of the header create action, of the empty-branch call-to-action
  element, and of the drag strip is at least 44px

#### Scenario: CSS lock guards the minimum
- **WHEN** the sheet-row rule in `MobileNavSheet.css` loses its at-least-44px minimum
- **THEN** a static CSS regression test fails

### Requirement: Sheet is anchored to the top-chrome seam and descends from its trigger
The phone navigation sheet SHALL be anchored to the top edge of the content area, positioned from the
shared `--app-top-chrome-height` seam declared in `theme.css`, so that its top edge coincides with the
bottom edge of the command bar carrying the control that opens it. The sheet MUST NOT re-derive
`env(safe-area-inset-top)` itself, and its **top anchor** MUST NOT be derived from `--bottom-nav-height` or
any other bottom-nav token. Its **bottom extent** SHALL clear the floating bottom nav and the bottom
safe-area inset, for which those tokens are the correct input. The entrance animation SHALL originate at that top
edge, and the control that opened the sheet SHALL remain visible and un-occluded for the entire entrance.

#### Scenario: Sheet top edge tracks the claimed safe-area inset
- **WHEN** the sheet is open at phone width and the claimed top inset is 0px, 47px, or 59px
- **THEN** the sheet's measured bounding-client-rect top coincides with the command bar's measured bottom
  edge in each case, the three measured values differ from one another, and no sheet row is occluded by the
  status-bar region

#### Scenario: The command bar is not covered or dimmed by the sheet
- **WHEN** the sheet is open or opening
- **THEN** the backdrop's top edge starts at the top-chrome seam, so the command bar is neither dimmed by
  the scrim nor overlapped by the panel at any frame, and the control that opened the sheet remains
  hit-testable

#### Scenario: The trigger toggles the sheet closed
- **WHEN** the sheet is open and the user taps the control that opened it
- **THEN** the sheet dismisses, preserving the behaviour today's full-viewport backdrop provides

#### Scenario: Nothing else outside the sheet is reachable while it is open
- **WHEN** the sheet is open
- **THEN** the command bar's other controls are inert, and focus remains trapped within the sheet

#### Scenario: The sheet is never painted over by its own backdrop
- **WHEN** the sheet is open
- **THEN** the sheet's panel is rendered above its own backdrop, notwithstanding any stacking context
  introduced by the clipping element used to constrain the entrance

#### Scenario: No independent inset derivation
- **WHEN** the sheet's stylesheet is inspected
- **THEN** it contains no `env(safe-area-inset-top)` occurrence, and no bottom-nav token appears in its top
  anchor

### Requirement: Top-anchored item picker
Tapping the title on `/` SHALL open the navigation sheet listing all dashboards, sourced from the existing
`state.dashboards` selectors used by `DashboardList` (no forked state). Tapping an entry SHALL select that
dashboard via the same selection action `DashboardList` dispatches, and dismiss the sheet. The current
dashboard SHALL be visually indicated. The sheet SHALL contain no rename, delete, duplicate, import, export,
or actions-menu affordance. It SHALL expose at most one create affordance, as specified by
"Section-appropriate create action in the sheet".

#### Scenario: Switch dashboard from the sheet
- **WHEN** the user opens the sheet and taps a dashboard other than the current one
- **THEN** that dashboard becomes selected, its panels load, and the sheet dismisses

#### Scenario: Create is the only mutation affordance
- **WHEN** the sheet is open
- **THEN** no rename, delete, duplicate, import, export, or actions-menu affordance is present

### Requirement: Section-appropriate create action in the sheet
The sheet SHALL offer a create action appropriate to the current section — create a dashboard on the
dashboards picker, add a source on sources, create a pipeline on pipelines — performing the operation exposed
by that section's shared create-action hook, and labelled and glyphed from that hook rather than from strings
authored here. The action SHALL be rendered as a distinct action rather than as a row of the item list, and
SHALL meet the 44px tap-target floor at phone width. Exactly one create affordance SHALL be visible at a
time: when the empty branch renders, its `EmptyState` call-to-action is that affordance and the header action
SHALL be suppressed. The type registry, whose items are produced by pipelines, SHALL offer the create-pipeline
action in its empty branch only — matching the desktop sidebar, which gives that section a call-to-action but
no header control — so the section is never a dead end on phone. Metrics and assistant, which have no shared
create-action hook, SHALL offer no create action rather than a fabricated one.

#### Scenario: Create action runs the shared hook's flow
- **WHEN** the user opens the sheet on a section with a create action and taps it
- **THEN** the flow exposed by that section's shared create-action hook runs — for sources and pipelines
  that is the same modal the desktop control opens; for dashboards it is the hook's immediate
  quick-create, which is deliberately distinct from the sidebar's named-create form

#### Scenario: Action label and glyph come from the hook
- **WHEN** a create action is rendered in the sheet
- **THEN** its label and icon are the hook's own `cta.label` and `cta.icon`, identical to the strings and
  glyph the desktop surfaces render for the same action

#### Scenario: Never two create affordances at once
- **WHEN** the sheet is open on a section that has a create action, whether or not that section has items
- **THEN** exactly one create affordance is present in the sheet

#### Scenario: Create action meets the tap-target floor
- **WHEN** the sheet is open at a 430px-wide viewport
- **THEN** the create action's computed tap dimension is at least 44px

#### Scenario: The registry offers a create action only when empty
- **WHEN** the sheet is open on the type registry section
- **THEN** no header create action is rendered, and when the section has no items the empty branch offers the
  create-pipeline action, matching the desktop sidebar

#### Scenario: Sections without a hook offer no create action
- **WHEN** the sheet is open on the metrics or assistant section
- **THEN** no create action is rendered

#### Scenario: A failed create is visible and human-readable
- **WHEN** a create action fails while the sheet is open
- **THEN** the failure is surfaced in the sheet with error intent — as an error-intent `EmptyState` when the
  empty branch is showing, mirroring the treatment the same action already uses elsewhere, and as the shared
  inline-error primitive beside the header action when the list is showing

#### Scenario: A pending create is not disabled
- **WHEN** a create action is in flight
- **THEN** its label reflects the pending state and the control remains enabled, preserving the existing
  behaviour of the shared hook

#### Scenario: The sheet does not dismiss out from under a create that can fail
- **WHEN** a create action that can report failure is fired from the sheet
- **THEN** the sheet remains open until that create succeeds, dismissing on success and staying open on
  failure so the failure is presented; actions that cannot fail dismiss the sheet immediately, so their modal
  never opens behind it

#### Scenario: A stale failure does not resurface
- **WHEN** a create failed previously and the user opens the sheet again
- **THEN** no stale error from the earlier attempt is shown

