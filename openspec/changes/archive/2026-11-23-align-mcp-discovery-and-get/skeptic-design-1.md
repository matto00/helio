## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 368ec37962e021e9363e58d507421f1d172fee21 (= origin/main; the change dir is untracked).
Owner rulings Q1/Q2/O1-O4 (workflow-state.md line 22) are treated as settled. Nothing below re-opens them.

### What I verified (with evidence)

**Spec text (fetched myself, copies in `.concertino/scratch/HEL-1713/skeptic/`)**
- MCP 2025-11-25 authorization (`mcp-auth.md`): line 582 "Authorization servers **SHOULD** issue short-lived access
  tokens", line 583 "For public clients, authorization servers **MUST** rotate refresh tokens as described in OAuth 2.1
  Section 4.3.1", line 476 "Invalid or expired tokens **MUST** receive a HTTP 401". design.md quotes these correctly.
- OAuth 2.1 draft-13 §4.3 / §4.3.1 (`oauth21.txt`): the AS MUST keep the client binding; for public clients it MUST
  use sender-constraint or rotation; on replay it "will revoke the active refresh token as well as the access
  authorization grant associated with it". It also allows encoding the grant in the token if its integrity is
  protected. D2 (AES-GCM seal carrying `familyId`) and D4/O3 (reuse deletes the PAT, and the PAT is the grant)
  satisfy this.
- RFC 8414 §2 (`8414.txt` l.246-252): the default when omitted is `["authorization_code", "implicit"]`. The quote is
  correct.
- RFC 7591 §2 (`7591.txt` l.487-488): an omitted `grant_types` means "only the authorization_code Grant Type". The
  quote is correct, and D3's gating follows it.
- RFC 6749 §5.2 (`6749.txt`) and OAuth 2.1 §3.2.4: the token-endpoint codes are invalid_request, invalid_client,
  invalid_grant, unauthorized_client, unsupported_grant_type and invalid_scope. `server_error` is NOT in that list (it
  is an authorization-endpoint code, OAuth 2.1 l.2233), and `invalid_target` comes from RFC 8707. See note N1.

**Ground truth in the tree**
- `helio-mcp/src/oauth/seal.ts`: there are four kinds, each with its own HKDF subkey (`helio-mcp/${kind}`) and
  `exp` in seconds; `ACCESS_TTL_SECONDS = 90d`. A fifth `refresh` kind fits the mechanism, and the
  `exp = min(now+30d, expiresAt)` rule can be expressed through the `ttlSeconds` argument.
- `provider.ts`: `exchangeRefreshToken` always throws `InvalidGrantError`. `getClient` already returns the sealed
  `grant_types`, so D3's gating is implementable. `checkResource` and `InvalidTargetError` exist.
