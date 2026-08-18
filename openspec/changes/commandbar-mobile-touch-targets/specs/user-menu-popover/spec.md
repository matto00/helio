## MODIFIED Requirements

### Requirement: Single trigger button opens user menu popover
The app header top-right SHALL render a single trigger button (avatar image or initials fallback) that opens a popover menu when clicked. The popover consolidates session/identity controls (display name, Settings navigation, sign-out). No session/identity control SHALL appear outside this trigger. The theme toggle (Settings page's Appearance section) and accent color picker (Settings page) are intentionally rendered outside this popover — see `frontend-theme-system` and `workspace-accent-color`.

#### Scenario: Trigger opens popover on click
- **WHEN** the user clicks the avatar/initials trigger button in the top-right
- **THEN** a popover menu appears containing the session/identity controls

#### Scenario: No loose session controls outside trigger
- **WHEN** the user is authenticated
- **THEN** display name and sign-out are only accessible inside the popover, not rendered as standalone elements in the command bar

#### Scenario: Theme and accent are documented exceptions, not loose controls
- **WHEN** the user views the Settings page
- **THEN** the theme toggle and the accent color picker are both visible in the Settings page's Appearance section, and neither is duplicated inside the UserMenu popover
