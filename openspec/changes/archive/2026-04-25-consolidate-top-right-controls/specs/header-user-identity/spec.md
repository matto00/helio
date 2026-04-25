## MODIFIED Requirements

### Requirement: App header shows avatar when user has avatarUrl
When `auth.status` is `'authenticated'` and `auth.currentUser.avatarUrl` is non-null, the app header SHALL render a circular avatar image using the `avatarUrl` value as the `src`. The avatar SHALL serve as the trigger button for the UserMenu popover.

#### Scenario: Avatar displayed for Google-authenticated user
- **WHEN** `auth.status` is `'authenticated'` and `currentUser.avatarUrl` is a non-empty string
- **THEN** a circular avatar image is visible as the UserMenu trigger button in the top-right of the app header

#### Scenario: No avatar image when avatarUrl is null
- **WHEN** `auth.status` is `'authenticated'` and `currentUser.avatarUrl` is `null`
- **THEN** no broken image element is rendered; instead an initials fallback button is shown as the UserMenu trigger

### Requirement: App header shows display name or email fallback
When `auth.status` is `'authenticated'`, the user's display name or email fallback SHALL be visible inside the UserMenu popover, not as a standalone element in the command bar.

#### Scenario: Display name shown in menu
- **WHEN** `currentUser.displayName` is a non-null string and the popover is open
- **THEN** the display name is visible inside the UserMenu popover

#### Scenario: Email shown when displayName is null
- **WHEN** `currentUser.displayName` is `null` and the popover is open
- **THEN** `currentUser.email` is visible inside the UserMenu popover

### Requirement: Avatar initials fallback
When `currentUser.avatarUrl` is `null`, the header SHALL render a styled circular button containing the first letter of `displayName` (if non-null) or the first letter of `email`, which acts as the UserMenu trigger.

#### Scenario: Initials from displayName
- **WHEN** `currentUser.displayName` is `"Jane Doe"` and `avatarUrl` is `null`
- **THEN** the trigger button renders the letter `"J"` in the avatar position

#### Scenario: Initials from email
- **WHEN** `currentUser.displayName` is `null` and `currentUser.email` is `"user@example.com"`
- **THEN** the trigger button renders the letter `"u"` in the avatar position
