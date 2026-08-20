## Why

Helio's agent-native layer (helio-mcp) authenticates via Personal Access Tokens, and the backend
(`/api/tokens`: create/list/revoke, HEL-148) already fully supports them. There is no in-app UI for this,
though — provisioning a PAT today means a manual/backend step, which blocks any user from self-serving
agent access. Settings needs its own PAT-management section.

## What Changes

- Add a "Personal access tokens" section to the Settings page: create a named token, list existing tokens
  (name, created date, last-used), revoke a token.
- On creation, the raw token value is shown exactly once (in the response), with a copy-to-clipboard
  action and an explicit acknowledgment step before it is dismissed — it is never retrievable again.
- Revoke uses the existing inline confirm pattern (`ConfirmInline`), matching other destructive
  Settings actions (agent-memory "Clear all"/per-row delete).
- New `apiTokens` sub-tree on `settingsSlice`, new `apiTokenService.ts` HTTP wrapper for the three
  existing `/api/tokens` endpoints. No backend changes — `ApiTokenRoutes`/`ApiTokenService` already
  implement create/list/revoke (HEL-148).

## Capabilities

### New Capabilities

- `settings-api-tokens-ui`: the Settings "Personal access tokens" section — create (name only, shown-once
  reveal), list (name/created/last-used), revoke.

### Modified Capabilities

(none — no backend/API contract changes; the wire shapes already exist and are unchanged)

## Impact

- **Frontend only**: `frontend/src/features/settings/` (new `ApiTokensSection.tsx` + CSS, new
  `apiTokenService.ts`, `settingsSlice.ts` additions, `SettingsPage.tsx` wiring). No new dependencies.
- Consumes the existing `POST /api/tokens`, `GET /api/tokens`, `DELETE /api/tokens/:id` endpoints
  unchanged (`schemas/api-token.schema.json`).

## Non-goals

- No UI for token expiration (`expiresInDays`) or pipeline scoping (`scopedPipelineIds`) — both are
  optional on the existing create request and out of the ticket's acceptance criteria; a token created
  from this UI is unscoped and non-expiring, matching the field defaults.
- No backend changes; `/api/tokens` semantics are unchanged.
