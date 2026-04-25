## MODIFIED Requirements

### Requirement: Persistent frontend light/dark theme system
The system SHALL provide a frontend theme system with dark mode as the default and a user-toggleable light mode. The theme toggle control SHALL be located inside the UserMenu popover, not as a standalone button in the command bar.

#### Scenario: Dark mode is the default theme
- **WHEN** the app loads without a stored theme preference
- **THEN** the frontend renders using the dark theme

#### Scenario: User toggles the active theme
- **WHEN** the user activates the theme toggle inside the UserMenu popover
- **THEN** the app updates to the selected light or dark theme

#### Scenario: Theme preference persists across reloads
- **WHEN** a user has previously selected a theme
- **THEN** the frontend restores that theme on the next load

#### Scenario: Theme toggle found inside popover
- **WHEN** the UserMenu popover is open
- **THEN** a theme toggle control is visible and functional within the popover

#### Scenario: No standalone theme toggle in command bar
- **WHEN** the user views the app header
- **THEN** no separate theme toggle button is rendered outside the UserMenu popover
