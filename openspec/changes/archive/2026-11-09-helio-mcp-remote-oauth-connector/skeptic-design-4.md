## Skeptic Report — design gate (round 4, skeptic-design-4.md)

I reviewed the planning artifacts at HEAD `afca73bc8ac9bf039937b2d21fcef459573a3650`. The change dir is untracked and no
implementation exists yet. I did not reopen Standing Constraints C1-C5. I read `skeptic-design-1..3.md` as claims and
re-derived what I rely on from the tree and the installed SDK 1.32.1.

### What I verified (with evidence)

**Artifacts.** `openspec validate helio-mcp-remote-oauth-connector --strict` reports the change is valid. There are no
TODO/TBD placeholders. The round-3 change requests are present in D3, D4, D7, tasks 2.3, 3.2, 4.1 and the OAuth spec.

**SDK 1.32.1 (`helio-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm`).**
- `server/auth/router.js`: `/authorize`, `/token`, `/register` and the metadata routes are mounted, with no global body
  parser. PRM is path-specific, so D6's explicit root PRM is needed. `checkIssuerUrl` allows localhost, so the local e2e is
  feasible. `/revoke` appears only if `revokeToken` exists.
- `handlers/authorize.js`: client and redirect are validated before `provider.authorize`; S256 is mandatory; an `OAuthError`
  becomes a redirect.
- `handlers/token.js`: client auth runs first (`client_id` in the form body), and PKCE runs before exchange.
- `handlers/register.js`: a secret is generated unless the method is `none`, which D3 handles by deleting it.
- `middleware/bearerAuth.js`: headers only, `expiresAt` in seconds, and `sameResource(undefined, …)` is false, which D3's
  omitted-`resource` binding handles.
- `webStandardStreamableHttp.js:486-487`: `parsedBody` bypasses the transport's own read. `:738`: `validateSession` is a no-op
  when stateless. `client/streamableHttp.js:116`: the SDK client accepts a 405 on GET.
- `require()` of `server/auth/router.js` and `server/streamableHttp.js` succeeds from `helio-mcp` (probe), and `pkce-challenge`
  has a `require` export. Root Jest can load them.

**Per-request binding.** `HelioHttpClient` holds its PAT per instance (`httpClient.ts`). The only `process.env` reads
outside `config.ts` are `context.ts:295` (a budget default). Module-level mutable state in `src` is the `AsyncLocalStorage`
scope only.

**Backend.** `POST`/`GET /api/tokens` is in the authenticated tree (`ApiRoutes.scala:1024`). The token name has no unique
constraint (`V42__api_tokens.sql`), so repeat connects cannot collide, and there is no per-user token cap in
`ApiTokenService.create`. `expiresInDays` only needs to be ≥ 1 (`RequestValidation.scala:124`). `confineScopedToken`
answers 403 for a scoped PAT outside `hooks` (`AuthDirectives.scala`), so D4's refusal holds.

**Frontend.** `AppRoutes.tsx`, `ProtectedRoute`, `PublicOnlyRoute`, `LoginPage`, `MfaVerifyPage` and `OAuthCallbackPage` match D7's
description. `MfaVerifyPage.tsx:38` navigates to `/home`, and `LoginPage.tsx:52-56` drops `from` on the MFA branch. `firebase.json`
sets no CSP and has no conflicting frame header.

**Deploy.** `deploy-backend.sh` confirms the `--image=` guard and region `us-west1`, and it caps `--max-instances=2`.

**New probe: gzip defeats the large-body slot (run twice, identical).** I ran an express 5.2.1 app using helio-mcp's own
`node_modules/express`, with D6's gate (`Content-Length > 8 MiB` or chunked takes a slot) followed by `express.json({limit:"32mb"})`:

```
200 {"slotTaken":false,"contentLength":30622,"parsedChars":31457280}
200 {"slotTaken":false,"contentLength":30622,"parsedChars":31457280}
```

A 30 KB `Content-Encoding: gzip` request inflates to 30 MiB and is parsed with no slot taken. `body-parser` 2.3.0 defaults to
`inflate: true` (`lib/utils.js:60`, `lib/read.js:184-217`).

### Verdict: REFUTE

The auth flow, sealing, per-request binding, sign-in round-trip plan and proof plan are sound against C1-C5, and I found no
OAuth conformance defect against the SDK. The remaining defects are in DoS and deploy bounds plus one security-control gap.
Only CR1's bypass was demonstrated by a probe. All four are small artifact edits.

### Change Requests

