## MODIFIED Requirements

### Requirement: A command-bar quick-launcher opens the active conversation as an overlay on any route
The app command bar SHALL include a persistent icon-button trigger, visible on every authenticated
route (on the rail-shell dashboard view, where the dashboard meta row replaces the command bar, the meta
row SHALL carry the same trigger), that opens the active conversation as a `Modal` overlay without navigating away from the
current page. The overlay SHALL be reachable by both a mouse click and a keyboard shortcut.

#### Scenario: The quick-launcher trigger is visible on a non-chat route
- **WHEN** the user is on any authenticated route other than `/chat` (e.g. `/pipelines`)
- **THEN** the command bar shows a quick-launcher trigger button

#### Scenario: Activating the trigger opens the overlay without navigation
- **WHEN** the user clicks the quick-launcher trigger while on `/pipelines`
- **THEN** the chat overlay opens and the URL remains `/pipelines`

#### Scenario: The keyboard shortcut opens the overlay
- **WHEN** the user presses the quick-launcher's keyboard shortcut
- **THEN** the chat overlay opens, matching the click-triggered behavior

#### Scenario: The trigger on the rail-shell dashboard view
- **WHEN** the user is on the dashboard view at 1280px wide
- **THEN** the dashboard meta row shows the quick-launcher trigger with the same accessible name
