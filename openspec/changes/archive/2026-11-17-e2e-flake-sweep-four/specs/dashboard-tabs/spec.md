## ADDED Requirements

### Requirement: A navigation made during tab hydration is not overridden

Tab hydration (restoring the saved tab set and active tab after sign-in or reload) SHALL NOT replace a dashboard the
user navigated to (the location changed to `/dashboards/:id`) after hydration started; a selection change without a
location change does not count as a navigation. When the user opens a dashboard (from a Home shelf card, the
dashboard list, or a `/dashboards/:id` URL) before hydration has finished, the opened dashboard SHALL remain the
selected and displayed dashboard once hydration completes, and SHALL be the active tab.

#### Scenario: A Home card clicked before hydration finishes

- **WHEN** a user with saved tabs whose active tab is B loads `/home`, and clicks dashboard A's shelf card while
  hydration is still waiting on the change signals
- **THEN** after hydration completes, dashboard A is displayed and selected, not B

#### Scenario: No navigation during hydration

- **WHEN** a user with saved tabs whose active tab is B loads `/home` and does nothing until hydration completes
- **THEN** the selected dashboard is B, as before
