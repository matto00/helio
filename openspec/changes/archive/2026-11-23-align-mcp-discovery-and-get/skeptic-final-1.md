## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `573621708b4fa895d953b9c4cf7bc2d7744f8ca9`. The diff base was resolved live with
`resolve-review-base.sh`, which returned `368ec3796`, the merge base. `origin/main` is two commits ahead
(HEL-1172, HEL-1727). Those commits touch none of this branch's files, `git merge-tree` merges cleanly, and V147 is
still free on `origin/main` (its newest migration is V146). The diff has no `frontend/**` file, so the UI and
design-judgment step does not apply.

### What I verified (with evidence)

**Acceptance criteria**
- AC1 ("the server really issues and honours refresh tokens; README matches"): met.
  - `helio-mcp/src/httpApp.ts` serves its own `/.well-known/oauth-authorization-server` ahead of `mcpAuthRouter`,
    with `grant_types_supported = ["authorization_code","refresh_token"]`.
  - `provider.ts` `exchangeAuthorizationCode` issues a sealed refresh token. `exchangeRefreshToken` (which used to
    always throw) now rotates the token.
  - The README section "Tokens and lifetimes" describes this behaviour accurately. I checked each bullet against
    the code: 1 h access token, 30 d sliding refresh capped at the PAT, issued only to a client registered with
    `refresh_token`, reuse revokes the PAT, access tokens die within the liveness TTL, the D3 fallback, and
    backend first in the release order.
- AC2 ("decide 401 vs 405; code, README and a test agree; authenticated GET still 405"): met.
  - `httpApp.test.ts` asserts 405 with `Allow: POST` when authenticated, and 401 plus a `WWW-Authenticate
    resource_metadata=` header when unauthenticated, for both GET and DELETE.
  - The README paragraph "`/mcp` and the methods" states the same thing, and the spec delta
    `mcp-remote-http-transport` agrees.

**Gates, re-run by me**
- Full helio-mcp Jest (`npx jest --maxWorkers=3 --testPathPatterns helio-mcp`, nice 19): `Test Suites: 70 passed,
  70 total`, `Tests: 654 passed, 654 total`.
  - A first run with `--roots helio-mcp/src` gave 67/632 only because it leaves out `helio-mcp/scripts/*.test.ts`.
    That was my measurement, not a defect.
- `npm --prefix helio-mcp run typecheck`: exit 0.
- `prettier --check` on the changed ts/md/json files: clean.
- Repo-wide hook checks: `check:schemas`, `check:no-credential-leak`, `check:scala-quality`, `check:openspec`,
  `check:helio-mcp-types` and `check:repo-integrity` all exit 0.
