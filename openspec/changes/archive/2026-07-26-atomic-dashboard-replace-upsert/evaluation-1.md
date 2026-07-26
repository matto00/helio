## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 7 ticket ACs addressed explicitly: atomic all-or-nothing replace with 400
  naming the offending panel (`DashboardContentsService.buildPanels` short-circuits
  before any DB write); same response shape as apply-proposal/import
  (`DuplicateDashboardResponse`); V41 + RLS enforced identically to `POST /api/panels`
  (reuses `PanelService.buildForCreate`/`rejectCompanionBinding` and
  `ProposalPanelSupport.preValidateBindings`); get-or-create-by-name, owner-scoped,
  no duplicates on repeated sequential calls; live dashboard never observably empty
  (single `.transactionally` DBIO); ScalaTest coverage for replace success/rollback/
  get-or-create idempotency all present and passing; MCP tool `replace_dashboard_contents`
  added and documented.
- No AC silently reinterpreted.
- tasks.md: all 21 items checked, and each matches the actual diff (verified file-by-file,
  not just the checkbox).
- No scope creep: git diff touches only the files listed in files-modified.md; no
  sibling-ticket scope absorbed — grepped for HEL-370 (batch panel-create), HEL-364
  (compound bound-panel op), HEL-366 (resource tagging/bulk-teardown), HEL-368
  (panel-id reconciliation) surfaces; none touched.
- No regressions: full backend suite (2062 tests) and frontend suite (1423 tests) both
  green, re-run fresh by me (not the executor's report).
- API contracts updated in the same change: `schemas/replace-dashboard-contents-request.schema.json`
  (new, `$ref`s `ProposalPanel`, no duplicated shape), `schemas/create-dashboard-request.schema.json`
  (`ifExists` added), plus the two capability spec.md deltas.
- Planning artifacts (design.md D1-D4, tasks.md) match the final implementation exactly
  — verified line-by-line against the code, not just skimmed.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **D1 (real repository-layer transaction, zero DB writes on failure) — verified by
  tracing the code, not trusting tests**: `DashboardContentsOps.replaceContents`
  (`backend/src/main/scala/com/helio/infrastructure/DashboardContentsOps.scala:54-71`)
  wraps the SELECT-existing-row + DELETE-old-panels + INSERT-new-panels + UPDATE-layout
  sequence in one `.transactionally` DBIO. `DashboardContentsService.replaceContents`
  (`.../services/DashboardContentsService.scala:37-48`) runs `authorizeEditor` →
  `validatePanels` (pure, no I/O) → `ProposalPanelSupport.preValidateBindings` (read-only
  `dataTypeRepo.findByIdOwned` calls) → `buildPanels` (sequential `PanelService.buildForCreate`,
  which constructs-and-validates but never calls `panelRepo.insert` —
  confirmed by reading `PanelService.scala:136-164`) — and only after every panel in the
  batch is known-good does it call `dashboardRepo.replaceContents` once. Live-verified:
  PUT with a bad panel at index 2 returned 400 and a follow-up export showed the original
  panel set completely unchanged (see Phase 3 below for the actual request/response pairs).
- **D2 (ProposalPanel/ProposalPanelLayout reused verbatim; ids minted + layout remapped
  pre-transaction)**: `ReplaceDashboardContentsRequest(panels: Vector[ProposalPanel])`
  (`DashboardProposalProtocol.scala:46`) — no new panel DTO. `DashboardContentsService.buildAndReplace`
  builds panels first (minting fresh `PanelId`s inside `PanelService.buildForCreate`), then
  `remapLayout` (`DashboardContentsService.scala:107-112`) maps each `ProposalPanel.layout`
  onto its freshly built panel's id into a `DashboardLayout`, and only then calls
  `replaceContents` — matches D2 exactly.
- **D3 (no new migration; duplicate/updateName/plain-create untouched)**: confirmed no new
  Flyway migration file exists (highest is `V72__add_lookup_op.sql`, pre-existing).
  `git diff main...HEAD -- backend/.../DashboardRepository.scala` shows only an added
  `findByNameOwned` method — `duplicate` and `updateName` have zero diff lines. `DashboardService.update`
  (rename path) and `duplicate` are unmodified. New regression tests
  (`DashboardGetOrCreateSpec`) explicitly assert plain-create/duplicate/rename still allow
  same-owner name collisions — all pass.
- **D4 (last-writer-wins named, not engineered around)**: both `DashboardContentsOps.replaceContents`
  and `DashboardService.create`'s scaladocs name the accepted races explicitly; matches
  the spec deltas' "Overlapping replace-contents" and "Concurrent get-or-create race" scenarios.
- **Cross-tenant → 404, not 403**: verified both via the new ScalaTest
  (`DashboardContentsReplaceSpec`, "return 404 for a dashboard owned by another user") and
  live against the running dev server (second registered user attempting `PUT .../contents`
  on the first user's dashboard → `404 {"message":"Dashboard not found"}`, target dashboard's
  panels confirmed unaffected afterward). The executor's claimed fix
  (`authorizeEditor` mirroring `DashboardService.update`'s two-step sharing-aware pattern
  instead of a direct `accessChecker.requireAccess` call) is real and correctly explains why
  a naive implementation would have leaked existence via 403.
- **source → pipeline → type → panel binding held for replace-contents**: `ProposalPanelSupport.preValidateBindings`
  and `PanelService.buildForCreate`'s `rejectCompanionBinding` both run for every panel in
  the replace payload; `DashboardContentsReplaceSpec`'s V41 test passes, and this was
  independently re-verified live is not required beyond the passing test (logic is identical
  code path to `POST /api/panels`).
- Behavior-preserving refactor claim (extracting `ProposalPanelSupport` out of
  `DashboardProposalService`, `PanelService.buildForCreate` out of `create`) verified: diffs
  are pure move/delegate, no logic changes; full pre-existing `DashboardApplyProposal*Spec`
  and `PanelService*Spec` suites pass unchanged (part of the 2062 green backend run).
- Canonical-standard [mechanical] checks: `check-scala-quality.mjs` clean (no inline-FQN
  violations in new/changed files); `check-schema-drift.mjs` clean; ESLint zero-warnings
  clean; Prettier clean. File-size soft budget: `PanelService.scala` grew from 301→322
  lines (was already over the 250-line soft budget pre-change) — informational only per
  CONTRIBUTING.md, not a hard gate; flagged as a non-blocking suggestion below. All new
  files (`DashboardContentsOps.scala` 75, `DashboardContentsService.scala` 137,
  `ProposalPanelSupport.scala` 163) are comfortably under budget.
- Route boundary rule followed: `DashboardContentsRoutes` uses `DashboardIdSegment`
  (`IdParsing`) for path extraction, matching the CONTRIBUTING.md value-class-ID convention.
- Tests are meaningful: `DashboardContentsReplaceSpec` and `DashboardGetOrCreateSpec` assert
  actual panel-set state (via `/export`) before/after, not just HTTP status codes; would
  catch a real regression in the transaction or ACL logic.
- No dead code, no leftover TODO/FIXME in the diff.
- No over-engineering: D3's explicit rejection of a DB constraint (in favor of app-level
  check-then-insert) is the right call per the design gate's own reasoning, and the code
  matches that decision precisely.

