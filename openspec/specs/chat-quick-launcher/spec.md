# chat-quick-launcher Specification

## Purpose
A command-bar-triggered overlay entry point into the active chat conversation, reachable from any
authenticated route without navigating away, so a user never has to leave their current screen to
check on or continue their conversation with the assistant.
## Requirements
### Requirement: A command-bar quick-launcher opens the active conversation as an overlay on any route
The app command bar SHALL include a persistent icon-button trigger, visible on every authenticated
route, that opens the active conversation as a `Modal` overlay without navigating away from the
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

### Requirement: The overlay renders the same active-conversation state as the /chat nav page
The quick-launcher overlay SHALL render the identical active conversation the `/chat` nav page
would show for the same selection — one shared component and Redux slice, not a second,
independently-fetched copy — and SHALL provide a link to `/chat` for browsing the full conversation
list, which the overlay itself does not attempt to duplicate.

#### Scenario: The overlay reflects the same active conversation as /chat
- **WHEN** a conversation is already selected in application state and the user opens the
  quick-launcher overlay from a different route
- **THEN** the overlay shows that same conversation's content

#### Scenario: The overlay links to the full conversation list
- **WHEN** the quick-launcher overlay is open
- **THEN** a "Browse all conversations" link is present that navigates to `/chat`

### Requirement: Only one overlay is active at a time
Opening the quick-launcher SHALL close any other currently-open overlay of the same kind (reusing
the existing single-active-overlay mechanism), and SHALL be dismissible via Escape or backdrop
click, per the `Modal` primitive's existing built-in behavior.

#### Scenario: Escape closes the quick-launcher overlay
- **WHEN** the quick-launcher overlay is open and the user presses Escape
- **THEN** the overlay closes