- Backend specs, one sbt run (`-J-Xmx3g`, nice 19, lane DB env): `McpRefreshFamilyRoutesSpec`,
  `RlsPolicyGuardSpec`, `ExistenceNotLeakedRoutesSpec` and `V119OwnerFkMigrationSpec` together gave `Tests:
  succeeded 225, failed 0`, exit 0. All 11 `McpRefreshFamilyRoutesSpec` cases passed by name.
  - Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1713/skeptic-final-backend.txt`

**Mutations (red demanded, reproduced by me, each reverted, tree clean afterwards)**
- `cas-predicate` (claimed): I dropped `AND current_jti_hash = $presentedJtiHash`. Result: 2 failed, the reuse case
  and "exactly one of two concurrent rotations". Matches the claim.
  - Log: `.../scratch/HEL-1713/skeptic-mut-cas.txt`
- My own mutation: I deleted the `Expired` diagnosis branch, so an expired family would fall through to reuse.
  Result: 1 failed, "answer an expired family with 409 expired, no change and the PAT kept". The fixed zero-row
  evaluation order is pinned.
  - Log: `.../skeptic-mut-expired.txt`
- `refresh-client-binding` (claimed): I disabled the `clientIdHash` check in `exchangeRefreshToken` only (line 280).
  Result: red on "refuses another client's refresh token and rotates nothing". Matches the claim.
- My own mutation: I removed the rotate `401 -> revoked` mapping in `familyClient.ts`. Result: red on "answers
  invalid_grant when the backend says the PAT is gone (401)" and on "treats reuse as theft". The D5 mapping for 401
  is pinned.

**The specific checks requested**
- **RLS under a non-BYPASSRLS role.**
  - `McpRefreshFamilyRoutesSpec` runs the app pool as `SET ROLE helio_app_test` (NOSUPERUSER, no BYPASSRLS), so
    every route test runs under real RLS. That includes the reuse path's `DELETE FROM api_tokens` and the FK cascade
    to sibling families.
  - The spec also checks owner-only visibility directly, and checks that an insert for another user is refused.
  - V147 has `ENABLE` and `FORCE` and one owner `USING` policy. The migration creates no data, so it is safe under
    prod's non-BYPASSRLS Flyway role.
  - `RlsPolicyGuardSpec` now lists the table, and the relrowsecurity, relforcerowsecurity and policy checks passed.
- **CAS under concurrency.**
  - The single `UPDATE ... WHERE current_jti_hash = presented ... RETURNING` runs inside `withUserContext`, which is
    `.transactionally` (`DbContext.scala:50-51`). The loser's zero-row diagnosis reads under `FOR UPDATE`.
  - Under READ COMMITTED, the loser re-checks the predicate against the winner's new hash and becomes `reused`,
    which O4 accepts.
  - The concurrent test passes, and the CAS mutation turns it red.
- **No token material in logs or audit.**
  - The backend logs only familyId and generation. The audit metadata is
    `{reason, familyId, generation}`, and the spec asserts it contains neither the jti hash nor the PAT.
  - helio-mcp logs only a status code or error name (`familyClient.post` returns `err.name`). Jest asserts that
    the logs never contain the PAT or the refresh token.
  - A grep of my backend run log for `helio_pat_` found nothing.
- **CORS on the metadata handler.** `cors()` plus `allowedMethods(["GET","OPTIONS"])`. Jest asserts
  `access-control-allow-origin: *`.
- **D3 status mappings** (`familyClient.create` and the provider).
  - 201 issues a refresh token.
  - 401 gives `InvalidGrantError` with no tokens. The `create-401-to-token` mutation evidence claims this is pinned.
    The test only asserts that no access token came back, not the `invalid_grant` code; see the notes.
  - Every other status, a network error or a timeout issues an access token only. Each of these has its own
    `it.each` row.
- **D5 status mappings.**
  - 200 rotates. 401 gives `invalid_grant`. 404 and 409 with a known reason give `invalid_grant`.
  - A 409 with an unknown reason, or any other status, gives `ServerError` (500 `server_error`), matching the
    round-2 "D5 is total" note.
  - `checkResource` runs before the sealed-resource comparison, so a foreign resource gives `invalid_target`.
  - The SDK token handler sends `ServerError` to 500 and every other `OAuthError` to 400 (`token.js`).
- **Seam against `schemas/mcp`.**
  - `familySeam.test.ts` validates helio-mcp's real create and rotate request bodies with ajv against the same
    schema files `McpRefreshFamilyRoutesSpec` validates the backend's requests and responses against.
  - Field names agree on both sides (`familyId`, `expiresAt`, `generation`, `reason`).
  - Java `Instant.toString` output with microsecond fractions parses correctly with `Date.parse` in Node. I checked
    this directly.
- **Red commit `f459e37d3` (`--no-verify`).** It contains tests, the harness, evidence and openspec docs, plus one
  type-only source line (`familyTimeoutMs?` on `HttpAppOptions`). The commit message discloses the bypass and why.
  The pre-commit hook runs repo-wide checks, not staged-only ones, so the two later commits' hooks covered the red
  commit's content in the final tree. I re-ran the hook checks above and they are green. Acceptable.
- **Audit and FK safety of the reuse path.** `audit_events.actor_token_id` and `resource_id` are soft references
  (V91 comment), so the audit row written after the PAT is deleted cannot fail on an FK. The `user-reference
  inventory` and the `ExistenceNotLeaked` Forbidden-producer pin were updated, and both specs pass.

### Verdict: CONFIRM

### Non-blocking notes
- The test "answers invalid_grant with no tokens when the backend says the PAT is revoked (401)" asserts only that
  `accessToken` is undefined. It does not assert the `400` / `invalid_grant` body. A mutation that throws a
  different error would stay green.
- The metadata handler is mounted with `app.use(path, ...)`, so it also answers sub-paths such as
  `/.well-known/oauth-authorization-server/x`. A bare OPTIONS that is not a preflight gets the JSON body. The SDK's
  `router.get('/')` did neither. This is harmless, since the issuer has no path, but it is a small divergence from
  the round-2 note "keeps the SDK handler's behaviour".
- Task 4.2 claims an end-to-end "revoke in Settings". The transcript covers discovery, exchange, refresh and reuse,
  but not a Settings revoke, and it skips authenticated GET. Both behaviours are covered by unit and integration
  tests (the PAT-delete cascade spec, the Jest backend-401 case and the httpApp 405 test), so this is an evidence
  wording gap only.
- Whether claude.ai registers `refresh_token` in `grant_types` decides whether it ever receives a refresh token.
  Without it, a connection lasts 1 hour and each re-consent mints a new PAT. The design's risks section records
  this, and it should be checked during HEL-1710 as the ticket notes.
