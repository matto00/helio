## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `afca73bc8ac9bf039937b2d21fcef459573a3650` (planning artifacts only, no code yet).
Standing Constraints C1-C5 were not reopened. Every finding below is about how the design implements them.

### What I verified (with evidence)

- **SDK claims hold.** `helio-mcp/node_modules/@modelcontextprotocol/sdk/package.json` is 1.32.1. `server/auth/router.js`
  has `mcpAuthRouter`, `getOAuthProtectedResourceMetadataUrl` and `mcpAuthMetadataRouter`. `provider.d.ts` has the
  `OAuthServerProvider` shape D3 implements (`challengeForAuthorizationCode`, `exchangeAuthorizationCode(client, code,
  verifier?, redirectUri?, resource?)`, `verifyAccessToken`). `express` 5.2.1 is installed.
- **DCR with a sealed client_id works.** `handlers/register.js` builds a random UUID `client_id` and, for non-`none`
  methods, a secret. It then calls `clientsStore.registerClient(clientInfo)` and returns whatever that returns, so
  overriding `client_id` and coercing to `none` is supported. `middleware/clientAuth.js` only demands a secret when
  `client.client_secret` is set.
- **The SDK checks the redirect URI before `provider.authorize`.** `handlers/authorize.js` phase 1 checks it with exact
  match, or any port for loopback hosts. PKCE `S256` is mandatory there (`code_challenge_method: z.literal('S256')`).
  `handlers/token.js` runs `challengeForAuthorizationCode` and `verifyChallenge` before `exchangeAuthorizationCode`.
- **Bearer enforcement emits the 401 and `WWW-Authenticate`.** `middleware/bearerAuth.js` builds the header with
  `resource_metadata`. It rejects a token with no numeric `expiresAt`, so D3 must set `expiresAt`, and it does.
- **405 for GET is spec-compliant.** MCP Streamable HTTP lets a server without a server-initiated SSE stream answer GET
  with 405. Stateless mode with no cross-instance store is a sound reason. Accepted.
- **A PAT may call `GET /api/tokens`.** `ApiTokenRoutes.scala` mounts it in the authenticated block with no PAT
  exclusion. `AuthDirectives.requireCsrfHeader` (line 179) passes every GET. A scoped PAT is confined to
  `/api/hooks/*` by `confineScopedToken`, so it gets a non-200 at the callback. That is acceptable.
- **Per-request binding is feasible.** `HelioHttpClient` takes `{baseUrl, pat}` per instance (`httpClient.ts:187`).
  The rate-limit scope is an `AsyncLocalStorage` (`httpClient.ts:116`), so nothing user-scoped is process-global.
  `Protocol._onclose` (`shared/protocol.js:252`) aborts in-flight handlers, so "close both on res close" cancels tool
  calls on disconnect.
- **ProtectedRoute and query preservation.** `ProtectedRoute.tsx` passes `state={{from: location}}`. `LoginPage.tsx`
  rebuilds `pathname+search+hash` for a password login. The Google path stashes it via `rememberReturnTo`. **The MFA
  path loses it** (CR5).
- **Framing protection.** `frontend/firebase.json` sets only `Cache-Control` headers. A repo-wide grep (excluding
  `node_modules`, `.claude`, `openspec`) found no `Content-Security-Policy`, `frame-ancestors`, `X-Frame-Options` or
  `form-action`. So helioapp.dev can be framed today, and nothing blocks the consent page's cross-origin form POST (CR1).
- **PAT expiry and name.** `ApiTokenService.create` sets `expiresAt = now + days` at mint time. `ApiTokenResponse`
  has no "this is the calling token" marker. `RequestValidation.MaxApiTokenNameLength = 100` (line 117).
- **Redirect URI schemes.** `shared/auth.js` `SafeUrlSchema` rejects only `javascript:`, `data:` and `vbscript:`, so
  plain `http://` on a non-loopback host registers.
- **Root PRM variant.** `mcpAuthMetadataRouter` serves only `/.well-known/oauth-protected-resource<rsPath>`. With
  `resourceServerUrl=/mcp` the root variant the spec requires is not served by the SDK.
