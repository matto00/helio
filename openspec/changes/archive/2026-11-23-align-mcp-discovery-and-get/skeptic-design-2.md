## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 368ec37962e021e9363e58d507421f1d172fee21 (= origin/main, fetched now; the change dir is untracked).
Owner rulings Q1/Q2/O1-O4 (workflow-state.md OWNER_RULINGS) are treated as settled.

### What I verified (with evidence)

**Spec text.** I re-fetched it myself into `.concertino/scratch/HEL-1713/skeptic2/` and did not rely on the round-1 copies.
- MCP 2025-11-25 authorization.mdx:
  - l.581: "SHOULD issue short-lived access tokens".
  - l.582: "For public clients ... MUST rotate refresh tokens as described in OAuth 2.1 Section 4.3.1".
  - l.475: "Invalid or expired tokens MUST receive a HTTP 401".
  - design.md quotes all three correctly.
- OAuth 2.1 draft-13 §4.3.1 (l.2473ff). The AS MUST:
  - ensure the refresh token was issued to the matching `client_id`. D5 step 2 does this.
  - validate that the grant is still active. The rotate call is PAT-authenticated, so a revoked or expired PAT gets `401` and then `invalid_grant`.
  - The text on rotation and replay ("revoke the active refresh token as well as the access authorization grant") is met by O3: reuse deletes the PAT, and the FK cascade removes the families.
  - The implementation note lets the grant be encoded in the token as long as its integrity is protected. The D2 AES-GCM seal carrying `familyId` qualifies.
- RFC 8707: `invalid_target` (l.194/239) is the right code for a foreign `resource`.
- RFC 8414 §2: the omitted default is `["authorization_code","implicit"]`, so stating the field explicitly is correct.
- RFC 7591 §2: an omitted `grant_types` means authorization_code only. D3's gating matches.
- RFC 6749 §5.2: `server_error` is no longer attributed to it. The new refresh requirement in `mcp-connector-oauth` names the right source for each code. N1 is fixed.

**Ground truth in the tree**
- **`helio-mcp/src/oauth/seal.ts`**
  - Each kind gets its own HKDF subkey (`helio-mcp/${kind}`).
  - `exp` is in seconds and comes from a `ttlSeconds` argument, so `min(now+30d, expiresAt)` can be expressed.
  - A previous-key fallback exists, which D6's key rotation relies on.
- **`provider.ts`**
  - `getClient` returns the sealed `grant_types`, so D3 gating is implementable.
  - `checkResource` and `comparableResource` exist. D2's "sealed resource is always canonical" (N2) is implementable.
  - `exchangeRefreshToken` currently always throws.
- **SDK 1.32.2**
  - `router.js:41` hardcodes `grant_types_supported: ['authorization_code','refresh_token']`.
  - `createOAuthMetadata` is exported.
  - `handlers/token.js:84` passes `(client, refresh_token, scopes, resource)`.
  - `:96` maps `ServerError` to 500 and other `OAuthError` to 400; a non-OAuth throw becomes 500.
  - `handlers/metadata.js` serves the AS metadata with `cors()` and `allowedMethods(['GET','OPTIONS'])`.
- **`httpApp.ts:225`** is `app.all("/mcp", bearer, livenessGate, notAllowed)`. The 401-before-405 behaviour stands as D7/Q2 describe. `httpApp.test.ts:74-85` already asserts 405 + `Allow: POST` when authorized and 401 when not. The token rate limit is 300 per 15 min (`:111`).
- **`infra/deploy-mcp.sh:65-66`** sets `--max-instances=2 --min-instances=0`. Reuse state therefore cannot live in helio-mcp memory, as the design argues.
- **Backend auth and audit**
  - V42 `api_tokens`: UUID ids, nullable `expires_at`, owner-only RLS with FORCE, and a USING-gated INSERT. The design's table mirrors it.
  - `AuthDirectives.scala:34-35` gives a PAT caller `tokenId = Some(..)`; `:61` gives a session caller `tokenId = None`. The session-403 rule is therefore implementable.
  - `confineScopedToken` (`:152-156`) refuses a scoped PAT off `/hooks`.
  - `ApiTokenRepository.findUserByTokenHash` honours `expires_at`, so the rotate `401` path covers an expired PAT.
  - `ApiTokenService.revoke` audits `token.revoke` with resource type `api_token`.
  - `AuditService.record` appends on the privileged pool. It is fire-and-forget and never fails the caller.
  - V91 `audit_events.actor_token_id` is a soft reference with no FK. An audit row that names the PAT being deleted therefore cannot conflict with the delete.
- **RLS guard.** `RlsPolicyGuardSpec` keeps an exact `rlsTables` allowlist (`api_tokens` is at l.101). Task 2.1 now adds the new table (N3 is fixed), and task 1.2 adds the non-BYPASSRLS check.
- **Migration number.** origin/main tops out at V146. No `origin/*` branch carries V147-V149. V147 is free, and C15 re-checks it before commit.
- **Concurrency.** Under READ COMMITTED, the losing CAS UPDATE waits on the row lock, re-evaluates against the committed row and matches zero rows. The `FOR UPDATE` read then sees a non-current hash and treats it as reuse. That matches the "exactly one 200, the other is reuse" scenario and the O4 risk the design discloses.
- **Archived HEL-1709 design.** `2026-11-09-helio-mcp-remote-oauth-connector/design.md` l.20/47/191 says "GET 405" and "No refresh". README l.86-87 says the same. The drift the ticket describes is real, and D8 replaces that text.
- **Living specs.**
  - The MODIFIED headers match exactly (`mcp-connector-oauth` l.8/88/106, `mcp-remote-http-transport` l.8).
  - The replaced token-exchange text drops "No refresh token SHALL be issued".
  - "A revoked or expired PAT forces re-authorization" (l.128) stays consistent.
  - `openspec validate align-mcp-discovery-and-get --strict`: valid.

