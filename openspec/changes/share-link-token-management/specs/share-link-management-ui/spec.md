## Purpose

Defines the dashboard-level interface through which an owner mints a share link, reviews its expiry and status,
copies it, and revokes it — including the accessibility and responsive obligations that surface carries.

## ADDED Requirements

### Requirement: Owners can mint and copy a share link from the dashboard

The interface SHALL let a dashboard's owner mint a share link and SHALL present the resulting URL together with
a control that copies it to the clipboard. Because the secret is returned only once, the interface SHALL make
the freshly minted URL available for copying at the moment of creation and SHALL indicate that it cannot be
retrieved later.

#### Scenario: Mint and copy
- **WHEN** the owner mints a share link
- **THEN** the resulting URL is displayed and can be copied to the clipboard with a single control

#### Scenario: Copy result is announced
- **WHEN** the owner activates the copy control
- **THEN** the interface confirms the copy in a way that is conveyed to assistive technology, not by colour or
  icon alone

#### Scenario: One-time disclosure is communicated
- **WHEN** a share link is minted
- **THEN** the interface states that the link cannot be shown again after dismissal

### Requirement: The interface shows each link's expiry and revocation state

The interface SHALL list a dashboard's existing share links with their creation time, expiry if set, and
whether they are active, expired, or revoked. It SHALL let the owner set an expiry when minting a link and
SHALL let the owner revoke any listed link.

#### Scenario: Status is visible per link
- **WHEN** the owner opens the share-management surface for a dashboard with existing links
- **THEN** each link shows its creation time, its expiry or an explicit indication that it never expires, and
  whether it is active, expired, or revoked

#### Scenario: Revoke from the list
- **WHEN** the owner revokes a listed link
- **THEN** the link's displayed state becomes revoked without requiring a manual page reload

#### Scenario: Revocation is confirmed before it happens
- **WHEN** the owner activates the revoke control
- **THEN** the interface requires an explicit confirmation before revoking, since revocation is irreversible

#### Scenario: Empty state
- **WHEN** the owner opens the surface for a dashboard with no share links
- **THEN** an explanatory empty state is shown rather than a bare empty list

### Requirement: The share-management surface is accessible and responsive

The interface SHALL be operable by keyboard alone, SHALL expose accessible names and roles for every control,
SHALL manage focus when the surface opens and closes, and SHALL remain usable at the project's supported
viewport widths, following the project's design-language standard.

#### Scenario: Keyboard operation
- **WHEN** a user navigates the share-management surface using only the keyboard
- **THEN** every control can be reached and activated, and focus is visibly indicated

#### Scenario: Focus management
- **WHEN** the surface opens and is later dismissed
- **THEN** focus moves into the surface on open and returns to the invoking control on dismissal

#### Scenario: Narrow viewport
- **WHEN** the surface is displayed at the project's narrowest supported width
- **THEN** its content remains legible and every control remains reachable without horizontal scrolling

### Requirement: Failures are surfaced rather than swallowed

The interface SHALL report a failed mint, copy, or revoke to the user, and SHALL leave the displayed state
consistent with the server's actual state after a failure.

#### Scenario: Failed revoke is reported
- **WHEN** a revoke request fails
- **THEN** an error is shown to the user and the link is not displayed as revoked
