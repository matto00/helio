## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `573621708b4fa895d953b9c4cf7bc2d7744f8ca9`. Review base: `368ec37962e021e9363e58d507421f1d172fee21`, resolved live with `resolve-review-base.sh`. V147 is still the next free migration on `origin/main`, which tops out at V146 (C15).

### Phase 1: Spec Review — PASS
Issues: none.

- **AC1, grant list or real refresh.** Owner ruling Q1 chose implement-refresh-tokens. Discovery now states `["authorization_code","refresh_token"]` explicitly, and the server really issues, rotates and honours refresh tokens. The README matches. The live local run confirms it: metadata, issuance, rotation, reuse and a Settings revoke all behave as designed.
- **AC2, 401 vs 405.** Owner ruling Q2 kept 401 and documented it. Measured live:
  - unauthenticated `GET` and `DELETE /mcp` answer `401` with `WWW-Authenticate`;
  - authenticated `GET` and `DELETE` answer `405` with `Allow: POST`.
  The README states both. `httpApp.test.ts` now also asserts the `WWW-Authenticate` header.
- **Tasks.** Every task is checked and matches the diff. The rulings O1 to O4 are implemented as written:
  - access TTL is 3600;
  - the refresh `exp` is min(30 d, family expiry), and the `refresh-ttl-cap` mutation goes red without the cap;
  - reuse deletes the PAT and the families cascade away;
  - there is no grace window.
- **Scope.** Two edits outside the plan were forced by existing guards: the `ExistenceNotLeakedRoutesSpec` Forbidden-producer pin and the `docs/user-reference-inventory.md` FK rows. Both are justified, and no other drive-by changes were found.
- **Contracts.** There are five `schemas/mcp/*` files, plus a seam test that validates helio-mcp's request bodies against them. The backend spec validates its requests and responses against the same files. There is no OpenAPI file in the tree, as the round-2 design note says.
- **CONSTRAINTS** C1 to C15 are honoured in the diff. On C12:
  - The red commit `f459e37d3` contains only tests, the test harness, a type-only `familyTimeoutMs?` option on `HttpAppOptions` (so the tests compile), planning artifacts and the red `.txt` evidence.
  - The red runs are genuine assertion failures, not compile errors: helio-mcp 19/70 failed, McpRefreshFamilyRoutesSpec all red, RlsPolicyGuardSpec 4 red.
  - Committing it with `--no-verify` is acceptable under C12. The hook runs `npm test`, which must fail on a red commit. The next commit restores a green hook: I re-ran every hook check at HEAD and all are green (see Phase 2).
  - The PR body should still mention the bypass, per CLAUDE.md.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates, run fresh by me in `WORKTREE_PATH`:**
- Root `jest`, which collects helio-mcp, 3 workers: 75/75 suites, 678/678 tests.
- `npm run lint`: 0.
- `format:check`: clean.
- helio-mcp `typecheck`: 0.
- Every other hook check passed (exit 0): `typecheck`, `check:helio-mcp-types`, `check:e2e-types`, `check:schemas`, `check:spec-structure`, `check:openspec`, `check:scala-quality` (clean, soft warnings only), `check:repo-integrity`, `check:no-credential-leak`, `check:test-temp-dir-hygiene`, `check:ci-complete-needs`, `check:eslint-ts-rules`, `check:tokens`, `check:e2e-user-cleanup`, `check:e2e-evidence-paths`.
- `sbt -J-Xmx3g testOnly` on the lane DB with McpRefreshFamilyRoutesSpec, RlsPolicyGuardSpec, ExistenceNotLeakedRoutesSpec and V119OwnerFkMigrationSpec: 225/225.
- No frontend file changed, so no frontend jest or build was required.
- I did not re-run the full backend suite. The executor's api/infra/services shard logs exist under the lane scratch dir. The two pins those shards caught are both fixed, and I re-ran both specs green.

