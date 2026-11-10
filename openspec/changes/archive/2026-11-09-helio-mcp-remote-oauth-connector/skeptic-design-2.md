## Skeptic Report — design gate (round 2, skeptic-design-2.md)

I reviewed the planning artifacts at HEAD `afca73bc8ac9bf039937b2d21fcef459573a3650`. The change dir is untracked and
there is no code yet. I did not reopen Standing Constraints C1-C5. Every finding below is about how the design
implements them. I checked each claim against the tree and the installed SDK, not against the artifacts' wording.

### What I verified (with evidence)

**Round-1 change requests: all nine are addressed in the artifacts.**
- CR1 (anti-framing): D4a and task 4.2a.
- CR2 (auth before body, plus sizing): D5 order, D8 measurement, task 5.1a.
- CR3 (lifetime wording): D3 and the spec.
- CR4 (revoked PAT): D5 liveness check plus the HTTP-only hint.
- CR5 (MFA round trip): D7 and task 4.1.
- CR6 (https or loopback redirect URIs): D3 and the spec.
- CR7 (name truncation): D7 and task 4.2.
- CR8 (root PRM): D6 and task 3.1.
- CR9 (page shell): D7.

The round-1 non-blocking notes are also folded in: explicit per-IP limits, redirect_uri checked only when supplied,
the `resource` check, `req.path` logging, metadata tests, the README items and `docs/deployment.md`.

**SDK 1.32.1 (`helio-mcp/node_modules/@modelcontextprotocol/sdk`): the design's claims hold.**
- `server/streamableHttp.js` is now a Hono wrapper (`getRequestListener`) over `webStandardStreamableHttp.js`.
- A `parsedBody` passed to `handleRequest` skips `readRequestBody` and its 4 MiB `DEFAULT_MAX_REQUEST_BODY_SIZE`
  (`webStandardStreamableHttp.js:486-491`). So `express.json({limit:"64mb"})` followed by `req.body` works as D1/D5
  intend.
- Stateless reuse throws (`:176-177`), which matches "one transport per request".
- `MAX_BATCH_SIZE` is 100.
- `mcpAuthRouter` mounts no global body parser: each handler has its own `urlencoded`/`json`. So `/mcp` sees an
  unread body until D5's `express.json`, and "401 before buffering" is achievable.
- `requireBearerAuth` compares `expiresAt < Date.now()/1000`, so `expiresAt` is in **seconds**. It also offers an
  `expectedResource` option.
- `authorize.js` checks the client and redirect before `provider.authorize`, with port relaxation only for loopback.
  It also passes `resource` as a `URL`.
- `token.js` runs PKCE before `exchangeAuthorizationCode(client, code, undefined, redirect_uri, resource)`.
- `InvalidTargetError` exists in `errors.js`.
- `checkIssuerUrl` allows `http://localhost`, so the in-lane e2e is feasible.

**DCR, client authentication and per-request binding.**
- `register.js` generates `client_secret` plus a 30-day `client_secret_expires_at` *before* calling
  `registerClient`, for every method except `none`, including an omitted method.
- `clientAuth.js` demands and compares a secret whenever `client.client_secret` is set, and enforces its expiry.
- `HelioHttpClient` is per-instance (`httpClient.ts:187-189`). The only module-level mutable state in
  `helio-mcp/src` is the `AsyncLocalStorage` rate-limit scope (`httpClient.ts:116`). The only `process.env` read
  outside `config.ts` is a budget default (`context.ts:295`), so per-request user binding is sound.
- No tool reads the filesystem or fetches an arbitrary URL. The only `fetch` is `httpClient.ts:166`, so the public
  service does not gain LFI or SSRF.
- `HelioAuthError` text is at `httpClient.ts:83-84`. `create_content_panel` exists (`tools/placements.ts:74`).
  `RATE_LIMIT_WAIT_BUDGET_MS` is 30 s.

**Backend.**
- `ApiTokenRoutes.scala` (`post`/`get`/`delete`) is mounted in the authenticated block, and its doc comment says a
  PAT may call it.
- `RequestValidation.scala:117-125` sets the name limit to 100 on `trim.length`, and `expiresInDays` must be ≥ 1.
- `CreateApiTokenRequest` carries `scopedPipelineIds`, so scoped PATs exist. D4 refusing them via `GET /api/tokens`
  stands.
- The existing `helio-mcp/e2e/connector-authoring.ts` already registers throwaway users through
  `POST /api/auth/register`, so the e2e's second user is feasible.

**Frontend.**
- `ProtectedRoute` passes `state={{from: location}}`.
- `LoginPage.tsx:51-56` sends MFA users to `/login/verify` without `from`. `MfaVerifyPage.tsx:38` navigates to
  `/home`.
