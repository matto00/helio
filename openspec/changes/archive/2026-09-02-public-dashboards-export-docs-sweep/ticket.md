# HEL-910: P1.7 — Public dashboards, export/import, docs, rebuild scripts, end-to-end proof

## Description

Row P1.7 of HEL-903 (Pipelines & Outputs remodel epic) — the Phase-1 close-out. Public/shared dashboards (`PublicDashboardRoutes`, optional-auth `GET /api/dashboards/:id/panels`) were rewired to `panel → output → pipeline` in P1.3 so the route compiles; this ticket finishes the public path (rows via `node_snapshots`, RLS smoke); export/import (`DashboardSnapshotRoutes`, `DashboardService.exportSnapshot/importSnapshot`) serializes `typeId`/`fieldMapping` per panel; `README.md` "How data flows", `docs/agent-native.md`, and `CLAUDE.md`'s endpoint list describe Source → Pipeline → Data type → Panel.

THIS IS THE LAST ROW OF THE PHASE-1 BATCH. Immediately after merge, tag v0.7.8 is cut — the FIRST production deploy since the remodel began. Nothing in the remodel has ever run in production. This ticket's sweep is the last gate before all of it ships at once.

Source of truth: `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` — wins over ticket text wherever they disagree. Decision 11: DataTypes/Metrics deleted wholesale, no shims/aliases/dual-read paths. Decision 17: main was knowingly non-functional as a web app between P1.3 and P1.6 — P1.6 closed that; confirm main is now a working app as part of this sweep rather than assuming it.

## Scope (also see HEL-940 fold-in below)