### Phase 3: UI Review — N/A (confirmed no frontend changes)
`git diff main...HEAD --stat -- frontend/` is empty — this ticket is backend + MCP +
contracts only, exactly as proposal.md's Impact section states. Verification instead
consisted of exercising the two new HTTP endpoints live against the dev backend
(started via `scripts/concertino/start-servers.sh`, port 8443):

- Get-or-create: first `POST /api/dashboards {ifExists:"return"}` → 201; identical
  repeat call → 200 with the same dashboard id (no duplicate).
- Replace-contents rollback: `PUT .../contents` with a bad panel (metric, no
  `dataTypeId`) → 400 naming "panel 2"; follow-up export showed the pre-existing panel
  set (`["Old Panel"]`) completely unchanged.
- Replace-contents happy path: valid 2-panel payload → 200 with the rebuilt dashboard;
  follow-up export showed the old panel gone and the new two panels present.
- Cross-tenant: a second registered user's `PUT .../contents` against the first user's
  dashboard → 404 (not 403), target dashboard's panels confirmed unaffected afterward.

No console errors possible to observe (no browser surface); no frontend build/lint
regressions since no frontend files changed (`npm test` 1423/1423, `npm run lint`/
`format:check` clean, both re-run fresh).

Additional gates re-run fresh (not trusting the executor's report):
- `cd backend && sbt test` — 2062/2062 passed.
- `node scripts/check-schema-drift.mjs` — clean.
- `node scripts/check-scala-quality.mjs` — clean (63 pre-existing soft file-size warnings,
  none newly introduced by this change beyond the PanelService growth noted above).
- `npm run lint` / `npm run format:check` / `npm test` (frontend) — all clean/green.
- `helio-mcp`: `npm run typecheck` and `npm run build` — both clean.
- `npm run check:openspec` reports the change is complete-but-not-archived — expected;
  archiving happens at Phase 4 delivery, not evaluation.

### Overall: PASS

### Non-blocking Suggestions
- `PanelService.scala` is now 322 lines, up from 301 (already over the 250-line soft
  budget before this change). Not a hard gate and not ticket scope to fix now, but a
  reasonable candidate for a future split (e.g. batch-update logic into its own file)
  if it grows further.