- SDK 1.32.2 `dist/esm/server/auth/router.js`: `createOAuthMetadata` hardcodes
  `grant_types_supported: ['authorization_code','refresh_token']` (the design's claim is confirmed).
  `handlers/token.js` maps `ServerError` to 500 and every other `OAuthError` to 400, sets
  `Cache-Control: no-store`, passes `(client, refresh_token, scopes, resource)`, and does not check
  `client.grant_types`. This matches D5.
- `httpApp.ts`: `app.all("/mcp", bearer, livenessGate, notAllowed)`. The bearer check runs before 405, as D7 and Q2
  say. `httpApp.test.ts:74-85` already asserts 405 + `Allow: POST` when authorized and 401 when not.
  `/.well-known/oauth-authorization-server` is served inside `mcpAuthRouter`, so an `app.get` mounted earlier wins
  (D1 works). The token rate limit is 300 per 15 min per IP (`trust proxy 1`).
- `infra/deploy-mcp.sh:65-66`: `--max-instances=2 --min-instances=0`. The design's case for keeping reuse state off
  helio-mcp holds.
- Backend: V42 `api_tokens` has nullable `expires_at`, owner-only RLS with FORCE, and `user_id` ON DELETE CASCADE.
  The consent page sends `expiresInDays: TOKEN_LIFETIME_DAYS` (`ConnectMcpPage.tsx:81`), so connector PATs do expire.
  `AuthDirectives.scala:34-35` sets `tokenId = Some(..)` for PAT callers and `:61` sets `tokenId = None` for
  sessions (D4's session-403 rule is implementable). `confineScopedToken` (`:141-163`) returns 403 for a scoped PAT
  off `/hooks`. `ApiTokenRepository.revoke` runs under `withUserContext`, so the reuse path can delete the PAT on the
  app pool. FK cascades from `api_tokens` bypass RLS (Postgres RI), so the cascade works under FORCE.
- `ApiTokenService.revoke` (`services/auth/ApiTokenService.scala:116-119`) emits audit `token.revoke`. The design's
  reuse path deletes the PAT and only writes an INFO log line (CR2).
- Migrations: origin/main tops out at V146 (fetched now, origin/main = 368ec379). No `origin/*` branch carries
  V147-V149. **V147 is the next free number**, and C15 re-checks it before commit.
- `RlsPolicyGuardSpec.scala` keeps an exact allowlist of RLS tables (`api_tokens` at l.101) and a completeness check.
  The new table must be added to it, and tasks.md does not mention this (N3).
- Archived HEL-1709 design l.20/46-47/191 and README l.86-87 say "no refresh, GET answers 405". The ticket's
  description of the drift is accurate.
- `openspec validate align-mcp-discovery-and-get --strict`: valid. The MODIFIED requirement headers match the living
  specs exactly (`mcp-connector-oauth` l.8/88/106, `mcp-remote-http-transport` l.8).

**Coverage of the ACs and rulings:** AC1 maps to D1, D3-D5 and D8. AC2 maps to D7, the existing test and the spec
scenarios. Q1 maps to D2-D6, Q2 to D7, O1 to D3 and the O1 section, O2 to the O2 section, O3 to D4 and the O3
section, and O4 to the O4 section. Tokens issued before deploy and the release order are both addressed and are
correct: the `access` seal format is unchanged and the backend goes first.

### Verdict: REFUTE

The architecture is sound. It keeps hashed family state on the backend, does a compare-and-swap rotation, cascades
deletes from the PAT, makes reuse delete the PAT, gives the refresh token its own seal kind, and binds it to client
and resource. Three statements are wrong or incomplete, however, and an implementer would build or test against
them.

### Change Requests

1. **"Backend unavailable means nothing rotated" is false for timeouts and for some 5xx, yet the spec makes it a
   SHALL.** D5 ("`429`/5xx/network/timeout -> `ServerError` ... and NOTHING rotates, so ... a retry works") and the
   `mcp-connector-oauth` delta (refresh requirement "`server_error` ... with nothing rotated, when the backend cannot
   be reached", and scenario "Backend unavailable": "answers `5xx` **or does not answer** ... the same refresh token
   still works on a later retry") both claim this.
   - If helio-mcp's fetch times out after the backend sent the rotate request, the backend transaction still
     commits. Nothing aborts it.
   - The same happens when a proxy or the request-timeout layer answers 5xx while the handler's future still
     completes (Cloud Run 504, or Pekko's request-timeout 503).
   - The client then retries with the now-rotated token. Under O4 (no grace) that retry is reuse, and it deletes
     the PAT.

   A fake-backend Jest test that returns 5xx before doing anything will pass and certify a guarantee the real
   system does not have.

   Required:
   - Restrict "nothing rotated, retry works" to failures where the request provably never reached the backend's
     commit: connection refused, DNS failure, and a backend 5xx/429 produced before the transaction.
   - State in the spec requirement, the scenario, D5 and Risks that a timeout or ambiguous 5xx is indeterminate: a
     retry may be treated as reuse and end the connection.
   - Rewrite the scenario so it names only the determinate case.

   Do NOT add an idempotent or deterministic-next-jti scheme. It would be a grace window, which O4 rules out, and it
   would hand an attacker who replays the old token the same new token.
2. **Reuse silently deletes a credential without an audit record.** Every other PAT deletion goes through
   `ApiTokenService.revoke`, which audits `token.revoke` (`ApiTokenService.scala:116-119`). D4 and the O3 section
   delete the `api_tokens` row inside the rotate transaction and only log an INFO line. This deletion is a security
   event: it means suspected token theft. The user sees the token vanish from Settings with no trace in
   `audit_events`.
   - Required: the reuse path SHALL write an audit event through the existing audit mechanism. Either reuse
     `token.revoke` with a distinguishing detail, or use a new action name stated in the design. Carry the family id
     and token id, and no token material.
   - Add it to the `mcp-refresh-token-families` "Rotation is atomic and reuse revokes the PAT" requirement, add a
     ScalaTest assertion (tasks 1.2), and add a mutation to 4.1.
3. **D3 leaves family-create responses other than 5xx/network unspecified.** D3 defines the fallback only for
   "5xx/network". The design does not say what the code exchange does when `POST /api/mcp-refresh-families` answers:
   - `401`: the PAT was revoked or expired between the callback and the exchange.
   - `403`: a scoped PAT, which cannot occur but is still a branch.
   - `429`, `400` or a timeout.

   One implementer would fail the exchange with `invalid_grant`. Another would issue tokens without a refresh
   token. The timeout case also has the CR1 problem: the family row may exist anyway, which is harmless but should
   be said.

   Required: give D3 an explicit status table, and a test per row in 1.1. The recommendation is:
   - `201`: issue the refresh token.
   - `401`: `invalid_grant` ("authorization was revoked; authorize again"), with no tokens, because the PAT is
     already dead.
   - Any other status, network error or timeout: issue tokens with no refresh token, plus one log line.

### Non-blocking notes

- **N1 Error-code attribution.** The refresh requirement says errors "SHALL follow RFC 6749 section 5.2" and then
  lists `invalid_target` (RFC 8707 §2) and `server_error` (not a token-endpoint code in RFC 6749 §5.2 or OAuth 2.1
  §3.2.4). The behaviour is fine, because the SDK emits `server_error` 500 for `ServerError`. Fix the wording to
  name the right sources.
- **N2 Sealed `resource` when the code exchange carries none.** `resource` is optional on both grants, but D2/D5
  seal `resource` and D5.3 requires the sealed value to equal the canonical one. Say explicitly that the canonical
  `config.resourceUrl` (in `comparableResource` form) is always the value sealed and stored, whether or not the
  client sent `resource`.
- **N3 `RlsPolicyGuardSpec` allowlist.** Add `"mcp_refresh_families" -> None` to `rlsTables` in task 2.1 or 1.2.
  The completeness check fails otherwise. That would be loud, but it belongs in the plan.
- **N4 Name the consequences of O1 and O4 in Risks** (this is not a challenge to them):
  - **Parallel refreshes.** A client that refreshes concurrently (two workers racing on an expired access token, a
    common client race) triggers reuse and loses its PAT.
  - **Hourly re-consent.** Clients registered without `refresh_token`, and every connection created while the D3
    fallback fires (including an MCP-first release), get 1-hour sessions. Each hourly re-consent mints a new 90-day
    PAT in Settings.

  Both are worth checking during HEL-1710 against claude.ai's actual behaviour.
- **N5 Token-endpoint rate limit.** The limit is 300 per 15 min per client IP. Refresh traffic rises from once per 90
  days to once per hour per connection, and hosted clients such as claude.ai egress from shared IPs. This is fine at
  beta scale, but record the arithmetic (about 1,200 refreshes an hour per egress IP) in Risks.
- **N6** The `mcp-connector-oauth` discovery requirement still says it is served "using the MCP SDK's auth router",
  but D1 serves the AS metadata from helio-mcp's own handler. Reword it to keep the spec exact.
- **N7** Family rows of expired PATs are never purged: they live until the PAT row is deleted. There is one row per
  consent, so growth is bounded. Mention it, or leave it.
