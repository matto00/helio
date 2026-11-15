## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD `afca73bc8ac9bf039937b2d21fcef459573a3650`. The change dir is untracked and nothing is implemented yet.
I did not reopen C1-C5. I read `skeptic-design-1..4.md` as claims and re-derived what I rely on from the tree and the
installed SDK. Probes were read-only and ran in the session scratchpad under `nice -n 19`. No `.env` file was read.

### What I verified (with evidence)

**Artifacts.** `openspec validate helio-mcp-remote-oauth-connector --strict` reports valid. No TODO/TBD. Each round-4 change
request is present:
- CR1a: any non-identity `Content-Encoding` takes a slot (D6, task 3.1/3.3, transport spec).
- CR1b: the memory inequality includes concurrency (D8, task 5.1a).
- CR2: `--max-instances=2` and a dedicated service account (D8, task 5.2, deploy spec).
- CR3: the allow-list is re-applied in `authorize` (D3, task 2.1/2.3, OAuth spec).
- CR4: `expiresAt` and the client-id-hash wording agree across D3, D4 and the spec.

**SDK 1.32.1 (`helio-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm`, version from its `package.json`).**
- `server/auth/handlers/authorize.js`: client and redirect are validated first, S256 is mandatory, and `resource` is optional.
  There is **no scope check against the client**, so sealing a projection without `scope` cannot produce `invalid_scope`.
  Loopback redirects get port relaxation only. An `OAuthError` from `provider.authorize` redirects to the redirect URI, so the
  allow-list refusal never reaches the consent page. `InvalidTargetError` exists (`errors.js:143`).
- `handlers/register.js`: the secret is generated unless the method is `none`, then `registerClient`'s return value is what is
  served, so D3's rewrite of `client_id` and deletion of the secret take effect.
- `middleware/clientAuth.js`: no stored secret means none is checked, so a client that still sends one is unaffected.
- `handlers/token.js`: client auth, then PKCE, then exchange. `router.js`: `token_endpoint_auth_methods_supported` includes
  `none`; PRM is path-specific only, so D6's root PRM is needed; `/revoke` mounts only if `revokeToken` exists.
- `middleware/bearerAuth.js`: headers only; `sameResource(undefined, …)` is false, which D3's omitted-`resource` binding handles;
  `expiresAt` is required and in seconds.
- `shared/protocol.js:263`: `_onclose` aborts in-flight handlers, so D1's close on `res` close feeds the HEL-1381 abort path.

**Per-request binding.** `HelioHttpClient` holds its PAT per instance (`httpClient.ts`). `createServer` has no module-level user
state, and the only `process.env` read outside `config.ts` is a budget default (`context.ts:295`). There are no `fs` or
`child_process` imports in `helio-mcp/src`, so going remote exposes no server filesystem. No elicitation, sampling or
server-initiated notification use (grep: 0 hits), so stateless JSON mode loses nothing.

**Per-request cost (probe, run twice).** 30 `createServer` calls over the 76 real tools: median 1.26 ms and 1.25 ms, first call
5.3 ms and 5.9 ms, about 1.4 MB heap each. One server per request is affordable.

**Deadlines.** The 429 budget is 30 s (`httpClient.ts:107`), well inside `--timeout=300`.

**Backend.** `ApiTokenRoutes.scala` has no tier or step-up gate on `POST`/`GET /api/tokens`. `RequestValidation.scala:120-125`
checks the name length and `expiresInDays >= 1`. `MfaRoutes.scala` exists, so task 6.2's API enrolment has a surface to use.

**Frontend.** `firebase.json` and the app HTML set no CSP or `form-action`, so neither the cross-origin fetch nor the form POST
and its 302 are blocked. `pwaConfig.ts:58` is the denylist task 4.1a extends. `apiToken.ts` lacks `expiresInDays` as task 4.2 says.
`MfaVerifyPage.tsx` navigates to `/home`, `LoginPage` drops `from` on the MFA branch, and `OAuthCallbackPage` loses it on the Google
MFA branch; D7 and task 4.1 name exactly these. `PublicOnlyRoute`'s `/home` redirect is real, and task 4.1 tests under the real
wrappers to catch that race.

**Consent attack surface (reasoned from D3/D4/D4a).** A hostile `client_name` is length-capped and escaped. Userinfo tricks
(`https://claude.ai@evil.com`) resolve to the real hostname under URL parsing, so the allow-list and the displayed host agree. The
PAT travels only in a form body to a build-fixed origin. The code is sealed, PKCE-bound and client-bound. The residual of POSTing
your own PAT against someone else's pending request needs that victim's sealed URL and is documented.

**Not verifiable at this gate.** Cloud Run's 32 MiB cap, Firebase's header ordering, whether claude.ai and Cloud Run behave as
assumed (C3 defers this), and whether login navigation beats `PublicOnlyRoute`. Tasks 5.1a, 4.2a, 5.3 and 4.1 each require evidence
for these.

### Verdict: CONFIRM

The design implements C1-C5 soundly, and the artifacts agree with each other and with SDK 1.32.1. I found no defect that would
ship silently or that the planned proof would miss. The notes below are worth folding in during execution.

### Non-blocking notes

1. **The Docker build will fail as written unless tests are excluded (reproduced).** `helio-mcp/tsconfig.json` includes
   `src/**/*.test.ts`, and helio-mcp declares no Jest types. They resolve only from the repo root's `node_modules`. A copy of
   `helio-mcp` compiled away from the root exits 2 with 1,541 error lines over 53 files (1,524 are `TS2304`/`TS2582`). The same copy
   with `src/**/*.test.ts` excluded exits 0. Use a `tsconfig.build.json` for the image; never mask it with `|| true`. Docker 29.9.3
   is installed and its daemon answers, so task 5.1's `docker build` will catch this.
2. **Say when a large-body slot is released.** D6 and the spec say it is taken before parsing, but not when it is freed. The D8
   inequality only holds if it is held until `res` closes.
3. **`HELIO_MCP_LARGE_BODY_SLOTS` has no stated default or range** (D6, task 1.3), while the spec says optional settings are validated.
4. **MCP's Streamable HTTP text requires validating `Origin`.** The design does not mention it. Rebinding risk is nil for a public,
   bearer-only endpoint with no ambient credentials, but record the decision rather than leave it implicit. A check must not refuse an
   absent `Origin`, since server-side clients send none.
5. **Two deviations from the ticket's letter should be stated in the PR:** `GET /mcp` is a 405 (ticket: "POST and GET"), and the HTTP
   limit is 32 MiB, not "matching" 64 MiB. Both are justified, and the D6/D1 reasoning holds.
6. **Validate `HELIO_APP_URL` as an origin**, as for `HELIO_MCP_PUBLIC_URL`. A trailing slash breaks the exact-match CORS origin.
7. **Spec wording:** "at least every 5 minutes" conflicts with a TTL allowed up to 3600 s. Say "by default".
8. **Log bounds:** D6 keeps a 500-character truncated `onerror`, and `unhandledRejectionGuard` logs `reason.message`. `index.ts`'s own
   comment says SDK messages can echo payloads, while the spec forbids any request body in logs. The transport's literal messages I read
   are static, but I did not trace the three pass-through `onerror(error)` sites. Task 6.3 should include a malformed-body case.
9. **Password sign-up** (`RegisterPage` keeps `from`) has the same `PublicOnlyRoute` race and is outside the spec's list. A fifth
   round-trip test is cheap, and a new user arriving via a connector is plausible.
