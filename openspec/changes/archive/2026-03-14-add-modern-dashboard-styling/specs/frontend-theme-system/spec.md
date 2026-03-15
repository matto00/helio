## ADDED Requirements

### Requirement: Persistent frontend light/dark theme system
The system SHALL provide a frontend theme system with dark mode as the default and a user-toggleable light mode.

#### Scenario: Dark mode is the default theme
- **WHEN** the app loads without a stored theme preference
- **THEN** the frontend renders using the dark theme

#### Scenario: User toggles the active theme
- **WHEN** the user changes the theme from the frontend
- **THEN** the app updates to the selected light or dark theme

#### Scenario: Theme preference persists across reloads
- **WHEN** a user has previously selected a theme
- **THEN** the frontend restores that theme on the next load

### Requirement: Reusable theme tokens
The system SHALL expose reusable styling tokens for shared frontend surfaces and interactions.

#### Scenario: Shared surfaces use centralized theme tokens
- **WHEN** the app shell, sidebar, or panel surfaces are styled
- **THEN** they use centralized theme tokens instead of hardcoded one-off values
