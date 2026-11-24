## ADDED Requirements

### Requirement: Loading a dashboard renders its grid without a render loop
A full page load of a dashboard at any grid breakpoint (container width >= 768px) SHALL render the panel grid
without a React render loop: the browser console MUST NOT receive a "Maximum update depth exceeded" error during the
load, for any valid stored layout, including one whose active-breakpoint layout leaves a column or row gap. The load
MUST NOT send a layout `PATCH /api/dashboards/:id`, and every panel SHALL render at the position the
`breakpoint-layout-resolution` rules give it.

#### Scenario: A stored breakpoint layout is empty and derived at render
- **WHEN** a dashboard whose stored layout for one breakpoint is empty (derived at render, e.g. `md` empty) while
  another is authored (e.g. `sm`, optionally leaving a column gap) is loaded with a full page load at a width that
  selects the authored breakpoint, so the loading skeleton's pre-measure breakpoint differs from the measured one
- **THEN** no "Maximum update depth exceeded" error is logged, no layout `PATCH` is sent, and every panel renders at
  its stored `sm` position

#### Scenario: The same layout at the other grid breakpoints
- **WHEN** the same dashboard is loaded with a full page load at widths that select `md` and `lg`
- **THEN** no "Maximum update depth exceeded" error is logged and no layout `PATCH` is sent