**Review findings:**
- **Repository.**
  - The CAS `UPDATE` matches the family, the PAT, the presented hash, the client, the resource and an unexpired row. On zero rows it diagnoses the cause under `FOR UPDATE`, in the order the design fixes: missing → expired → mismatch → reuse.
  - On reuse it deletes the PAT on the app pool under the owner's RLS context, and the FK cascade does the rest.
  - The concurrent-rotation test shows exactly one `200`. Per O4, the loser is treated as reuse.
  - The mutations each go red on a named test (evidence `mutations.txt`): CAS predicate, client binding, reuse PAT delete, cascade, audit event.
- **Service.** It is PAT-only (`tokenId` must be present). Hashes are validated against lowercase SHA-256 hex, and `resource` is capped at 2048 characters. The audit event goes through `AuditService.record` and carries no token material, which the spec asserts. The `auditService: AuditService = null` default with an `!= null` guard copies the existing `ApiTokenService` precedent.
- **helio-mcp.**
  - A distinct `refresh` seal kind means an access token presented as a refresh token is refused; this is tested.
  - Client binding and resource checks run before any backend call.
  - The status mapping is total; unexpected statuses become `ServerError`, as the round-2 design note requires.
  - No token material is logged; this is tested.
- **Type safety and security.** No `any`. All SQL is parameterised. Only hashes cross the wire.

### Phase 3: UI Review — PASS (scoped)
Issues: none.

The `schemas/**` trigger matched, but no `frontend/**` file changed. The new schemas are used only between the backend and helio-mcp, so the breakpoint resize checks are N/A. I checked what a user can actually observe against the lane servers (`start-servers.sh` on 7145/10052, lane DB). The run used a local helio-mcp only, with `ANTHROPIC_API_KEY` empty.

- **Independent e2e** (persisted: `/home/matt/Development/helio/.concertino/runs/HEL-1713/evidence/.concertino/scratch/HEL-1713/eval1/e2e-eval-transcript.txt`):
  - A session caller on `POST /api/mcp-refresh-families` gets `403`.
  - A client registered without `grant_types` gets `expires_in=3600` and no refresh token.
  - A refresh-capable client gets a refresh token and a working rotation, and the refreshed access token answers `/mcp` `200`.
  - A foreign client presenting the token gets `invalid_grant`.
  - After a Settings revoke (`DELETE /api/tokens/:id` → `204`), refresh answers `invalid_grant`.
  - Reuse answers `invalid_grant`, and afterwards the newest token is also refused.
  - The reused PAT is gone; an unrelated PAT of the same user remains.
- **DB** (live rows checked after the run): the user had zero family rows left. A `token.revoke` audit row exists with metadata `{"reason":"mcp_refresh_reuse","familyId":…,"generation":1}`, plus the Settings-revoke row.
- **Settings page** (Playwright, port 7145), after a reuse driven through the real routes:
  - In the browser, create answered `201`, a rotate by another PAT `404`, rotate `200`, reuse `409 {"reason":"reused"}`, and the next call `401`.
  - The Personal access tokens table lists only the kept PAT.
  - Audit history renders "Revoked personal access token … You (API token) … pat".
  - Navigating to Settings logged no console errors (only the React DevTools info line).
- **Cleanup.** My two test users were deleted by exact id with `buildUserDeleteSql`, and their rows were verified at 0. Servers were stopped with `stop-servers.sh`, and the ports are free. No helio-mcp child process is left listening.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `helio-mcp/src/oauth/refreshFlow.test.ts:149-153`: the "PAT revoked (401) at code exchange" test only asserts `flow.accessToken` is undefined. That would also pass if the token endpoint answered `500`. Assert the token response status is `400` and `error === "invalid_grant"`, as the spec scenario "PAT revoked before the code exchange" states.
- The metadata override cannot be told apart from the SDK default by any test today, because both lists are identical. `mutations.txt` already says this honestly; the explicit-list mutation is the discriminating one.
- The PR body should state that the red commit was made with `--no-verify` (CLAUDE.md), and should include the two-deploy release order (backend first).
