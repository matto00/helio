# Files modified — HEL-590 share-link-token-management

## Cycle 3 (evaluation-2.md change requests)

### Backend — new files

- `backend/src/test/scala/com/helio/infrastructure/persistence/sharing/ShareTokenRepositoryRevokeSpec.scala` — CR-D: isolates the CR6 `user_id` query filter from RLS by running under a deliberately superuser/BYPASSRLS `DbContext(db, db)` (the dev/CI reality), asserting the query filter alone blocks a cross-owner revoke

### Backend — modified files

- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala` — **CR-A (blocking)**: `findAllByDashboardId` gains `accessAlreadyGranted: Boolean = false`, short-circuiting the `ownerPred || granteePred || publicPred` predicate. This is the actual fix for the headline defect: a share-token-authorized caller matched none of those three predicates, so every token-authorized read returned zero panels
- `backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala` — CR-A: both `/panels` and `/panels/:id/rows` now pass `accessAlreadyGranted = true` from inside the directive's already-authorized block
- `backend/src/main/scala/com/helio/infrastructure/persistence/sharing/ShareTokenRepository.scala` — CR-F: fixed the garbled self-correcting scaladoc on `revoke`
- `backend/src/test/scala/com/helio/api/routes/dashboards/ShareTokenPublicAccessSpec.scala` — CR-A evidence: seeds real panels/rows with NO public-viewer grant and asserts non-zero item counts (the assertion that would have failed throughout cycles 1–2); also wires the output/pipeline/node-snapshot repos needed for a `/rows` non-zero test
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServicePanelCountSpec.scala` — mechanical signature update for the new `accessAlreadyGranted` parameter on an overridden `findAllByDashboardId`

### Frontend — new files

- `frontend/src/app/ShareDialogFocusRestore.test.tsx` — CR-E: jsdom-level verification that closing the share dialog opened from the desktop `ActionsMenu` restores focus to the menu's trigger, not `<body>` (see note below on live verification)

### Frontend — modified files