* **Public read path:** public/shared dashboards resolve `panel → output → node_snapshot` on the existing optional-auth route; RLS smoke covers the public path under a non-superuser role.
* **Export/import:** snapshot payload version bump; Outputs serialized by reference (`pipelineId`, `outputId`, plus the Output's kind/name for display); import requires the referenced pipeline to exist and validates the panel's appearance and cross-field constraints on the way in (absorbs HEL-628); the stable panel `id` in exports is what helio-news keys on — simplify that lookup in the helio-news script (absorbs HEL-626).
* **Docs:** `README.md` "How data flows" and feature bullets (drop "Metrics layer"); `docs/agent-native.md` (new canonical path + the tool rename table from P1.4); `CLAUDE.md` key-endpoint list (`/api/outputs/*`, single-call `POST /api/pipelines`, removed `/api/types`, `/api/metrics`); `openspec/` project-level descriptions; the onboarding/empty-state copy audit for stragglers.
* **Rebuild scripts (sibling repos, not this one):** the helio-news rebuild lives in `~/Development/helio-news` (`news/helio_client.py` and its callers); the delivery-analytics rebuild is the user's script tagged `delivery-analytics-v2` (location unknown — search `~/Development`; if not found, record that in the PR and stop). Update what is found to `create_pipeline` + `place_outputs`, run once against dev, commit in the sibling repo, link the PR in this PR. Say explicitly which scripts were and were not found.
* **End-to-end proof:** Playwright spec `source → pipeline → three Outputs → dashboard` asserting ≤ 12 user interactions (clicks + Enter, typing excluded) from "New pipeline" with a pasted table to three Outputs placed on a dashboard, and ≤ 2 interactions to place an already-existing Output on a dashboard. Run in CI; the P1.4 Sleeper MCP rebuild wired into CI e2e (or a documented manual gate if it needs the live API).
* **Final sweep (headline deliverable):** grep for `com\.helio\..*DataType`, `DataTypeId`, `MetricDefinition`, `MetricId`, `type_id`, `dataTypeId`, `metricId`, `/registry`, `/metrics`, `computed_fields`, `@deprecated`, `TODO(remodel)` (Spark SQL's `org.apache.spark.sql.types.DataType` is not a hit) across `backend/`, `frontend/`, `helio-mcp/`, `e2e/`, `schemas/`, `openspec/`, `docs/`, `README.md`, `CLAUDE.md` — zero hits outside `backend/src/main/resources/db/migration/` and git history.
* **HEL-940 (folded in, orchestrator decision, escalated 2026-09-02):** `dataTypeId` → `outputId` wire-field rename on `DashboardProposalProtocol`/`CombinedProposalProtocol`/`AssistantProposalToolSchemas`/`WorkspaceContextProtocol` and the frontend proposal/patch-set review surfaces that read it. Premise validation found this footprint is materially larger than HEL-940's own file list (`ProposalPanelSupport.scala`, `CombinedProposalService.scala`, `WorkspaceContextComputations.scala`, `PanelRepository`, `PipelineRepository`, `PanelService`, `PatchSet*` resolvers all carry live `dataTypeId` references) — this is the same work the grep sweep above already requires, not incremental scope.

## Acceptance criteria

- [ ] Public/shared dashboards resolve `panel → output → node_snapshot` at the HTTP level (new `GET /api/dashboards/:dashboardId/panels/:panelId/rows`, gated by the existing dashboard sharing ACL); RLS smoke for the public path passes. No public-dashboard frontend viewer exists in this codebase — that UI is out of scope here and tracked as a follow-up ticket filed during execution (orchestrator decision, design-gate round 1 finding).
- [ ] Export → import round-trip of a migrated dashboard produces an identical dashboard (panels, layout, appearance) against the same pipelines; import with an unresolvable `outputId` fails with a named error (the v2 snapshot already carries `config.outputId` — no wire-shape reshape or version bump, design-gate round 1 finding).
- [ ] README / agent-native / CLAUDE.md updated; `check:openspec` green.
- [ ] Every rebuild script an agent could locate runs green against dev and is committed where it lives; the PR states explicitly which scripts were found and which were not.
- [ ] Playwright interaction-count E2E in CI. Scenario 2 (existing-Output placement) meets its <=2 AC exactly. Scenario 1 (source->3 Outputs->dashboard) measures 28 interactions against a <=12 target -- provably unreachable against the shipped P1.5/P1.6 OutputEditorSheet UI (documented in the spec's own header comment); accepted as-is (orchestrator decision, escalated to the human) with a follow-up ticket HEL-942 filed to streamline that UI, blocked by this row. Sleeper MCP rebuild not CI-wired -- documented reason (no npm entry point + no PAT-bootstrap step in CI, not a live-credential blocker as originally assumed) rather than silently left undone.
- [ ] Final grep sweep is clean (per design.md Decision 6's allowlist: db/migration; `openspec/changes/**` archives; HEL-NNN-prefixed comments/schema descriptions; tests asserting absence of a retired route/field — NOT a bare "migrations and git history" rule) and pasted into the PR, including `dataTypeId`/`DataTypeId`/`metricId`/`type_id` across `backend/src frontend/src helio-mcp/src schemas/ openspec/specs` (HEL-940 AC).
- [ ] Backend `sbt test` and frontend `npm run typecheck`/`npm test` green after the HEL-940 rename; proposal/patch-set review Playwright coverage still passes.
- [ ] Confirm main is genuinely a working web app end-to-end (decision 17) as part of the sweep, not assumed.

## Out of scope

Branching (P2.x); templates (R1, HEL-551); global search (R2, HEL-503).

## Known live items to verify against the tree

- HEL-936's `/api/types` frontend migration: premise check found 0 remaining references in `frontend/src` — verify this holds and note in the PR.
- `e2e/hel813-mobile-touch-target-floor.spec.ts` is documented as flaky (poll-then-walk race at `e2e/support/touchTargetProbe.ts:100-115`). If touched, fix the race; otherwise file a follow-up ticket. Do not let it mask a real failure or vice versa.

## Hard-won lessons (apply throughout)

1. Confirm dev servers (frontend + backend) started from the commit under test before any UI evidence — use `scripts/concertino/start-servers.sh <WORKTREE> <DEV_PORT> <BACKEND_PORT> HEL-910`.
2. Probe the running system (curl/Playwright) — do not trust docs/plans/code comments for wire-shape or behavior claims.
3. Any regression guard must be observed RED before it is trusted (`test.fail()` pattern).
4. When a defect is found, enumerate its class systematically (all handlers/files of that shape), not just the one instance.
5. The dev database is shared across worktrees — clean up any probe data created.
