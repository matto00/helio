## Purpose

Defines the command palette overlay: how it opens and closes from anywhere in the authenticated shell, how it
traps and restores keyboard focus, and how it is navigated entirely from the keyboard.

## ADDED Requirements

### Requirement: Cmd/Ctrl+K opens the palette from any authenticated route
The authenticated shell SHALL open the command palette when the user presses `Cmd+K` (macOS) or `Ctrl+K`
(other platforms), from any authenticated route, regardless of which element holds focus at the time. The
handler SHALL prevent the browser's default action for that key combination. The palette SHALL NOT be
reachable from unauthenticated routes (login, register, OAuth callback).

#### Scenario: Palette opens from any authenticated route
- **WHEN** the user is on any authenticated route and presses `Cmd+K` or `Ctrl+K`
- **THEN** the command palette overlay becomes visible with its input focused and its query empty

#### Scenario: The shortcut is not active on unauthenticated routes
- **WHEN** the user is on the login, register, or OAuth callback route and presses `Cmd+K` or `Ctrl+K`
- **THEN** no command palette appears

#### Scenario: Reopening starts from a clean query
- **WHEN** the user opens the palette, types a query, closes it, and opens it again
- **THEN** the query is empty and the full default list is shown

### Requirement: The shortcut does not fire while the user is typing elsewhere
The global shortcut SHALL NOT open the palette while keyboard focus is inside a text input, textarea, select,
or `contenteditable` element outside the palette. This exclusion SHALL NOT apply to the palette's own input,
so the shortcut behaves consistently once the palette is open.

#### Scenario: Typing in a form field does not trigger the palette
- **WHEN** focus is inside a text input, textarea, or contenteditable region elsewhere in the app
- **AND** the user presses `Cmd+K` or `Ctrl+K`
- **THEN** the palette does not open and the keystroke is left to the focused field

#### Scenario: The shortcut still works from a non-input element
- **WHEN** focus is on the document body, a button, or a link
- **AND** the user presses `Cmd+K` or `Ctrl+K`
- **THEN** the palette opens

### Requirement: Escape closes the palette and restores focus
The palette SHALL close when the user presses `Escape` or clicks the backdrop outside the palette surface.
On close, keyboard focus SHALL return to the element that held focus immediately before the palette opened.

#### Scenario: Escape closes the palette
- **WHEN** the palette is open and the user presses `Escape`
- **THEN** the palette closes and no action is run

#### Scenario: Focus is restored to the previously focused element
- **WHEN** the user focuses a button, opens the palette, and then closes it with `Escape`
- **THEN** that same button regains keyboard focus

#### Scenario: Clicking the backdrop closes the palette
- **WHEN** the palette is open and the user clicks the backdrop outside the palette surface
- **THEN** the palette closes and no action is run

### Requirement: The palette is fully keyboard operable and focus trapped
While the palette is open, keyboard focus SHALL remain within the palette surface: `Tab` and `Shift+Tab`
SHALL cycle within it and never reach the page behind the overlay. `ArrowDown` and `ArrowUp` SHALL move the
active result, wrapping at each end. `Enter` SHALL run the active result. The active result SHALL always be
scrolled into view and SHALL be exposed to assistive technology as the active option of the input.

#### Scenario: Arrow keys move the active result
- **WHEN** the palette is open with more than one result
- **AND** the user presses `ArrowDown`
- **THEN** the next result becomes active and is scrolled into view

#### Scenario: Active result wraps at the ends of the list
- **WHEN** the last result is active and the user presses `ArrowDown`
- **THEN** the first result becomes active

#### Scenario: Enter runs the active result and closes the palette
- **WHEN** a result is active and the user presses `Enter`
- **THEN** that action's behavior is invoked exactly once and the palette closes

#### Scenario: Focus does not escape the overlay
- **WHEN** the palette is open and the user presses `Tab` repeatedly
- **THEN** focus cycles within the palette and never lands on an element behind the overlay

### Requirement: The palette renders on the shared overlay surface
The palette SHALL render on the application's shared modal/overlay pattern: an opaque surface over the
standard overlay backdrop, with a single entrance animation and no additional competing animation. All
colors, spacing, radii, and type SHALL come from design tokens, with no hardcoded values, so the palette is
correct in both light and dark themes.

#### Scenario: Palette uses shared overlay tokens
- **WHEN** the palette is rendered
- **THEN** its surface and backdrop use the shared overlay tokens and it carries exactly one entrance
  animation

#### Scenario: Palette is correct in both themes
- **WHEN** the palette is opened in light theme and in dark theme
- **THEN** its text and surface remain legible in both, with no hardcoded color values in its styles
