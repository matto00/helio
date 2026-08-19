## ADDED Requirements

### Requirement: Command bar exposes a reachable "New chat" control on phone
Below the 768px breakpoint, on `/chat*` routes, the command bar SHALL render a "New chat" control
(an icon button labeled/accessible as "New chat", mirroring the desktop sidebar's "+" trigger)
that dispatches the same `startNewConversation()` action the desktop trigger dispatches, without
requiring the user to open `MobileNavSheet` first. At 768px and wider this control SHALL NOT
render (the desktop sidebar's own "+" trigger remains the only "New chat" entry point there).

#### Scenario: New chat control visible and functional on phone
- **WHEN** the viewport is narrower than 768px and the user is on a `/chat*` route
- **THEN** a "New chat" control is visible in the command bar, and activating it dispatches
  `startNewConversation()`, landing the user on the empty "new conversation" composer state

#### Scenario: Hidden at desktop widths
- **WHEN** the viewport is 768px or wider
- **THEN** the command bar's "New chat" control is not rendered (the desktop sidebar's own "+"
  trigger is the sole entry point)

#### Scenario: Hidden off the chat section
- **WHEN** the viewport is narrower than 768px and the user is on any route other than `/chat*`
- **THEN** the command bar's "New chat" control is not rendered
