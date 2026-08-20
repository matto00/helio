# HEL-727: Add Personal Access Token (API token) management to Settings

## Description

From the beta UI/UX polish sweep (PR #382), majorProposal.

**Scope**
Helio's agent-native layer (helio-mcp) authenticates via PATs, but there's no in-app UI to create, view, or revoke them — provisioning is currently a manual/backend step. Add a Settings section: create a named PAT (shown once), list existing tokens (name, created date, last-used), revoke.

## Acceptance Criteria

* A user can create a named PAT from Settings and see it exactly once at creation time.
* A user can list and revoke their own PATs.
