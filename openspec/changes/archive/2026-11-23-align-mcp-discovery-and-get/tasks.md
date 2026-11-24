## Standing Constraints

- [C1] Never read, print, copy or source any `.env` file (`scripts/concertino/.concertino.env` included); no env-dumping commands; start servers only via `start-servers.sh`.
- [C2] Quoted heredocs only (`<<'EOF'`).
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with `stop-servers.sh`; delete test residue with `buildUserDeleteSql` by exact id.
- [C4] jest 3 workers, Playwright 2 workers total, `sbt -J-Xmx3g`, `nice -n 19`.
- [C5] Bash timeout 600000; `sbt testFull` in shards small enough to finish under it; nothing backgrounded past the tool timeout.
- [C8] No prod, mcp.helioapp.dev or run.app URL; no release, no `concertino sync`, no deploy. Reproduce against a local helio-mcp only, with `ANTHROPIC_API_KEY` empty.
- [C12] Red first, with mutations; run full spec files; commit the red run as `.txt` before implementation code.
- [C13] Scratch and tool output in `/home/matt/Development/helio/.concertino/scratch/HEL-1713/`, never `/tmp` or the worktree; TMPDIR for git hooks only: `/tmp/claude-1000/-home-matt-Development-helio/178232e2-92a2-44f9-8fb7-656468a7b746/scratchpad/HEL-1713`.
- [C14] Lane DB `helio_hel1713`: `DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1713 DB_USER=matt` exported in the SAME command as `start-servers.sh`, sbt, and any DB-touching jest/commit-hook run.
- [C15] Before committing the migration, re-check on `origin/main` that V147 is still the next free number.

## 1. Red

- [x] 1.1 helio-mcp Jest (fake backend for the two family routes): metadata exact grant list; `expires_in: 3600`; refresh token issued only to a client registered with `refresh_token`; rotation; old token refused after rotation; reuse -> `invalid_grant` and newest token refused; foreign client; foreign resource (`invalid_target`); expired; tampered; access token as refresh token; backend 401 -> `invalid_grant`; backend connection refused -> `500` and the same token works on retry; code exchange per D3 status table, one test per row (201 -> refresh token; 401 -> `invalid_grant` no tokens; 400/403/404/429/5xx/network/timeout -> access token only); sealed resource is the canonical one when the client sent none; unauthenticated `GET`/`DELETE /mcp` `401` with `WWW-Authenticate`, authorized `405` + `Allow: POST`.
- [x] 1.2 ScalaTest on the lane DB: create (201, expiresAt = PAT expiry), rotate CAS, concurrent rotate (exactly one 200), reuse deletes the PAT and cascades, mismatch 409 no change, expired 409, cross-token 404, session 403, scoped PAT refused, PAT delete cascades, reuse writes one `token.revoke` audit event with `reason: "mcp_refresh_reuse"` and no token material (written after commit: poll for it, do not read it immediately), RLS under the non-BYPASSRLS role.
- [x] 1.3 Run red, save output as `.txt` under the change's `evidence/`, commit it before implementation.

## 2. Backend

- [x] 2.1 `V147__mcp_refresh_families.sql` (table, indexes, RLS enabled + forced, owner policy); add `"mcp_refresh_families"` to `RlsPolicyGuardSpec`'s `rlsTables` allowlist.
- [x] 2.2 Repository (Slick), service (create, rotate CAS, reuse -> delete PAT in one transaction, one INFO log line without token material), routes wired in `ApiRoutes`, JSON protocols.
- [x] 2.3 `schemas/mcp/` request/response schemas (no OpenAPI file exists; do not add one); a seam test that helio-mcp's request bodies validate against them.

## 3. helio-mcp

- [x] 3.1 `seal.ts`: `refresh` kind; `ACCESS_TTL_SECONDS = 3600`; refresh TTL 30 days.
- [x] 3.2 Backend client for the two routes (PAT bearer, timeout, status mapping per design D5).
- [x] 3.3 `provider.ts`: issuance in `exchangeAuthorizationCode` (D3, including the backend-unavailable fallback), `exchangeRefreshToken` (D5).
- [x] 3.4 `httpApp.ts`: own `/.well-known/oauth-authorization-server` ahead of `mcpAuthRouter` with the explicit grant list.
- [x] 3.5 README: refresh behaviour, lifetimes, revocation, 401 vs 405, release order.

## 4. Proof

- [x] 4.1 Green: full helio-mcp Jest suite; affected backend spec files in shards; mutations (drop the CAS predicate, drop reuse -> PAT delete, drop the client binding, drop the cascade, drop the reuse audit event, revert the metadata override) each turn a named test red; outputs as `.txt` evidence.
- [x] 4.2 Local end-to-end against a local helio-mcp + lane backend only: discovery, code exchange, refresh, reuse, revoke in Settings; transcript as evidence.
