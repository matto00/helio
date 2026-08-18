## MODIFIED Requirements

### Requirement: Persistent frontend light/dark theme system
The system SHALL provide a frontend theme system with dark mode as the default and a user-toggleable light mode. The theme toggle control SHALL be a standalone icon button in the command bar, not nested inside the UserMenu popover.

#### Scenario: Dark mode is the default theme
- **WHEN** the app loads without a stored theme preference
- **THEN** the frontend renders using the dark theme

#### Scenario: User toggles the active theme
- **WHEN** the user activates the theme toggle in the command bar
- **THEN** the app updates to the selected light or dark theme

#### Scenario: Theme preference persists across reloads
- **WHEN** a user has previously selected a theme
- **THEN** the frontend restores that theme on the next load

#### Scenario: Theme toggle found in the command bar
- **WHEN** the app header is rendered
- **THEN** a theme toggle control is visible and functional in the command bar, outside the UserMenu popover

#### Scenario: No duplicate theme toggle inside the UserMenu popover
- **WHEN** the user opens the UserMenu popover
- **THEN** no separate theme toggle control is rendered inside the popover
