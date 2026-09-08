## ADDED Requirements

### Requirement: An action may declare a keyboard shortcut for display
A command action MAY declare the keyboard shortcut that invokes it, and the palette SHALL present that
shortcut alongside the action using the application's shared key-cap presentation, so a shortcut is shown
identically wherever it appears. An action without a declared shortcut SHALL render unchanged.

#### Scenario: An action with a shortcut shows it
- **WHEN** the palette lists an action that declares a keyboard shortcut
- **THEN** that shortcut is displayed beside the action, rendered the same way the application's keyboard
  shortcut list renders it, including platform-correct modifier symbols

#### Scenario: An action without a shortcut is unaffected
- **WHEN** the palette lists an action that declares no shortcut
- **THEN** it renders with no shortcut affordance and no reserved empty space that would misalign it

#### Scenario: The shortcut shown is the one that actually invokes the action
- **WHEN** an action declares a shortcut that is also a registered global binding
- **THEN** the shortcut displayed is the same combination that global binding fires on, so the two cannot
  drift apart