**Round-1 change requests, re-checked against the current text**
- **CR1** (determinate vs indeterminate backend failures) is fixed.
  - D5 splits the two cases and names Cloud Run 504 and the Pekko request-timeout 503 as indeterminate.
  - The spec requirement says a retry after a timeout or ambiguous 5xx "MAY be treated as reuse".
  - The "Backend unavailable" scenario now names only a refused connection.
  - Risks restates this.
  - No idempotency key or grace window was added, which is correct under O4.
- **CR2** (audit on reuse) is fixed.
  - The O3 section and the `mcp-refresh-token-families` requirement and scenario specify `token.revoke` with `reason: "mcp_refresh_reuse"`, the family id and the generation, and no token material.
  - Task 1.2 asserts it, and task 4.1 adds the mutation.
- **CR3** (family-create status table) is fixed.
  - D3 now has an explicit table: 201, 401 (`invalid_grant`, no tokens), and everything else including timeout (access token only, one log line).
  - It notes the harmless orphan row a timeout can leave.
  - The spec requirement and a "PAT revoked before the code exchange" scenario match.
  - Task 1.1 requires one test per row.
- **N1-N7** are all addressed: error-code sources, canonical sealed resource, RLS allowlist, parallel-refresh and hourly re-consent risks, rate-limit arithmetic, the discovery requirement reworded for helio-mcp's own handler, and no purge of family rows.

**Required properties (from the brief), traced**

| Property | Where it is covered |
| --- | --- |
| Refresh token sealed, server stores only a hash | D2, D4 |
| Rotation on every use | D4 CAS, D5 |
| Reuse revokes the family (and the PAT, per O3) | D4, O3 |
| Bound to client_id and resource | D2, D5 steps 2-3, plus backend `client_id_hash`/`resource` predicates |
| Expiry relative to the 90-day PAT | O2: seal `exp = min(now+30d, family.expires_at)`, family `expires_at` = PAT expiry, backend `409 expired` |
| Revocation | D6, cascade, rotate `401` |
| Token-endpoint error codes | D5, refresh requirement |
| README and metadata agree | D1, D8 |
| Tokens issued before deploy | Access seal unchanged; they keep working until their own `exp` |
| Release order | Backend first; an MCP-first deploy degrades through the D3 fallback |
| RLS | Owner-only with FORCE, guard allowlist, non-BYPASSRLS test |

ACs:
- AC1 (pick one and make the README match) maps to D1-D6 and D8.
- AC2 (decide 401 or 405, then make code, README and a test agree; authenticated GET stays 405) maps to D7, the extended test and the transport delta.

### Verdict: CONFIRM

The design is internally consistent, matches the spec text I fetched myself and is implementable against the tree as it stands. Each round-1 change request is fixed in substance across design.md, the spec deltas and tasks.md. I found no placeholders, contradictions or ACs without a task.

### Non-blocking notes

1. **D1: keep CORS on the metadata override.** The SDK serves the AS metadata through `metadataHandler`, which applies `cors()` and allows only GET/OPTIONS (`handlers/metadata.js`).
   - A bare `app.get(...)` mounted ahead of the router would drop `Access-Control-Allow-Origin` on GET and break browser-based MCP clients.
   - The exact-array test would still pass.
   - Mount `metadataHandler(createOAuthMetadata(...) with the explicit list)`, or apply `cors()` yourself.
   - Assert the CORS header in the D1 test.
2. **Task 2.3 asks for "OpenAPI entries alongside the other routes", but there is no OpenAPI document in the tree.** `git ls-files` finds no `openapi*`/`swagger*` file, and `schemas/README.md` points at `openspec/` but nothing there qualifies. Do not invent a new OpenAPI file for this change. The `schemas/mcp/*` contracts and the seam test are the contract.
3. **D5 does not map rotate's `400`/`403`.** Both mean helio-mcp sent a malformed body or used a PAT it should not have, which cannot happen in normal operation. Map them, and any other unexpected status, to `ServerError` (500, `server_error`). This keeps D5 total and matches the spec's `server_error` clause. Note that rotate cannot be retried safely in this case.
4. **The reuse audit is written after commit, not inside the transaction.** `AuditService.record` appends after the transaction, on the privileged pool, is fire-and-forget, and a failed append is only logged.
   - That satisfies "recorded through the existing audit mechanism" and matches `ApiTokenService.revoke`.
   - The ScalaTest assertion in 1.2 must await or poll for the row rather than read it synchronously.
5. **Zero-row read order.** An expired family presented with a non-current hash answers `409 expired` and does not trigger the reuse revoke. That is acceptable because the PAT is already at or past its expiry. State the evaluation order (missing/foreign, then expired, then mismatch, then reuse) explicitly in the repository code comment, so the mutation tests target the intended branch.
6. **Liveness lag.** After a reuse deletes the PAT, an access token issued in the same family (possibly the attacker's) keeps working for up to `HELIO_MCP_LIVENESS_TTL_SECONDS` (300 s) on an instance whose cache is fresh. The O3 section already says this. Repeat it in the README's revocation paragraph so users are not told the cut-off is immediate.