- **Revoked-PAT message.** `HelioAuthError` (`httpClient.ts:82-83`) says "Mint a fresh token via POST /api/tokens and
  update HELIO_PAT".
- **Test runner.** Root `jest.config.cjs` collects `helio-mcp/src/**` tests under ts-jest with NodeNext and ignores
  `/e2e/`. So "jest, existing config" (D9) is accurate, and `e2e/oauthConnector.ts` is a script, not a suite member.

### Verdict: REFUTE

The architecture is sound and implements C1-C5 faithfully. But the plan leaves two concrete security holes, one DoS
and sizing gap, two spec-vs-design contradictions, and one MCP-spec MUST unaddressed. Each is cheap to fix in the
artifacts now and expensive to discover in a final-gate cycle.

### Change Requests

1. **Consent clickjacking (security, must fix).** The consent page turns one click into an unscoped 90-day PAT. That
   PAT is delivered, sealed in a code, to a redirect URI that anyone can register through DCR. helioapp.dev sends no
   `frame-ancestors`/`X-Frame-Options` (`frontend/firebase.json`; no CSP anywhere). Prod's session cookie is
   `SameSite=None`, so a framed page is signed in.

   The attack: an attacker registers `redirect_uri=https://attacker.example/cb` and starts `/authorize` with their
   own PKCE verifier. They frame `/connect/mcp?request=<their pending>` invisibly and get the victim to click Allow.
   They then exchange the code and hold the victim's workspace. The redirect-host display does not help when the
   page is invisible. RFC 6749 §10.13 and RFC 9700 require the authorization server to prevent framing of the
   authorization UI.

   Add to D7 and tasks 4.2/4.3/5.x:
   - (a) a `firebase.json` header for at least `/connect/**`: `Content-Security-Policy: frame-ancestors 'none'` plus
     `X-Frame-Options: DENY`. Verify that Firebase applies it to the rewritten SPA path, and record how.
   - (b) an in-page guard: when `window.top !== window.self`, render an error and no Allow action, with a jest test.
   - (c) the same headers on helio-mcp's own HTML responses (callback error page).

2. **Unauthenticated 64 MiB buffering, and instance sizing (DoS, must fix).** D6 and task 3.1 list `express.json({limit:
   "64mb"})` and `requireBearerAuth` on `/mcp` with no ordering. If the parser runs first, any anonymous caller makes
   the instance buffer and parse up to 64 MiB. Fix:
   - (a) State that `requireBearerAuth` runs before body parsing on `/mcp`. Add a test that an oversized
     unauthenticated POST gets `401`, not `413`, and add it to the spec's 401 requirement.
   - (b) Size the deploy from measurement. D8 deploys `--memory=512Mi --concurrency=80` while one max request holds
     the raw buffer, the decoded string, the parsed object and the re-serialized outbound body. Measure peak RSS for
     one ~60 MiB `create_csv_data_source` over HTTP. Then set `--memory` and `--concurrency`, or add an in-flight cap
     for large bodies, from that number, and record it in design.md. This mirrors how `DRAFT_PREVIEW_MAX_IN_FLIGHT`
     was sized.

3. **Access-token expiry: the spec contradicts the design.** The `mcp-connector-oauth` spec says the access token
   expires "no later than the PAT's own". D3 sets `exp = code issue time + 90 d`, which is seconds after the PAT's
   `expiresAt` (mint time + 90 d, `ApiTokenService.create`). The callback also accepts any PAT, including a 1-day or
   non-expiring one, and cannot learn that PAT's expiry: `GET /api/tokens` lists every token with no "self" marker.
   Pick one and make spec, design and tests agree:
   - (a) Reword the requirement to the real guarantee: a fixed maximum lifetime, with earlier PAT expiry or
     revocation handled at first use per CR4.
   - (b) Add a real mechanism that bounds the token by the PAT's actual expiry.

4. **The revoked/expired-PAT path is not specified or tasked.** D5 says a revoked PAT surfaces "as a tool error
   telling the user to reconnect". The existing `HelioAuthError` text (`httpClient.ts:82-83`) says to update
   `HELIO_PAT`, which is wrong in HTTP mode, and C4 freezes stdio behaviour. Name the mechanism and add a task and a
   test. One option is an HTTP-mode-only error mapping that leaves stdio's message byte-identical. Better, and closer
   to the MCP authorization spec: answer the `/mcp` request with `401` + `WWW-Authenticate` when the backend returns
   401 for the bound PAT, so the connector re-authorizes on its own instead of failing every tool call until the user
   notices. Either way, decide it in design.md.

