## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Atomicity (D1/AC1)** — Read `DashboardContentsOps.replaceContents`
   (`backend/src/main/scala/com/helio/infrastructure/DashboardContentsOps.scala:45-74`):
   a single `.transactionally` DBIO wrapping SELECT-existing → DELETE old panels
   → INSERT new panel rows → UPDATE layout, run via `ctx.withSystemContext`. Traced
   the caller, `DashboardContentsService.replaceContents`
   (`services/DashboardContentsService.scala:32-97`): `authorizeEditor` →
   `validatePanels` (pure) → `ProposalPanelSupport.preValidateBindings` (read-only)
   → `buildPanels` (sequential `PanelService.buildForCreate`, confirmed at
   `PanelService.scala:136-164` that this method never calls `panelRepo.insert`,
   only reads via `rejectCompanionBinding`) → only then one call to
   `dashboardRepo.replaceContents`. Live-verified against the running backend
   (port 8443): created a dashboard with one panel, PUT a payload with a bad
   second panel (`metric` missing `dataTypeId`) → `400 {"message":"panel 2 ('Bad'):
   a metric panel requires a dataTypeId"}`, then re-exported and confirmed the
   original panel (`Old Panel`) was still the only panel present — no partial
   write occurred. Followed with a valid 2-panel replace → 200, export showed the
   old panel gone and both new panels present.

2. **Get-or-create regression risk (D3)** — `git diff main...HEAD -- .../db/migration/`
   is empty; highest migration file on disk is `V72__add_lookup_op.sql`
   (pre-existing). Ran `psql \d dashboards` against the live dev DB: only
   `dashboards_pkey` and `idx_dashboards_owner_id` exist — no new unique index.
   Read `DashboardService.create` (`services/DashboardService.scala:40-77`):
   `insertNew` (the pre-existing path, now factored into a helper) is called
   unconditionally when `ifExists` is absent — same `Dashboard(...)` construction,
   same fields, byte-for-byte. `git diff` on `DashboardRepository.scala` shows only
   an added `findByNameOwned` method; `duplicate` and `updateName` have zero diff
   lines (unmodified). Confirmed live: plain `POST /api/dashboards` (no `ifExists`)
   still always creates (tested via `DashboardGetOrCreateSpec`, 7/7 green, and
   independently by re-reading the unmodified `duplicate`/`updateName` code).

3. **Multi-tenancy / cross-tenant leak** — Read `DashboardContentsService.authorizeEditor`
   (`services/DashboardContentsService.scala:124-136`): sharing-aware
   `dashboardRepo.findById(dashboardId, Some(user))` first; `None` → 404 before any
   role check, avoiding the AclDirective 403-leak `AccessCheckerImpl.requireAccess`
   would produce for a no-grant caller on an existing resource. Read
   `DashboardRepository.findById` (`infrastructure/DashboardRepository.scala:65-100`):
   returns `None` for a caller with no owner match and no permission grant — no
   existence leak. Live-verified: registered a second user, PUT to
   `/api/dashboards/<user1-id>/contents` → `404 {"message":"Dashboard not found"}`
   (not 403), and user1's panel set was confirmed unchanged afterward.

4. **V41 pipeline-only binding on replace** — Read `ProposalPanelSupport.preValidateBindings`
   and `PanelService.buildForCreate`'s call to `rejectCompanionBinding`
   (`PanelService.scala:297-307`, checks `dt.sourceId.isDefined`) — identical logic
   to `POST /api/panels`. Live-verified: found an existing companion (non-pipeline)
   DataType in this dev DB (`sourceId` populated) via `GET /api/types`, PUT a
   replace-contents payload binding a metric panel to it → `400 {"message":"panel
   'Bad Companion': panels can only bind to pipeline-output data types"}`, and the
   dashboard's prior panel set was confirmed unchanged.

5. **Sibling scope discipline** — `git diff main...HEAD --name-only` grepped for
   data-source/pipeline/DataType-teardown, batch-create, panel-id-preserving
   diff/merge, and compound-bound-panel-op surfaces: no matches. All touched files
   fall cleanly within replace-contents / get-or-create / shared panel-construction
   refactor / MCP / contracts, matching `files-modified.md`.

6. **MCP surface + contracts** — Read `helio-mcp/src/helioApi.ts` (added
   `replaceDashboardContents`, `createDashboard`'s `ifExists?` passthrough),
   `helio-mcp/src/httpClient.ts` (`put()` added, method union widened),
   `helio-mcp/src/tools/write.ts` (`replace_dashboard_contents` tool registered,
   reuses `panelSchema` exported from `tools/proposal.ts`; `create_dashboard`'s
   `ifExists` param wired through). `npx tsc --noEmit` in `helio-mcp/` — clean, no
   type errors. `schemas/replace-dashboard-contents-request.schema.json` (new,
   `$ref`s `ProposalPanel`) and `schemas/create-dashboard-request.schema.json`
   (`ifExists` enum added) both read and match the wire shapes actually used.

### Gates re-run fresh (not trusted from any report)

- `cd backend && sbt test` → **2062/2062 passed**, 117 suites, including the two
  new specs (`DashboardContentsReplaceSpec` 5/5, `DashboardGetOrCreateSpec` 7/7)
  and the full pre-existing `DashboardProposalService`/`PanelService` suites
  (confirming the extraction refactor is behavior-preserving).
- `node scripts/check-schema-drift.mjs` → clean.
- `node scripts/check-scala-quality.mjs` → clean (63 pre-existing soft
  file-size warnings only, none newly introduced).
- `npm run lint` (frontend/root ESLint, zero-warnings policy) → clean.
- `npm test` (frontend Jest) → 1423/1423 passed, 137 suites.
- `npx tsc --noEmit` in `helio-mcp/` → clean.
- Live exercise against the running dev backend (port 8443, via
  `scripts/concertino/start-servers.sh`): atomic rollback, atomic success,
  cross-tenant 404, V41 rejection, and get-or-create idempotency (201 then 200,
  same id) — all reproduced directly via curl, independent of any test suite.
- `git diff main...HEAD -- backend/src/main/resources/db/migration/` → empty;
  `psql \d dashboards` on the live dev DB → no new unique constraint.

No UI changes (`git diff main...HEAD --stat -- frontend/` is empty) — this
ticket is backend + MCP + contracts only, consistent with proposal.md's stated
impact, so no design-standard/screenshot review applies.

### Verdict: CONFIRM

### Non-blocking notes
- `PanelService.scala` grew from 301→322 lines, already over the 250-line soft
  budget pre-change (informational per CONTRIBUTING.md, not a hard gate) — a
  reasonable future-split candidate, not required for this ticket.
