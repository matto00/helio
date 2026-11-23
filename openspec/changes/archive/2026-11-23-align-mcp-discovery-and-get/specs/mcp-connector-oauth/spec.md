## MODIFIED Requirements

### Requirement: OAuth discovery and dynamic client registration

helio-mcp SHALL serve OAuth protected-resource metadata (`/.well-known/oauth-protected-resource/mcp` and the
root variant) naming itself as authorization server, OAuth authorization-server metadata, and RFC 7591 dynamic client
registration. The authorization-server metadata SHALL be served by helio-mcp's own handler (the SDK's auth router
serves the other endpoints) and SHALL state
`grant_types_supported` explicitly as exactly `["authorization_code","refresh_token"]`, and SHALL NOT advertise a
grant the token endpoint refuses. Authorization SHALL require PKCE `S256`. Registration SHALL reject any
redirect URI that is neither `https:` nor `http:` on a loopback host (`localhost`, `127.0.0.1`, `[::1]`). Registered client information
SHALL be sealed into the issued `client_id` so that any instance can resolve it with no store; a sealed `client_id`
SHALL NOT expire, and one that does not unseal SHALL be rejected as an unknown client. Every registered client SHALL be
a public client: no client secret is issued, whatever `token_endpoint_auth_method` was requested or omitted.

#### Scenario: Discovery from a 401

- **WHEN** a client follows the `resource_metadata` URL from a `401` on `/mcp`
- **THEN** it can discover the authorization server metadata and register a client successfully

#### Scenario: Grant list matches the token endpoint

- **WHEN** a client fetches `/.well-known/oauth-authorization-server`
- **THEN** `grant_types_supported` is exactly `["authorization_code","refresh_token"]`

#### Scenario: Registration without a method gets no secret

- **WHEN** a client registers with `token_endpoint_auth_method` omitted or set to `client_secret_post`
- **THEN** the response carries no `client_secret`, `token_endpoint_auth_method` is `none`, and the client can
  exchange a code at `/token` without a secret

#### Scenario: Plain-http redirect URI

- **WHEN** a client registers `redirect_uris: ["http://attacker.example/cb"]`
- **THEN** registration fails with `invalid_client_metadata` and no client id is issued

#### Scenario: Both protected-resource metadata URLs

- **WHEN** a client fetches `/.well-known/oauth-protected-resource` or `/.well-known/oauth-protected-resource/mcp`
- **THEN** both return the same document naming `<HELIO_MCP_PUBLIC_URL>/mcp` as resource and this server as authorization server

#### Scenario: Forged client id

- **WHEN** `/authorize` is called with a `client_id` that was not issued by this server's key
- **THEN** the request is rejected and no redirect to the consent page happens

### Requirement: Token exchange returns the sealed PAT as access token

The token endpoint SHALL exchange a valid code only for the client and redirect URI it was issued to, after PKCE
verification, and SHALL return a bearer access token that is the PAT sealed with a lifetime of 1 hour from issue.
An access token issued before this requirement took effect SHALL keep working until its own sealed expiry. The
access token does not track the PAT's own expiry; an earlier PAT expiry or revocation is detected by the liveness
requirement below. When the client's registration lists `refresh_token` in `grant_types`, the response SHALL also
carry a refresh token (see the refresh requirement); a client that registered no `grant_types`, or one without
`refresh_token`, SHALL receive no refresh token. When the backend refuses to create the refresh family with `401`
(the PAT was revoked or expired), the exchange SHALL answer `invalid_grant` with no tokens; for any other failure
(another status, a network error or a timeout) the exchange SHALL still succeed, without a refresh token. The
resource sealed into a refresh token SHALL always be this server's canonical resource, whether or not the client
sent `resource`. Codes, client ids, pending requests, access
tokens and refresh tokens SHALL each be sealed under a distinct key derived from `HELIO_MCP_TOKEN_KEY`, so one kind
can never be accepted as another.

#### Scenario: Code presented as access token

- **WHEN** a client sends an authorization code as the bearer token on `/mcp`
- **THEN** the response is `401`

#### Scenario: Wrong PKCE verifier

- **WHEN** a code is exchanged with a verifier that does not match its challenge
- **THEN** the token endpoint answers `invalid_grant` and returns no token

#### Scenario: One-hour access token with a refresh token

