# settings-api-tokens-ui Specification

## Purpose
The Settings section where a user self-serves Personal Access Token management: create a named token
(raw value shown exactly once), list existing tokens, and revoke one — no manual/backend provisioning
step required.
## Requirements
### Requirement: Settings exposes a Personal access tokens section
The Settings page SHALL include a "Personal access tokens" section that fetches and lists the caller's own
tokens on mount, independently of the other Settings sections' loading/error state (matching the page's
existing per-section gating).

#### Scenario: Section lists existing tokens
- **WHEN** a user with existing PATs opens Settings
- **THEN** the Personal access tokens section shows each token's name, created date, and last-used date
  (or an indication it has never been used)

#### Scenario: Section shows an empty state with none created yet
- **WHEN** a user with no PATs opens Settings
- **THEN** the Personal access tokens section shows an empty state and a way to create one

### Requirement: A user can create a named token and see its raw value exactly once
Submitting a name SHALL call the token-creation endpoint. On success, the section SHALL display the raw
token value returned by that response, along with a copy-to-clipboard action, and SHALL NOT display or
persist that raw value anywhere else — subsequent renders (including a page reload) SHALL show only the
token's metadata (name, created date, last-used date), never the raw value again.

#### Scenario: Newly created token is shown once
- **WHEN** a user submits a valid name and the creation request succeeds
- **THEN** the raw token value is shown along with a copy action, and the token also appears in the list
  with its metadata

#### Scenario: Token is not retrievable after acknowledgment
- **WHEN** a user acknowledges (dismisses) a newly created token's one-time reveal
- **THEN** no later view of the Personal access tokens section displays that token's raw value again

#### Scenario: Blank name is rejected before submission
- **WHEN** a user attempts to submit the create form with a blank name
- **THEN** the create action is not submitted and no request is sent

### Requirement: A user can revoke their own token
Each listed token SHALL have a revoke action gated by an inline confirmation (no browser-native confirm
dialog). Confirming SHALL call the revoke endpoint for that token's id; on success the token SHALL no
longer appear in the list.

#### Scenario: Revoke removes the token from the list
- **WHEN** a user confirms revoking a listed token
- **THEN** the revoke request is sent for that token's id and, on success, the token is removed from the
  displayed list

#### Scenario: Revoke can be cancelled
- **WHEN** a user opens the revoke confirmation for a token and cancels it
- **THEN** no request is sent and the token remains in the list

