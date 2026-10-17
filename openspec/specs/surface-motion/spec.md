# surface-motion Specification

## Purpose
Defines where the shared motion system is applied to product surfaces (panel grid, chart refresh, loading swaps, modals, the command palette, and save/run feedback) and how each surface behaves under the Full, Subtle and Off motion settings and OS reduced motion.

## Requirements

### Requirement: Surface motion follows the effective motion setting
Every surface motion in this capability SHALL take its timing and easing from the motion tokens only. Under Off, and
under OS reduced motion with no saved choice, none of them SHALL animate transform or position for longer than 0.01ms.
Under Subtle they SHALL animate opacity or colour only (no translate, scale or overshoot).

#### Scenario: Off suppresses movement on grid, modal and palette
- **WHEN** the Motion setting is Off and the user loads a dashboard, drags a panel, opens a panel's detail modal, and opens the command palette
- **THEN** no animation or transition on transform, translate, scale or position runs longer than 0.01ms on any of those surfaces

#### Scenario: OS reduced motion with no saved choice behaves as Off
- **WHEN** the operating system requests reduced motion and the user has never chosen a Motion setting
- **THEN** the same surfaces animate no transform or position

#### Scenario: Subtle keeps fades only
- **WHEN** the Motion setting is Subtle and the same surfaces are exercised
- **THEN** only opacity or colour animates; nothing translates, scales or overshoots

### Requirement: Panel grid motion
Under Full, a dashboard whose panels were loaded from the network SHALL bring its panel cards in with a staggered rise in
reading order, at most once per load of its panels from the network; a dashboard restored from the warm cache, or shown again without a new load, SHALL appear without an entrance. Resizing the window across the
mobile breakpoint SHALL not replay the entrance. A panel added while the
grid is shown SHALL rise in once. Dragging a panel SHALL lift its card (shadow and a slight scale) and dropping it SHALL
settle the card back with a small overshoot. Panels displaced by an add, remove, drag or resize SHALL slide to their new
positions.

#### Scenario: Cold dashboard load staggers
- **WHEN** a dashboard's panels arrive from a network fetch under Full
- **THEN** its cards rise in one after another in reading order, at most ten steps

#### Scenario: Warm restore is instant
- **WHEN** a dashboard's panels are restored from the warm cache, whether on a tab switch or on the first activation after a page reload
- **THEN** its cards appear without an entrance animation

#### Scenario: Returning to an already-loaded dashboard
- **WHEN** the user leaves a dashboard for another page (Home, Sources, Settings) and comes back, with no load of its panels since the user last saw that dashboard's grid (including a refetch that happened while the grid was on screen, such as after adding a panel)
- **THEN** its cards appear without an entrance animation

#### Scenario: Duplicated or imported dashboard
- **WHEN** the user duplicates or imports a dashboard and it is shown for the first time
- **THEN** its cards rise in with the staggered entrance

#### Scenario: Drag lift and settle
- **WHEN** the user drags a panel in layout edit mode under Full and drops it
- **THEN** the card is raised with a shadow and slight scale while dragging, and on drop it settles back to its resting size with a small overshoot while it moves into its cell

### Requirement: Loading crossfades in place
The dashboard's skeleton grid SHALL fade out in place as the real grid appears, and the route-level loading fallback
SHALL fade into the loaded route, without the page collapsing between the two. The outgoing placeholder SHALL not be
announced to assistive technology once loading has ended.

#### Scenario: Lazy route crossfade
- **WHEN** a lazily loaded route finishes loading under Full or Subtle
- **THEN** the loading fallback fades out while the route fades in, in the same place, at the full width of the page

#### Scenario: Route already loaded
- **WHEN** a lazily loaded route's code is already available, so it renders before the fallback paints
- **THEN** the route appears with no fade

### Requirement: Chart data refresh morphs
A chart panel whose data refreshes without a change of chart type, axes or components SHALL update its existing series in
place, animating the change under Full. Any change of shape SHALL fully replace the chart.

#### Scenario: Same-shape refresh
- **WHEN** a line chart panel receives new rows of the same shape under Full
- **THEN** the line animates to its new shape instead of redrawing from empty

#### Scenario: Chart type change
- **WHEN** a chart panel's type changes between cartesian and pie
- **THEN** the chart is fully replaced, with no leftover axes or series

### Requirement: Modal entrance is one gesture
Every modal's backdrop SHALL fade in together with its dialog's entrance. A panel's detail modal opened from its card
SHALL, under Full, grow out of that card's position and size; under Subtle it SHALL fade in place.

#### Scenario: Backdrop fades with the dialog
- **WHEN** any modal opens under Full or Subtle
- **THEN** its backdrop fades in over the quick duration while the dialog enters, rather than appearing at full strength on the first frame

#### Scenario: Detail modal grows from the card
- **WHEN** the user clicks a panel card under Full
- **THEN** the detail modal starts at the card's position and scale and grows into its final place, ending with no residual transform

### Requirement: Command palette entrance
The command palette SHALL, under Full, drop in from slightly above with a gentle overshoot as its backdrop fades, and its
results SHALL rise in staggered on each open. Results that change while typing SHALL appear without a rise.

#### Scenario: Palette open
- **WHEN** the user opens the command palette under Full
- **THEN** the panel drops about 6px into place with a slight overshoot and the visible results rise in one after another

### Requirement: Save and run feedback
When a save of the dashboard's layout or panels succeeds while its save state is on screen, a small check SHALL appear beside it
(popping in under Full, fading under Subtle, static under Off). A run mark on the Home run timeline that turns failed
while on screen SHALL nudge once; a mark that was already failed when shown SHALL not.

#### Scenario: Layout save confirmation
- **WHEN** the user's pending layout change finishes saving
- **THEN** a check appears beside the save state and stays until the next unsaved change

#### Scenario: Undo to the saved layout is not a save
- **WHEN** the user undoes back to the saved layout, so nothing remains unsaved but no save happened
- **THEN** no check appears

#### Scenario: Failed run nudge
- **WHEN** a run on the Home timeline changes from running to failed while visible under Full
- **THEN** its status mark nudges side to side once