- **WHEN** a client registered with `grant_types: ["authorization_code","refresh_token"]` exchanges a valid code
- **THEN** the response carries `expires_in: 3600` and a `refresh_token`

#### Scenario: PAT revoked before the code exchange

- **WHEN** the PAT behind a code is revoked before a refresh-capable client exchanges the code
- **THEN** the token endpoint answers `invalid_grant` and returns no token

#### Scenario: Client without the refresh grant

- **WHEN** a client registered with no `grant_types` exchanges a valid code
- **THEN** the response carries an access token and no `refresh_token`

### Requirement: Unauthenticated requests are refused with a discovery hint

Bearer verification on `/mcp` SHALL run before the request body is read and before the method check, for every
method. A `/mcp` request with no bearer token, an unsealable token or an expired token SHALL receive `401` with
`WWW-Authenticate: Bearer` carrying `resource_metadata="<HELIO_MCP_PUBLIC_URL>/.well-known/oauth-protected-resource/mcp"`.
No tool SHALL run and no backend call SHALL be made for such a request.

#### Scenario: Missing token

- **WHEN** `POST /mcp` arrives with no `Authorization` header
- **THEN** the response is `401` with the `WWW-Authenticate` header above

#### Scenario: Unauthenticated GET or DELETE

- **WHEN** `GET /mcp` or `DELETE /mcp` arrives with no `Authorization` header
- **THEN** the response is `401` with the `WWW-Authenticate` header above, not `405`

#### Scenario: Oversized unauthenticated request

- **WHEN** a request with no token and a body larger than 32 MiB is posted to `/mcp`
- **THEN** the response is `401`, not `413`, and the body is not buffered

#### Scenario: Tampered token

- **WHEN** one byte of a valid access token is changed
- **THEN** the response is `401`

## ADDED Requirements

### Requirement: Refresh tokens rotate, are bound, expire, and detect reuse

A refresh token SHALL be a sealed value of its own kind carrying the PAT, the client id hash, the resource, a
family id and a random token id; the server side SHALL store only a SHA-256 hash of the current token id, never the
token. A refresh grant SHALL succeed only for the client it was issued to and for this server's resource, and SHALL
return a new 1-hour access token and a new refresh token while the presented one stops being valid (rotation on
every use). A refresh token SHALL expire 30 days after issue and never later than the expiry of the PAT behind it.
Presenting a refresh token that has already been rotated SHALL be treated as reuse: the PAT behind it SHALL be
revoked, which ends every refresh token of every family it backs and every access token sealing it. There SHALL be no
grace window for a retried refresh. Errors SHALL be: `invalid_grant` (RFC 6749 section 5.2) for an invalid,
expired, rotated, foreign-client or revoked-authorization token; `invalid_target` (RFC 8707) for a foreign
`resource`; and `server_error` with HTTP 500 when the backend cannot be reached. When the backend provably did not
process the rotation (connection refused, DNS failure, or a `429`/`5xx` answered before the rotate transaction),
nothing SHALL rotate and the same token SHALL work on retry. After a timeout or a `5xx` from a layer that does not
stop the backend handler, the outcome is indeterminate: a retry with the same token MAY be treated as reuse. Error descriptions SHALL NOT
quote token material.

#### Scenario: Rotation

- **WHEN** a client presents its current refresh token
- **THEN** it receives a new access token and a new refresh token, and presenting the old refresh token afterwards fails

#### Scenario: Reuse revokes the family and the PAT

- **WHEN** a refresh token that was already rotated is presented
- **THEN** the answer is `invalid_grant`, the newest refresh token of that family is refused afterwards, and the PAT
  behind it no longer authenticates against the Helio API

#### Scenario: Another client's refresh token

- **WHEN** client B presents a refresh token issued to client A
- **THEN** the answer is `invalid_grant` and nothing rotates

#### Scenario: Revoked PAT

- **WHEN** the user revokes the connector's PAT in Settings and the client then presents its refresh token
- **THEN** the answer is `invalid_grant`

#### Scenario: Backend unavailable

- **WHEN** the backend refuses the connection during a refresh grant
- **THEN** the token endpoint answers `500` `server_error` and the same refresh token still works on a later retry

#### Scenario: Access token presented as refresh token

- **WHEN** an access token is sent as `refresh_token`
- **THEN** the answer is `invalid_grant`
