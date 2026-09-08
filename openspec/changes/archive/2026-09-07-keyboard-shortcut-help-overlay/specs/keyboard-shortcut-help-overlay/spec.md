## Purpose
Makes the application's global keyboard bindings discoverable to users by presenting the single shortcut
declaration as a grouped, readable overlay, so a keyboard-driven user can learn what shortcuts exist without
reading the source or the release notes.

## ADDED Requirements

### Requirement: A help overlay lists every declared global shortcut, grouped by area
The frontend SHALL provide a keyboard-shortcuts help overlay that renders every binding present in the global
shortcut declaration, clustered under its declared group heading, showing each binding's human-readable
description alongside its key combination. The overlay SHALL derive its contents from the declaration alone,
so a binding added to the declaration appears in the overlay without any further edit to the overlay itself.

#### Scenario: Every declared binding appears under its group
- **WHEN** the help overlay is open
- **THEN** every entry in the shortcut declaration is listed, each under a heading for its declared group, with
  its description and its key combination

#### Scenario: The palette, quick-launcher, and layout undo/redo bindings are all listed and accurate
- **WHEN** the help overlay is open
- **THEN** it lists the command palette binding, the assistant quick-launcher binding, and the layout undo and
  redo bindings, each showing the combination that actually triggers that binding

#### Scenario: A newly declared binding needs no overlay change
- **WHEN** a binding is added to the shortcut declaration
- **THEN** the overlay lists it without any modification to the overlay component

### Requirement: The overlay opens by keyboard and from the command palette, and closes with Esc
Pressing `?` on an authenticated route SHALL open the help overlay. A command-palette action SHALL open the
same overlay. Pressing `Esc` SHALL close it and return focus to the element that was focused before it opened.

#### Scenario: `?` opens the overlay
- **WHEN** the user presses `?` on an authenticated route with focus outside any text-entry context
- **THEN** the help overlay opens

#### Scenario: A palette action opens the overlay
- **WHEN** the user runs the "Keyboard shortcuts" action from the command palette
- **THEN** the help overlay opens, exactly as the `?` binding opens it

#### Scenario: Esc closes the overlay and restores focus
- **WHEN** the help overlay is open and the user presses `Esc`
- **THEN** the overlay closes and focus returns to the element focused before it opened

### Requirement: Key combinations render with platform-correct symbols
The overlay SHALL render each combination as discrete key caps using the interface's monospace type, and
SHALL label the platform modifier as the Command symbol on macOS and as `Ctrl` on other platforms. The Shift
modifier SHALL likewise be rendered in the platform's conventional form.

#### Scenario: macOS renders the Command symbol
- **WHEN** the overlay renders a binding that requires the platform modifier on macOS
- **THEN** the combination displays the Command symbol rather than the word `Ctrl`

#### Scenario: Non-macOS renders Ctrl
- **WHEN** the overlay renders that same binding on a non-macOS platform
- **THEN** the combination displays `Ctrl`

### Requirement: The overlay is keyboard-operable and visually consistent in both themes
The overlay SHALL be presented on the application's shared modal surface, SHALL be scrollable and operable by
keyboard alone with focus contained within it while open, and SHALL draw all color, spacing, and type from
design tokens so that it renders correctly in both light and dark themes.

#### Scenario: The overlay is reachable and contained by keyboard
- **WHEN** the overlay is open and the user navigates with Tab and Shift+Tab
- **THEN** focus cycles among the overlay's own focusable elements and does not escape to the page behind it

#### Scenario: A long shortcut list is scrollable
- **WHEN** the declared shortcut list is taller than the overlay's available height
- **THEN** the list scrolls within the overlay rather than overflowing or clipping content

#### Scenario: Both themes render correctly, including hover and focus states
- **WHEN** the overlay is displayed in light theme and in dark theme, at rest and with an element hovered
  and focused
- **THEN** its surface, text, and key caps are legible in every one of those states in both themes, with no
  hardcoded color values

#### Scenario: The overlay is visually a member of the app's existing overlay family
- **WHEN** the overlay is compared against the application's existing modal and sheet surfaces
- **THEN** it presents as one of that family, reusing the shared modal shell rather than introducing a
  distinct overlay treatment

### Requirement: Keyboard focus is indicated with the shared focus-ring contract
Any focus ring the overlay or its key caps present SHALL be shown for keyboard-driven focus only, and SHALL
use the application's shared focus-ring value rather than a locally defined one, so that opening the overlay
by mouse does not paint a focus ring and the indicator cannot drift from the rest of the application.

#### Scenario: Opening by mouse does not paint a ring
- **WHEN** the user opens the overlay by clicking a control and the overlay moves focus into itself
- **THEN** no focus ring is painted on the auto-focused element

#### Scenario: Keyboard navigation paints the shared ring
- **WHEN** the user moves focus within the overlay using the keyboard
- **THEN** the focused element shows the application's shared focus-ring indicator, matching the treatment
  used by the command palette