- `frontend/src/features/dashboards/ui/DashboardShareDialog.tsx` — CR-C: `buildShareUrl` is now exported
- `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.routing.test.tsx` — CR-C: calls the real `buildShareUrl` (stripping `window.location.origin`) instead of re-typing its output as an independent literal; docstring corrected
- `frontend/src/features/dashboards/state/shareDialogContext.tsx` — CR-E: adds `restoreFocusSelector` on the target, run (deferred one tick) in `close()`, sidestepping the timing problem where the `ActionsMenu` item and the dialog both change in the same React commit
- `frontend/src/app/App.tsx` — CR-E: `ShareDialogHost` stays mounted across close (`open={target !== null}` instead of unmounting), retaining the last non-null target via React's "adjust state during render" pattern; also skips the `/api/auth/me` bootstrap on the public viewer route (non-blocking suggestion)
- `frontend/src/features/dashboards/ui/DashboardList.tsx` — CR-E: passes `restoreFocusSelector` (the `ActionsMenu` trigger's own `aria-label`) when opening the share dialog
- `frontend/src/features/dashboards/ui/DashboardShareDialog.css` — non-blocking: added the missing `__token-created` rule

### Notes on what was NOT changed / could not be verified live

- **V102**: left in place as convention-compliance (matches V100's documented belt-and-braces precedent), but per the evaluator's own finding, nothing in the test suite (or the live database, where V38's default privileges already covered it) can distinguish V102 present from absent. No test was written that pretends to prove otherwise.
- **CR-E live verification**: `ShareDialogFocusRestore.test.tsx` is the strongest verification available to the executor (no live-browser tool in this session) — it exercises the identical code path (ActionsMenu click → `ShareDialogProvider.open` → Modal close → `restoreFocusSelector`) and was confirmed to redden when `restoreFocusSelector` is disabled. It is not a substitute for the evaluator's own live check at 1440px/430px, which is requested again in this cycle's report.

## Cycle 2 (evaluation-1.md change requests)

### Backend — new files

- `backend/src/main/resources/db/migration/V102__share_tokens_privileged_grant.sql` — CR5: explicit `GRANT SELECT ON share_tokens TO helio_privileged`

### Backend — modified files

- `backend/src/main/scala/com/helio/api/http/AclDirective.scala` — CR8: `shareTokenValidator` is now `Option[ShareTokenValidator] = None`, not a `null` default
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — passes `Some(shareTokenValidator)` to the updated `AclDirective` constructor
- `backend/src/main/scala/com/helio/services/sharing/ShareTokenService.scala` — CR7: maps `Forbidden` → `NotFound("Dashboard not found")` in all three `requireOwnerOnly` call sites, closing the management-route existence leak; also fixes the `DateTimeParseException` inline FQN
- `backend/src/main/scala/com/helio/infrastructure/persistence/sharing/ShareTokenRepository.scala` — CR6: `revoke` now filters by `user_id` explicitly in the query, not RLS alone; fixes the `java.sql.Timestamp` inline FQN
- `backend/src/test/scala/com/helio/api/routes/dashboards/ShareTokenOwnershipSpec.scala` — updated to assert the CR7-mapped `404`s (was asserting the `403` leak) + a new indistinguishability test
- `backend/src/test/scala/com/helio/api/http/ShareTokenAuthenticatedAccessSpec.scala`, `.../ShareTokenPublicAccessSpec.scala` — updated `AclDirective` construction for the `Option` constructor param

### Frontend — new files

- `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.tsx`/`.css` — CR1: the public, unauthenticated viewer a minted share link actually resolves to; single denied state for every invalid-token case
- `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.routing.test.tsx` — CR1: asserts against the real router (not a re-derived string), plus the four-invalid-token-cases-render-identically test
- `frontend/src/features/dashboards/services/publicDashboardService.ts` — the public-route fetch, kept distinct from `panelService.fetchPanels` (different failure-handling contract)
- `frontend/src/features/dashboards/state/shareDialogContext.tsx` — CR4: shell-level share-dialog target state, so the dialog renders outside `.app-sidebar`

### Frontend — modified files

- `frontend/src/app/AppRoutes.tsx` — CR1: mounts `PublicDashboardViewerPage` outside `ProtectedRoute`
- `frontend/src/app/App.tsx` — CR4: wraps `AppShell` in `ShareDialogProvider`, renders `DashboardShareDialog` via a new `ShareDialogHost` at shell level
- `frontend/src/app/MobileShell.tsx` — CR4: wires a "Share" secondary action into the mobile nav sheet for the dashboards picker
- `frontend/src/shared/chrome/MobileNavSheet.tsx` and `frontend/src/shared/chrome/MobileNavSheet.css` — CR4: new optional `secondaryAction` prop + its row/button styling
- `frontend/src/shared/ui/Modal.tsx` — CR9: restores focus to the invoking control when the modal closes
- `frontend/src/features/dashboards/ui/DashboardList.tsx` — CR4: opens the share dialog via `useShareDialog()` instead of local state + a locally-rendered dialog
- `frontend/src/features/dashboards/state/shareTokensSlice.ts` — CR3: revoke now marks `revokedAt` instead of deleting the item
- `frontend/src/features/dashboards/ui/DashboardShareDialog.tsx` — CR2: shows each link's creation time; revoked rows show "—" for expiry; non-blocking fix for the idle/loading `<ul>` render
- `frontend/src/features/dashboards/state/shareTokensSlice.test.ts`, `.../DashboardShareDialog.test.tsx` — updated for CR3's revoke-marks-not-deletes behavior
- `frontend/src/test/renderWithStore.tsx` — wraps the shared test harness in `ShareDialogProvider` (every `DashboardList`-rendering test now needs it)

### Cycle 1

### Backend — new files

- `backend/src/main/resources/db/migration/V101__share_tokens.sql` — `share_tokens` table, owner-only RLS (V92 idiom), unique index on `token_hash`, index on `dashboard_id`
- `backend/src/main/scala/com/helio/infrastructure/persistence/sharing/ShareTokenRepository.scala` — insert/findByDashboard/revoke (app pool) + findActiveByHash (privileged pool)
- `backend/src/main/scala/com/helio/services/sharing/ShareTokenService.scala` — create/list/revoke, CSPRNG token generation
- `backend/src/main/scala/com/helio/services/sharing/ShareTokenValidator.scala` — single-predicate token validator (design D4)
- `backend/src/main/scala/com/helio/api/protocols/sharing/ShareTokenProtocol.scala` — request/response case classes + JSON formats
- `backend/src/main/scala/com/helio/api/routes/dashboards/ShareTokenRoutes.scala` — owner-only create/list/revoke HTTP routes

### Backend — modified files

- `backend/src/main/scala/com/helio/domain/model/model.scala` — added `ShareTokenId`/`ShareToken` domain types
- `backend/src/main/scala/com/helio/api/http/AclDirective.scala` — `authorizeResourceWithSharing` gains a trailing `shareToken` param, consulted as a fallback on both denial arms (design D5); no new denial shape introduced (design D4)
- `backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala` — threads an optional `?token=` query param into `authorizeResourceWithSharing` on both public routes
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `ShareTokenRepository`/`ShareTokenService`/`ShareTokenValidatorImpl`, mounts `ShareTokenRoutes`, passes the validator into `AclDirective`
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixes in `ShareTokenProtocol`
- `backend/src/main/scala/com/helio/api/package.scala` — re-exports the new sharing protocol types
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala` — added `share_tokens` to the RLS-table allowlist (HEL-923 guard)

### Backend — new tests

- `backend/src/test/scala/com/helio/services/sharing/ShareTokenServiceSpec.scala` — task 6.1
- `backend/src/test/scala/com/helio/services/sharing/ShareTokenValidatorSpec.scala` — task 6.2
- `backend/src/test/scala/com/helio/services/sharing/ShareTokenGenerationSpec.scala` — task 6.6
- `backend/src/test/scala/com/helio/api/routes/dashboards/ShareTokenPublicAccessSpec.scala` — task 6.3
- `backend/src/test/scala/com/helio/api/http/ShareTokenAuthenticatedAccessSpec.scala` — task 6.4
- `backend/src/test/scala/com/helio/api/routes/dashboards/ShareTokenOwnershipSpec.scala` — task 6.5
- `backend/src/test/scala/com/helio/infrastructure/persistence/sharing/ShareTokenRlsSpec.scala` — task 6.7 (two genuinely distinct pools + fixture-liveness assertion)

### Contract

- `schemas/dashboards/create-share-token-request.schema.json`
- `schemas/dashboards/share-token.schema.json`
- `schemas/dashboards/create-share-token-response.schema.json`
- `openspec/changes/share-link-token-management/specs/**/spec.md` — pre-existing (planning artifacts), confirmed accurate against the shipped routes/statuses (task 4.2)

### Frontend — new files

- `frontend/src/features/dashboards/types/shareToken.ts`
- `frontend/src/features/dashboards/services/shareTokenService.ts`
- `frontend/src/features/dashboards/state/shareTokensSlice.ts`
- `frontend/src/features/dashboards/ui/DashboardShareDialog.tsx`
- `frontend/src/features/dashboards/ui/DashboardShareDialog.css`
- `frontend/src/features/dashboards/state/shareTokensSlice.test.ts` — task 6.11
- `frontend/src/features/dashboards/ui/DashboardShareDialog.test.tsx` — task 6.10

### Frontend — modified files

- `frontend/src/store/store.ts` — registers `shareTokensReducer`
- `frontend/src/features/dashboards/ui/DashboardList.tsx` — adds a "Share" action opening `DashboardShareDialog`

### Declaration corrections (delivery)

- `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.css` — CR1: stylesheet for the public viewer page, sibling of `PublicDashboardViewerPage.tsx`; was created with the page but omitted from the cycle-2 declaration
- `frontend/src/shared/chrome/MobileNavSheet.css` — CR4: restated as a standalone path; the grouped `.tsx`/`.css` form above was not parseable as a path-shaped span by the squash guard