- `OAuthCallbackPage.tsx:37-38` routes Google+MFA to `/login/verify` without consuming the stashed return-to. So
  Google+MFA **does exist**, and the fix must read from both `state.from` and `consumeReturnTo()`.
- `PublicOnlyRoute` (`<Navigate to="/home">` once `status==="authenticated"`) wraps `/login`, `/login/verify` and
  `/register` (`AppRoutes.tsx:90-94`). `verifyMfa.fulfilled` sets `status="authenticated"` and `mfaChallenge=null` in
  the same reducer (`authSlice.ts:322-326`). `MfaVerifyPage` renders `<Navigate to="/login">` when `mfaChallenge` is
  null.
- The existing `LoginPage.test.tsx:40-79` deep-link test mounts `LoginPage` **without** `PublicOnlyRoute` (see
  CR3).
- `firebase.json` already applies a `regex ^[^.]*$` header to rewritten SPA paths. That is in-repo evidence that
  Firebase `headers` match the request path before the `**` rewrite, which supports D4a(a).
- `cd-frontend.yml` already injects `VITE_*` env, and `docs/deployment.md` exists.

**Deploy and build.**
- `deploy-backend.sh:85` has the `--image=` guard that D8 mirrors.
- helio-mcp is self-contained: its own `package-lock.json`, no `../../` imports, and `tsconfig.typecheck.json`
  includes `e2e/**`. A `helio-mcp/` Docker build context is viable.
- `express` 5.2.1 is installed. `@types/express` is not, and task 3.2 adds it.

### Verdict: REFUTE

The round-2 design is close and implements C1-C5 faithfully. Three defects remain that would ship either a broken
promise or an unproven path. Two more ambiguities would let a competent implementer build a connector that silently
breaks weeks after deploy. All five are cheap to fix in the artifacts now.

### Change Requests

