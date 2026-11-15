## Skeptic Report — design gate (round 3, skeptic-design-3.md)

I reviewed the planning artifacts at HEAD `afca73bc8ac9bf039937b2d21fcef459573a3650`. The change dir is untracked and
there is no implementation yet. I did not reopen Standing Constraints C1-C5. Each item below was checked against the
tree and the installed SDK 1.32.1 (`helio-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm`). I read the code and
ran no probes or test suites, because nothing is implemented at this gate.

### What I verified (with evidence)

**Round-2 change requests are all addressed in the artifacts.**
- CR1, 32 MiB limit: D6, task 5.1a and the transport spec agree.
- CR2, double-click: D4a(c), task 4.2/4.3 and the consent spec.
- CR3, real route wrappers plus a browser MFA path: task 4.1, task 6.2, D9.
- CR4, client seals never expire and the secret is deleted: D2, D3, task 2.3, the OAuth spec.
- CR5, liveness TTL: D5, D6, task 6.1.

**SDK claims hold.**
- `server/auth/router.js`: `mcpAuthRouter` mounts `/authorize`, `/token`, `/register` and the metadata routes, and adds no
  global body parser. PRM is path-specific, so the design's explicit root PRM is needed. Handler options accept
  `rateLimit` overrides. `/revoke` appears only if the provider implements `revokeToken`.
- `handlers/authorize.js`: the client and redirect are validated before `provider.authorize`; `S256` is required; `resource`
  is optional and passed as a `URL`; an `OAuthError` from `provider.authorize` becomes a redirect.
- `handlers/token.js`: `authenticateClient` runs first and needs `client_id` in the form body; PKCE runs before exchange.
- `handlers/register.js`: a secret is generated before `registerClient` unless the method is `none` (D3 handles this).
- `middleware/bearerAuth.js`: reads headers only, `expiresAt` is in seconds, and with `expectedResource` set,
  `sameResource(undefined, …)` is false (see CR1).
- `server/streamableHttp.js`: `handleRequest(req, res, parsedBody)` passes `parsedBody` through.

**Per-request binding is sound.** `HelioHttpClient` holds its PAT per instance (`httpClient.ts:187-189`). Module-level
mutable state in `helio-mcp/src` is only the `AsyncLocalStorage` scope (`httpClient.ts:116`).

**Backend.** `GET /api/tokens` sits in the authenticated tree. `confineScopedToken` (`AuthDirectives.scala:141`) answers
403 for a scoped PAT on any path but `hooks`, so D4's scoped-PAT refusal holds.

**Frontend.** `firebase.json` and `index.html` set no CSP, so neither the cross-origin fetch nor the form POST is blocked.
The `^[^.]*$` header rule on rewritten paths supports D4a(a). The route tree, `ProtectedRoute` and the return-to helpers
match D7. `/connect/**` does not match `/connectors/...`.

### Verdict: REFUTE

The design is close and implements C1-C5 faithfully. Four defects remain. CR1 and CR3 are failures the planned proof
would miss or only catch late, and CR1 could surface only on claude.ai, after merge, because C3 defers that check.
All four are small artifact edits.

### Change Requests

1. **A token issued without `resource` is unusable forever (D3, task 2.1/2.3, OAuth spec).** D3 accepts `resource` "when
   supplied", seals it into the pending request, returns `AuthInfo{…, resource}`, and passes `expectedResource` to
   `requireBearerAuth`. For a client that omits `resource`, `AuthInfo.resource` is undefined. `sameResource(undefined, expected)`
   returns false (`bearerAuth.js`), so every `/mcp` call gets 401 `Token was not issued for this resource`, and re-authorizing
   produces the same result: an endless sign-in loop.

   The SDK's own client omits `resource` when PRM is unavailable (`client/auth.js:424`, `selectResourceURL`), so the parameter
   is genuinely optional. The planned e2e cannot see this, because its SDK client discovers PRM and always sends `resource`.
   Whether claude.ai always sends it is unverified in-lane (C3).

   Required: state in D3 and the OAuth spec that an omitted `resource` binds the token to the canonical
   `<HELIO_MCP_PUBLIC_URL>/mcp`, so `AuthInfo.resource` is always set. Add a test to task 2.3/3.3: full flow without
   `resource`, then `/mcp` succeeds.

2. **Attacker-controlled text reaches server-rendered HTML with no escaping requirement (D4, task 2.2, OAuth spec).** D4's
   error pages name the minted token ("revoke 'MCP connector: …'"), which is built from `client_name` and the redirect host.
   `client_name` comes from unauthenticated DCR. D3 only strips control characters and cuts to 40 chars, and 40 chars fits a
   `<script src=…>` tag. Those pages get only anti-framing headers, so script would run on `mcp.helioapp.dev`, the origin that
   receives PATs by form POST.

   Required: D4 and the spec must state that every dynamic value in helio-mcp's HTML is HTML-escaped, and that those pages
   send a restrictive CSP (`default-src 'none'` plus `frame-ancestors 'none'`). Add a test in task 2.3: a `client_name` of
   `<script>alert(1)</script>` appears escaped on the error page.

3. **The consent page's cross-origin fetch is underspecified in a way only a real browser catches (D4, D7, task 4.1).** D4 says
   `/oauth/pending` is CORS-restricted with "no credentials". Task 4.1 says only "service (`fetchPendingInfo`)". The repo's
   HTTP service pattern is the shared `httpClient`, which sets `withCredentials: true` and a custom CSRF header
   (`frontend/src/services/httpClient.ts:13-18`), and it carries the global 401 interceptor. An implementer following that
   pattern gets a browser CORS rejection, because the response has no `Access-Control-Allow-Credentials`. Mocked jest tests
   stay green. Task 6.2 would catch it only if it is not recorded as infeasible and replaced.

   Required: D7 and task 4.1 must state that `fetchPendingInfo` does not use `httpClient`: a plain request with credentials
   omitted and no custom headers, to `${VITE_MCP_ORIGIN}/oauth/pending`.

4. **Tasks do not match the design on dependencies (task 3.2 vs proposal and the D3 note).** The proposal and Planner Notes say
   `express`, `cors` and `express-rate-limit` are declared directly. Task 3.2 declares only `express` and `@types/express`.
   `@types/cors` is not installed (`helio-mcp/node_modules/@types/cors` is absent), while `tsconfig.typecheck.json` covers this
   code. Required: task 3.2 must list all three packages and `@types/cors` as a dev dependency.

### Non-blocking notes

- `helio-mcp/src/index.ts` installs `installUnhandledRejectionGuard`, but D6 does not mention it for `http.ts`. On a shared
  multi-user process an unhandled rejection takes down every in-flight request. Install it in `main` there too.
- `CreateApiTokenRequest` (`frontend/src/features/settings/types/apiToken.ts`) has only `name`, and its comment says the UI never
  sends `expiresInDays`. Task 4.2 needs the type extended and that comment corrected.
- `VITE_MCP_ORIGIN` should be read through `frontend/src/config/env.ts`, which Jest maps to `envMock.ts`, so the unconfigured-origin
  test can control it.
- The sealed `client_id` (up to about 2.8 KiB encoded at the 2 KiB cap) is nested in the pending, code and access seals. A maximal
  client gives a code of about 5 KiB in a redirect URL. Typical clients are far smaller. Sealing a hash of the client id would avoid it.
- The SDK's AS metadata advertises `refresh_token` and `client_secret_post`, neither of which this server honours. A refresh attempt
  gets `invalid_grant` and the client should re-authorize. Task 3.3 rightly avoids codifying this; the follow-up claude.ai check should
  watch it.
