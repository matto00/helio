## Purpose
Lets a user create a dashboard, data source, pipeline, or panel directly from the command palette, from
wherever they happen to be in the application, so authoring can begin from the keyboard without first
navigating to the section that owns the create button.

## ADDED Requirements

### Requirement: The palette offers create actions for every workspace resource
The command palette SHALL present create actions for a dashboard, a data source, a pipeline, and a panel,
clustered under a single "Create" grouping. Each action SHALL invoke the application's existing creation
flow for that resource — the same flow the corresponding section's own create control invokes — rather than
performing its own creation.

#### Scenario: All four create actions are offered
- **WHEN** the user opens the command palette
- **THEN** create actions for a dashboard, a data source, a pipeline, and a panel are listed together under
  a "Create" grouping

#### Scenario: A create action produces the same result as the section's own control
- **WHEN** the user runs a create action from the palette
- **THEN** the resulting creation flow, and the resource it produces, are the same as if the user had
  activated that section's own create control

### Requirement: Create actions work from any route, not only their owning section
Each create action SHALL take effect from any route in the authenticated application, including routes on
which the surface it opens is not otherwise present. An action SHALL NOT appear to succeed while having no
effect, and SHALL NOT defer its effect to some later moment when the user happens to visit another route.

#### Scenario: Creating from an unrelated route opens the flow immediately
- **WHEN** the user is on a route that does not itself present a given resource's creation surface, and runs
  that resource's create action from the palette
- **THEN** the creation flow opens immediately, in place, on the route the user is already on

#### Scenario: An action never silently defers
- **WHEN** a create action is run from an unrelated route
- **THEN** nothing about that action is queued for a later route change — in particular, navigating to the
  resource's own section afterwards does not surface a creation flow the user did not just request

#### Scenario: The creation surface is never presented twice
- **WHEN** the user runs a create action while already on the section that presents that creation surface
- **THEN** exactly one instance of the creation surface is shown

### Requirement: A creation surface requested from elsewhere is never deferred into a later visit
Requesting a creation surface from a route that does not present it SHALL either open it immediately or do
nothing at all. The request SHALL NOT persist as pending state that causes the surface to appear on some
later, unrelated arrival at the section that owns it. This SHALL hold in the application's production
behavior, not merely under development-mode safeguards that discard such pending state.

#### Scenario: A request made where nothing can serve it does not surface later
- **WHEN** a creation request is made from a route where the corresponding surface is not presented, and the
  user later navigates to the section that owns that surface
- **THEN** no creation surface appears that the user did not just request

#### Scenario: The behavior holds outside development mode
- **WHEN** the application runs without development-only mount-time safeguards
- **THEN** the preceding scenario still holds, so the guarantee does not depend on a development-only
  side effect that discards pending state

### Requirement: Panel creation is offered only when a dashboard is selected
The panel create action SHALL be unavailable whenever no dashboard is selected, because a panel has no
target in that state. The other three create actions SHALL always be available.

#### Scenario: No dashboard selected
- **WHEN** no dashboard is selected and the user opens the palette
- **THEN** the panel create action is presented as unavailable and running it creates nothing

#### Scenario: A dashboard is selected
- **WHEN** a dashboard is selected
- **THEN** the panel create action is available and targets that dashboard

### Requirement: Running a create action hands off cleanly to the creation surface
Running a create action SHALL dismiss the palette and move keyboard focus into the creation surface that
opens, so a keyboard user continues in the new surface without their focus being stranded.

#### Scenario: Palette closes and focus follows
- **WHEN** the user runs a create action from the palette using the keyboard
- **THEN** the palette closes and focus moves into the opened creation surface
