## ADDED Requirements

### Requirement: App header shows avatar when user has avatarUrl
When `auth.status` is `'authenticated'` and `auth.currentUser.avatarUrl` is non-null, the app header SHALL render a circular avatar image using the `avatarUrl` value as the `src`.

#### Scenario: Avatar displayed for Google-authenticated user
- **WHEN** `auth.status` is `'authenticated'` and `currentUser.avatarUrl` is a non-empty string
- **THEN** an `<img>` element with the avatar URL is visible in the app header

#### Scenario: No avatar image when avatarUrl is null
- **WHEN** `auth.status` is `'authenticated'` and `currentUser.avatarUrl` is `null`
- **THEN** no broken image element is rendered; instead an initials fallback is shown

### Requirement: App header shows display name or email fallback
When `auth.status` is `'authenticated'`, the app header SHALL display `currentUser.displayName` if non-null, or `currentUser.email` as a fallback, alongside the avatar/initials.

#### Scenario: Display name shown when available
- **WHEN** `currentUser.displayName` is a non-null string
- **THEN** the header renders that display name

#### Scenario: Email shown when displayName is null
- **WHEN** `currentUser.displayName` is `null`
- **THEN** the header renders `currentUser.email`

### Requirement: Avatar initials fallback
When `currentUser.avatarUrl` is `null`, the header SHALL render a styled circular element containing the first letter of `displayName` (if non-null) or the first letter of `email`.

#### Scenario: Initials from displayName
- **WHEN** `currentUser.displayName` is `"Jane Doe"` and `avatarUrl` is `null`
- **THEN** the header renders the letter `"J"` in the avatar position

#### Scenario: Initials from email
- **WHEN** `currentUser.displayName` is `null` and `currentUser.email` is `"user@example.com"`
- **THEN** the header renders the letter `"u"` in the avatar position
