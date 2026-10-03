## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 40bc8a0a8f420ef4558fa3a67bf2f005ce026989.

### Phase 1: Spec Review — PASS
Issues: none. Ticket AC (omit owner-id-equivalent from public panel list for non-owners, generic guard, owner view retained) addressed. Spec deltas (public-dashboards, resource-metadata), schema, frontend and helio-mcp types all updated. tasks.md all ticked and matches the diff.

Independent public-route enumeration (ApiRoutes.scala ~L821-865): outside `authenticate`, the unauthenticated/optional-auth surface is `health.routes`, `/api/auth/*` (register/login/OAuth/mfa verify), and the `optionalAuthenticate` branch = PublicDashboardRoutes (panels list, rows, filter-capabilities, distinct-values, output-meta, provenance), PublicUploadRoutes (image bytes only), ConnectorCompletionRoutes (POST completion = 204; GET returns authType/apiKeyName/apiKeyPlacement only). Only PublicDashboardRoutes serializes a panel/owner-bearing shape; the upload and completion routes carry no owner id by construction (read the handlers). The generic guard covers all six PublicDashboardRoutes endpoints x 8 caller/dashboard scenarios incl. 400/403/404 bodies; upload/connector-completion are not in the guard but have no owner-bearing fields (non-blocking suggestion below).

### Phase 2: Code Review — PASS
Gates run by me in WORKTREE_PATH:
- `npm run lint`, `format:check`, `typecheck`, `check:schemas`, `npm --prefix helio-mcp run build`: all green.
- `cd backend && nice -n 19 sbt testFull`: 5253 run, 5252 passed, 1 failed: `ProductEventRollupServiceSpec` "V114 backfilled history ... roll up in ONE tick" (`403 was not equal to 402`, ProductEventRollupServiceSpec.scala:85, `countEvents shouldBe 400 + otherUsers`). That spec (HEL-1244, V114) and the code under it are untouched by this diff (not in `git diff --stat`); it hard-codes a 2026-10-03 clock and counts rows in `users`, run at 03:10 UTC 2026-10-03. Not on the known-flake list (HEL-1228/1225/1215) — flagged as an unrelated, pre-existing date/shared-row-count flake belonging to HEL-1244; not attributable to this change. Recommend the orchestrator/driver confirm/ticket it.
- Mutation proof (reproduced myself, then reverted; `git status` clean afterward): changed `PanelProtocol.scala` meta construction back to `ResourceMetaResponse.fromDomain(panel.meta)` (the pre-fix behavior for createdBy). `PublicRouteOwnerIdLeakSpec`: 7 of 8 tests FAILED, including the generic guard: `[anonymous / public dashboard] GET /dashboards/.../panels (status 200 OK) leaked owner id 0badc0de-... at: $.items[0].meta.createdBy`. Guard is failable and non-vacuous (also asserts rows/provenance return real data). `OwnerIdGuardSpec` independently proves the walker flags arbitrary key/nesting/embedded/key-position ids.
- Code: one flag (`includeOwnerId`) drives both `ownerId` and `meta.createdBy` (no drift); `createdBy` is `Option` so spray omits the key (absent, not null); default `true` keeps dashboard and all other call sites byte-identical. Owner view = dashboard `ResourceAccess.Owner` or panel creator; correct and tested (owner sees both fields on all panels incl. grantee-created; creator sees own panel only; other grantee sees neither). No dead code, no scope creep (positional-constructor test fixes are required by the type change).

### Phase 3: UI Review — N/A
Triggers matched only through type-only edits (`frontend/src/types/models.ts` `createdBy?`, schema); typecheck/lint pass and no frontend consumer behavior changed. Backend wire change verified by serialized-JSON route tests; no rendered UI altered. (Frontend `npm test`/build not run: type-only optionalization, `tsc --noEmit` green.)

### Overall: PASS

### Non-blocking Suggestions
- Add one anonymous call each for `/uploads/image/:id` (404 body) and `GET /connectors/completion?token=bad` to the generic guard so the spec's "every public route" claim is literally true.
- Unrelated: ProductEventRollupServiceSpec V114 test flaked on this clock/shared-users state; worth a ticket against HEL-1244.