1. **The 64 MiB body limit cannot hold on the chosen deploy (D5/D8, task 5.1a, spec "Request size and logging
   bounds").** Cloud Run documents a maximum request size of 32 MiB for HTTP/1 requests. There is no cap only with
   end-to-end HTTP/2 (`--use-http2`), which requires the container to serve h2c, and plain express does not. As
   designed, any `/mcp` body between 32 and 64 MiB gets a 413 from Google's front end, which helio-mcp never sees. The
   largest legitimate payload helio-mcp forwards is a heavily escaped 15 MiB CSV, up to ~60 MiB per the comment at
   `index.ts:27-36`. It falls in that gap.

   That breaks two things:
   - the spec's promise that `/mcp` accepts bodies "up to 64 MiB, matching the stdio buffer";
   - task 5.1a's sizing, which is measured at a ~60 MiB request the service can never receive.

   Confirm the limit from Cloud Run's quotas doc and record it. Then pick one option and make spec, design, task 5.1a
   and the README agree:
   - (a) State the effective HTTP limit is 32 MiB in prod. Size the measurement at that limit. Document in the README
     which CSVs fail (heavily escaped CSVs over ~32 MiB of JSON), and that the 413 comes from the platform, not
     helio-mcp.
   - (b) Serve h2c and deploy with `--use-http2`, with evidence that the SDK/Hono path works over it.

2. **Double-click clickjacking on the consent page (D4a/D7, tasks 4.2 and 4.3).** `frame-ancestors`/XFO plus the
   `window.top` guard close iframe clickjacking. They do not close the popup or new-window variant ("double-clickjacking",
   publicly described against OAuth consent screens in late 2024).

   The attack:
   - The attacker page opens `/connect/mcp?request=<attacker pending>` in a new window timed under the user's
     double-click.
   - The second click lands on Allow before the user has seen the page.
   - The prize is the same as round-1 CR1: an unscoped 90-day PAT delivered to an attacker-registered redirect URI.

   The fix is cheap. Keep Allow inert until the page has been visible and focused for a short interval (for example
   ≥ 500 ms after `visibilitychange`/`focus`, reset on blur). Specify it in D7. Add a jest test: an immediate click
   mints nothing; a click after the interval mints once.

3. **The sign-in round-trip proof cannot see the real race (task 4.1 and 6.2, consent-page spec "Signed-out user with
   MFA").** In the real route tree, a successful `verifyMfa` triggers three navigations in the same render cycle:
   - `PublicOnlyRoute` renders `<Navigate to="/home">`, because status is now `authenticated`;
   - `MfaVerifyPage` renders `<Navigate to="/login">`, because `mfaChallenge` is now null;
   - the handler calls `navigate(from)`.

   Which one wins is an empirical question. The existing pattern (`LoginPage.test.tsx:40-79`) mounts the page
   without `PublicOnlyRoute`, so "a jest test per path" written that way would pass while prod lands on `/home`. Task
   6.2's single Playwright pass doesn't say which path it covers, and no e2e MFA helper exists. Require both of:
   - (a) every per-path jest test mounts the page under the real `PublicOnlyRoute`/`ProtectedRoute` wrappers, as in
     `AppRoutes.tsx`, and asserts the final location is `/connect/mcp?request=...`;
   - (b) at least the password+MFA path is driven in a real browser. Enable MFA for a throwaway user via the API and
     compute the TOTP in the test, or record why that is infeasible and what replaces it.

   Without (a) and (b), the MFA scenario in the spec is asserted, not proven.

4. **Client registration is underspecified in two ways that break connectors silently (D2/D3, tasks 1.1, 2.1 and
   2.3).**
   - (a) **Client-id expiry.** D2 says every sealed payload carries `exp` and `open()` enforces it. D3 never gives the
     `client` kind a lifetime. An implementer who applies a uniform `exp`, as D2 literally says, makes every
     registered connector `invalid_client` at `/authorize` after that time. There is no evidence that claude.ai
     re-registers when that happens. State that `client` seals do not expire (or give a justified bound), and test it.
   - (b) **Coercing to `none`.** For any method other than `none`, including an *omitted* `token_endpoint_auth_method`
     (RFC 7591's default is `client_secret_basic`), `register.js` has already put a `client_secret` and a 30-day
     `client_secret_expires_at` into `clientInfo` before `registerClient` runs. If the provider only rewrites the
     method name, the sealed client keeps a secret. `clientAuth.js` then demands that secret at `/token` and refuses
     it after 30 days ("Client secret has expired").

     Specify that `registerClient` deletes `client_secret` and `client_secret_expires_at` and returns
     `token_endpoint_auth_method: "none"`. Add a test that a registration with the method omitted (and one with
     `client_secret_post`) returns no secret and completes `/token` without one. The e2e (D9) controls its own
     registration metadata, so it will otherwise only ever exercise `none`.

5. **The e2e cannot observe "PAT revoke → 401" as specified (task 6.1, D5).** The liveness cache is fresh for 5
   minutes after the first `/mcp` call. Revoking the PAT and calling again within the e2e therefore yields D5's
   *tool-error* path, not a 401, unless the TTL can be set. Nothing in D6/`loadHttpConfig` makes it configurable.
   - Either add an env override (for example `HELIO_MCP_LIVENESS_TTL_SECONDS`, validated, default 300) that the e2e
     sets low,
   - or change task 6.1 to assert both outcomes in sequence: a tool error inside the window, then a 401 once the
     window has passed.

   Otherwise the executor will either skip the step or wait 5 minutes and not say so.

### Non-blocking notes

- Seal a minimal projection into `client_id`: `redirect_uris`, `client_name` (truncated), the method and grant types.
  Do not seal the whole DCR body. `register.js`'s `express.json()` accepts up to 100 kb, so the whole body could
  produce an unusably long id in a GET `/authorize` URL. Cap the projection's size.
- Compare `resource` the way the SDK's `bearerAuth` does, ignoring the fragment and one trailing slash. Otherwise
  `https://mcp.helioapp.dev/mcp/` from a client is an `invalid_target`. Consider also passing `expectedResource` to
  `requireBearerAuth` and setting `AuthInfo.resource`.
- D3 should say `expiresAt` is in seconds. A milliseconds value would make every token pass the SDK's expiry check
  forever. D2's own `exp` check makes the tests catch it, but say it.
- An Allow whose callback then fails (pending expired during a slow MFA login, PAT rejected) leaves an unused,
  unscoped 90-day PAT. Re-check the pending request's expiry just before minting. Have the callback's error page name
  the token to revoke.
- Install an explicit express error handler on the HTTP app. Express's default `finalhandler` prints `err.stack` to
  stderr outside `NODE_ENV=test`. A body-parser `SyntaxError` on Node 22 quotes a snippet of the body, which would
  break the spec's "no request body in logs". Set `NODE_ENV=production` in the Dockerfile as well.
- Consider an allow-list of redirect hosts (for example `HELIO_MCP_ALLOWED_REDIRECT_HOSTS=claude.ai,claude.com` plus
  loopback) for an owner-only rollout. The redirect-host display is the only defence against DCR phishing for an
  unscoped PAT. This needs owner input, not an executor call.
- `/oauth/pending` and `/oauth/callback` have no rate limit. Each callback POST costs one backend call, and the
  backend does not rate-limit invalid credentials (HEL-837). That is not an amplification, but a modest per-IP limit
  is cheap.
- Key rotation that drops `_PREVIOUS` invalidates every sealed `client_id` too, not only tokens. Say so in the README
  rotation steps.
- Use `cors` (already an SDK dependency) or a hand-written header for `/oauth/pending`. If you use the package,
  declare it directly like `express`.
- Confirm on deploy that `trust proxy 1` makes `req.ip` the real client behind Cloud Run with a domain mapping. If it
  doesn't, every user shares one per-IP bucket.
