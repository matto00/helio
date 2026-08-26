# HEL-483: PAT/agent action attribution: record acting token id and UI/PAT/MCP source

## Description

`AuthDirectives.resolveIdentity` collapses session-cookie and PAT-bearer callers into the same `AuthenticatedUser`, so audit rows currently cannot tell whether a mutation came from the browser UI, a PAT-authenticated script, or the MCP server (helio-mcp, which also authenticates via a `helio_pat_` token). The audit store already has `source` and `actor_token_id` columns; this ticket propagates the values into them.

## Scope

* Thread the acting credential's provenance from `AuthDirectives` to the audit call sites. Options to evaluate in design: extend the provided principal to carry `source` (`ui` when resolved from the session cookie; `pat` when resolved from a `helio_pat_` token) and the resolving token's id (from `ApiTokenRepository.findUserByTokenHash`, which currently returns only the user — extend it to also surface the token id).
* Distinguish `mcp` from generic `pat` if a signal exists (e.g. a dedicated token label/scope or a `User-Agent`/client header set by helio-mcp); if no reliable signal exists, document that MCP is recorded as `pat` and note the follow-up.
* Ensure `AuditService.record(...)` receives and stores `source` + `actor_token_id` from the instrumented call sites.

## Acceptance criteria

* A mutation performed with a session cookie records `source=ui` and null `actor_token_id`.
* The same mutation performed with a `helio_pat_` bearer token records `source=pat` and the correct `actor_token_id`.
* Revoking/deleting a token does not break historical attribution (soft reference; no cascade wipe of audit rows).
* ScalaTest coverage for both credential paths; `sbt compile test` green.

## Out of scope

* The audit store schema (already has the columns — separate ticket).
* The generic mutation instrumentation (separate ticket; this refines the values it passes).
* WorkspaceTeardownService.teardown's bulk delete audit gap, DataSourceService.refresh / SourceService.refresh unaudited, AuthService.completeOAuth missing auth.register on first-time Google signup — all pre-existing, deliberate HEL-477 gaps, not this ticket's job.

## Dependencies

Depends on the audit event store ticket (HEL-471, merged) and coordinates with the mutation-instrumentation ticket (HEL-477, merged). Relates to HEL-288 (token hashing — token id is looked up by hash).

## Session-level notes (from delivery run context, not part of the Linear ticket itself)

* HEL-471 (c0d4679b): audit store. Append-only enforced by BEFORE UPDATE/DELETE/TRUNCATE triggers raising SQLSTATE 23001 (NOT a grant-revoke scheme).
* HEL-477 (46513162): instrumented every named mutation + auth/token/MFA events. Archived evidence at `openspec/changes/archive/2026-08-26-instrument-audit-mutations/route-audit-enumeration.md` — load-bearing map of existing call sites for this ticket.
* `AuditSource` already defines `Ui | Pat | Mcp | System` (model.scala) — no invented member needed (a prior HEL-477 design round rejected a nonexistent `AuditSource.Api`).
