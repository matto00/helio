## Purpose

Defines the actions the command palette ships with on its own — navigation to each primary section of the app
and a theme toggle — so the palette is useful before any other feature contributes to it.

## ADDED Requirements

### Requirement: Navigation actions are derived from the nav section registry
The palette's built-in navigation actions SHALL be derived from the existing navigation section registry
rather than from a second, independently maintained route-to-label mapping. Adding or relabelling a
nav-visible route in that registry SHALL change the palette's navigation actions with no edit to the palette.

#### Scenario: Palette navigation entries match the nav registry
- **WHEN** the palette is opened with an empty query
- **THEN** it offers one navigation action for each nav-visible entry in the section registry, each using
  that entry's own label and icon

#### Scenario: Registry edits reach the palette without palette edits
- **WHEN** a nav-visible entry's label is changed in the section registry
- **THEN** the palette's corresponding navigation action shows the new label with no change to the palette

### Requirement: Navigation actions route to their destination
Running a navigation action SHALL navigate the application to that entry's route using client-side routing,
without a full page reload, and SHALL close the palette.

#### Scenario: Running a navigation action changes route
- **WHEN** the user runs the navigation action for a section
- **THEN** the application navigates to that section's route and the palette closes

#### Scenario: Navigating from the palette does not reload the page
- **WHEN** the user runs any navigation action
- **THEN** navigation happens client-side, preserving application state

### Requirement: A theme toggle action is available
The palette SHALL offer an action that toggles the application between light and dark theme, using the
application's existing theme mechanism so the change persists exactly as it does from the existing theme
control. Its label SHALL make the resulting state clear.

#### Scenario: Theme action toggles the theme
- **WHEN** the application is in light theme and the user runs the theme action
- **THEN** the application switches to dark theme and the palette closes

#### Scenario: Theme action reflects the current theme
- **WHEN** the palette is opened
- **THEN** the theme action's label indicates the theme it will switch to

### Requirement: Built-in actions are grouped and discoverable by keyword
Built-in actions SHALL declare a section so they group sensibly, and SHALL declare keywords so common
alternative terms find them.

#### Scenario: Navigation actions are grouped together
- **WHEN** the palette opens with an empty query
- **THEN** the navigation actions appear together under a single section label

#### Scenario: An alternative term finds the theme action
- **WHEN** the user types an alternative term for the theme action, such as "dark"
- **THEN** the theme action appears in the results

### Requirement: An "Open assistant" action keeps the quick-launcher reachable from the palette
The palette SHALL seed an action that opens the assistant quick-launcher overlay. This action exists because
the quick-launcher lost the `Cmd/Ctrl+K` binding to the palette, so the palette itself SHALL remain a
first-class route to it. The action SHALL declare keywords covering common alternative terms for the assistant
so it is findable without knowing its exact label.

#### Scenario: The assistant action opens the quick-launcher
- **WHEN** the user runs the "Open assistant" action from the palette
- **THEN** the assistant quick-launcher overlay opens and the palette closes

#### Scenario: The assistant action is findable by alternative terms
- **WHEN** the user types "chat" or "assistant" in the palette
- **THEN** the action that opens the assistant quick-launcher appears in the results