1. **The large-body bound does not hold (D6, D8, task 3.1, task 5.1a, transport spec "Request size and logging bounds").**
   - (a) D6 decides the slot from the wire size, but `express.json` applies its 32 MiB limit to the *inflated* body. Any signed-in
     user can send 30 KB gzip requests that each parse 30 MiB with no slot (probe above). Cloud Run's 32 MiB cap measures the
     compressed size, so it does not help. This directly breaks the spec's "Bodies over 8 MiB SHALL take one of [the] slots before
     parsing", and one OOM drops every user's in-flight requests on that instance.
     Required: state `express.json({inflate: false})` (a compressed body answers 415), or count any `Content-Encoding` other than
     `identity` as large, and add a task 3.3 test using a small gzip body that inflates past 8 MiB.
   - (b) D8's and task 5.1a's inequality, `idle + slots x peak < 75 %`, does not contain `--concurrency`, so the value it claims to
     derive is unconstrained. Bodies up to 8 MiB take no slot. With a concurrency of 80 (the backend's value), that is up to 640 MiB
     of raw bodies before parse overhead. Required: bound every admitted body, for example
     `idle + slots x peak(32 MiB) + (concurrency - slots) x peak(8 MiB) < 75 %`, and have task 5.1a measure the 8 MiB peak as well.

2. **No instance cap on a public, unauthenticated service (D8, task 5.2, deploy spec).** `max-instances` appears in none of the
   artifacts (grep: 0 hits in proposal, design, tasks and all specs). Cloud Run's default leaves scale-out far above anything intended.
   `infra/deploy-backend.sh` sets `--max-instances=2`.
   - C2's cost posture (request-based billing, min-instances 0) is open-ended without a cap, since `POST /mcp` needs no credential to
     incur a billable 401.
   - All of D3's per-IP limits (`express-rate-limit`, in-memory) and the used-code set are per instance, so the effective limits scale
     with instance count. CLAUDE.md documents the same multiplication for the backend limiter.
   - Each instance also adds backend liveness load against a backend capped at 2 instances.

   Required: D8, task 5.2 and the deploy spec set an explicit `--max-instances` (with the reasoning), and the README states the
   effective per-IP limit is the configured value times that cap. In the same edit, name the runtime identity: D8 and task 5.3 grant
   `roles/secretmanager.secretAccessor` but `service-account` has 0 hits, so as written the service runs as the project's default compute
   account. Require a dedicated `--service-account`, as `deploy-backend.sh` does.

3. **The redirect-host allow-list is enforced only at registration, and client ids never expire (D2, D3, task 2.1).** D3 applies
   `HELIO_MCP_ALLOWED_REDIRECT_HOSTS` in `registerClient` only, while D2 makes `client` seals permanent. A client registered while the
   list was unset or wider keeps working after the owner tightens it, and the only way to remove it is a key rotation, which drops every
   connector. The code default is open (Planner Notes). This list is the design's main defence against DCR phishing for an unscoped
   90-day PAT. Required: enforce the same check in `authorize` (or `getClient`) as well, and add a task 2.3 test where a client sealed
   under a wider list is refused after the list is narrowed.

4. **Spec and design contradict each other on what gets returned and sealed (OAuth spec "Authorization hands off…", D3, D4, task 2.2).**
   - The spec says the pending endpoint "returns **only** the client's display name … and redirect-URI host". D4 and task 2.2 also return
     `expiresAt`, which D7's re-check before minting depends on. An implementer or test following the spec literally breaks D7. Add
     `expiresAt` to the spec.
   - The spec says the pending request "SHALL carry the client id", and the callback code binds "client id". D3 says those seals carry
     SHA-256 of the client id. D4's code tuple and D3's access tuple read `clientId`. Use one wording, the hash, throughout.

### Non-blocking notes

- **Liveness on non-401 outcomes (D5).** Only a backend 401 is specified. State that 429, 5xx and network errors never produce the
  `invalid_token` 401: fail through to the tool call, or answer 503. Otherwise a backend restart forces a re-consent and a new unscoped PAT
  per connector. Give the check a timeout.
- **Importing `http.ts` from Jest (task 3.1).** `index.ts:12-14` records that its `import.meta.url` guard is why `createServer` lives in
  `server.ts`. An app factory in the same file as `main` hits the same problem. Put the factory in its own module.
- **`state` size.** `state` is sealed into pending with no cap, while the callback's parser limit is 16 KiB. An over-long state gives a body-parser
  error after the PAT is minted, with no page naming the token to revoke. Cap it at `/authorize`.
- **Dead `resource` field.** Pending carries `resource` but the code and access tuples do not, so `AuthInfo.resource` is effectively the
  configured constant. That is harmless with one resource. Either say so, or check the token-request `resource` as well.
- **Chunked requests.** If Cloud Run re-frames small requests as chunked, every request contends for a slot and ordinary calls could 429. I did not
  verify this. Add it to the post-deploy checks next to `req.ip`.
- **Service worker.** `pwaConfig.ts:58` does not deny `/connect/**`, so a returning user's navigation is served from the SW without Firebase's headers.
  A cross-site iframe gets a partitioned SW and the JS frame check remains, so this is low risk.
- **Consent page.** Show which account is signed in, give a fallback when `client_name` is absent, and guard Allow against a second click while
  the mint is in flight.
- **`HELIO_MCP_PUBLIC_URL`.** Validate it as an origin with no path or trailing slash.
- **Rotation.** `--set-secrets` replaces the whole set, so `deploy-mcp.sh` needs a way to include `_PREVIOUS`.
- **README wording (D6).** A 15 MiB CSV escaped at most 2x is 30 MiB, which fits. Per `index.ts:29-36`, only C0-heavy CSVs (6x) exceed 32 MiB, so
  "heavily quote/newline-escaped" is inaccurate.