5. **The login round-trip breaks for MFA users.** `LoginPage.tsx` navigates to `/login/verify` without carrying
   `from`, and `MfaVerifyPage.tsx:38` always navigates to `/home`. An MFA-enabled user who reaches `/connect/mcp`
   signed out lands on `/home`, and the connector flow dead-ends. That violates the consent-page spec scenario
   "Signed-out user". Make task 4.1 name every sign-in path: password, password+MFA, Google (via
   `rememberReturnTo`/`OAuthCallbackPage`), and Google+MFA if that combination exists. Add a jest test per path. Make
   task 6.2's Playwright pass start signed out, so the real round-trip is proven, not assumed.

6. **Redirect URIs must be HTTPS or loopback (MCP authorization spec MUST).** The SDK's `SafeUrlSchema` accepts
   `http://attacker.example/cb`, which would deliver the PAT-bearing code over plaintext. `registerClient` must reject
   any redirect URI that is neither `https:` nor a loopback `http:` host (`localhost`, `127.0.0.1`, `[::1]`) with
   `InvalidClientMetadataError`. Add the requirement to the spec and a test to 2.3.

7. **The PAT name overflows the backend cap.** `"MCP connector: <clientName> (<redirectHost>)"` uses a DCR-supplied,
   unbounded `client_name`. The backend rejects names over 100 characters (`RequestValidation.scala:117`), so Allow
   fails with a 400 for a long name. Specify truncation (and control-character stripping) on both the display and the
   minted name, and add a test with a 200-character client name.

8. **The root PRM variant is not covered by any task.** The spec requires both
   `/.well-known/oauth-protected-resource/mcp` and the root variant. `mcpAuthMetadataRouter` only serves the
   path-suffixed one when `resourceServerUrl` is `/mcp` (`router.js`). Add an explicit root route to task 3.1 and
   assert both in 3.3.

9. **Consent page shell is ambiguous (design judgment).** D7 puts the route "under ProtectedRoute" but does not say
   whether it renders inside `AppShell` (sidebar and nav, where every other protected route lives) or as a standalone
   card like `/login`. A competent implementer could do either. The final gate will judge it against DESIGN.md, so
   decide it now. Recommendation: under `ProtectedRoute` but outside `AppShell`, reusing the `auth-page`/`auth-card`
   layout, since an OAuth consent screen is a focused interstitial.

### Non-blocking notes

- The SDK applies per-IP rate limits: `/register` 20/h and `/token` 50/15 min. Calls from claude.ai's servers share
  egress IPs across all users. That is fine for an owner-only rollout, but document it, and set
  `clientRegistrationOptions`/`tokenOptions` deliberately rather than inheriting them.
- OAuth 2.1 clients may omit `redirect_uri` at the token endpoint. Compare it only when supplied (the SDK passes
  `undefined`), or state why strict is safe for the SDK client and claude.ai.
- Consider checking `resource`, when supplied, against `<HELIO_MCP_PUBLIC_URL>/mcp` at `/authorize` and `/token`
  (RFC 8707). Only this server can open the tokens, so audience is already implicit.
- The request log must use `req.path`, not `req.originalUrl`. Cloud Run's own access log will still record
  `/oauth/pending?request=` and `/authorize?...`. Those are sealed and carry no PAT, so this is acceptable, but say so
  in the README's security notes.
- The AS metadata from `createOAuthMetadata` advertises `refresh_token` and `client_secret_post` even though neither
  is used. That is harmless, but a test asserting the metadata should not codify it as intentional.
- README: document the `roles/secretmanager.secretAccessor` binding for the service's runtime service account, and
  choose a `--timeout` that covers the HEL-1381 per-tool wait budget.
- Each reconnect mints a new unscoped 90-day PAT, and old ones stay valid. Mention it in the README's revoke section.
- Task 4.4 refers to a "frontend env docs/example", but `frontend/` has no `.env.example`. Name the actual doc to
  update.
