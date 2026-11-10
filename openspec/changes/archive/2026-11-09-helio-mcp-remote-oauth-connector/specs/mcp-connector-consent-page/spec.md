## ADDED Requirements

### Requirement: Signed-in consent page for MCP connectors

The frontend SHALL serve `/connect/mcp` to signed-in users only, outside the app shell, in the sign-in card layout; a
signed-out visitor SHALL be sent through login and returned to the same URL with its query intact on every sign-in
path (password, password with MFA, Google, Google with MFA). The page SHALL refuse to be framed: the hosting config
sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` for `/connect/**`, and the page
shows an error with no Allow or Deny action when it detects it is inside a frame. Allow and Deny SHALL stay inert until
the page has been visible and focused for 500 ms continuously, and SHALL re-check the pending request's expiry before
minting anything. The page SHALL fetch the pending request's client name and
redirect-URI host from helio-mcp and show both before the user decides. An invalid or expired request SHALL show an
error state and offer no Allow action.

#### Scenario: Signed-out user

- **WHEN** a signed-out user opens `/connect/mcp?request=...`
- **THEN** they are taken to login and, after signing in, land back on `/connect/mcp?request=...`

#### Scenario: Signed-out user with MFA

- **WHEN** a signed-out user with MFA enabled opens `/connect/mcp?request=...` and completes password and MFA
- **THEN** they land back on `/connect/mcp?request=...`, not `/home`

#### Scenario: Immediate click is ignored

- **WHEN** Allow is clicked within 500 ms of the page becoming visible and focused
- **THEN** no PAT is created; a click after the interval creates exactly one

#### Scenario: Framed page

- **WHEN** `/connect/mcp` is rendered inside an iframe
- **THEN** no Allow or Deny action is shown

#### Scenario: Redirect host shown

- **WHEN** the page loads a valid request registered with redirect URI `https://claude.ai/api/mcp/auth_callback`
- **THEN** the page shows `claude.ai` as where access will be sent

### Requirement: Allow mints a named, expiring PAT and hands it to helio-mcp only

On Allow the page SHALL create a PAT through the existing `POST /api/tokens` with a name identifying the connector
client (control characters stripped, at most 100 characters) and an expiry of 90 days, then submit it with the pending request by form POST to the helio-mcp callback.
The callback origin SHALL come only from the build-time `VITE_MCP_ORIGIN`, never from the URL or the pending request;
when it is unset the page SHALL show that connectors are unavailable and mint nothing. On Deny the page SHALL mint
nothing and POST a denial to the same callback. The PAT SHALL never be placed in a URL, stored, or logged.

#### Scenario: Allow

- **WHEN** a signed-in user clicks Allow on a valid request
- **THEN** exactly one new PAT appears in their token list with the connector name and a 90-day expiry, and the
  browser POSTs to `<VITE_MCP_ORIGIN>/oauth/callback`

#### Scenario: Long client name

- **WHEN** the client's name is 200 characters long and the user clicks Allow
- **THEN** a PAT is created with a name of at most 100 characters

#### Scenario: Deny

- **WHEN** the user clicks Deny
- **THEN** no PAT is created and the browser POSTs a denial to the callback

#### Scenario: Unconfigured origin

- **WHEN** the app is built without `VITE_MCP_ORIGIN`
- **THEN** the page states connectors are unavailable and offers no Allow action
