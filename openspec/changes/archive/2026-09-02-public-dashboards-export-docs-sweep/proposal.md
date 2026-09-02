## Why

P1.7 is the Phase-1 close-out of the Pipelines & Outputs remodel (HEL-903). The public dashboard
read path, export/import snapshot shape, and top-level docs still describe the retired
Source → Pipeline → Data type → Panel chain. This is the last gate before tag v0.7.8, the first
production deploy since the remodel began — nothing else in the remodel has ever run in prod.

## What Changes

- Public/shared dashboards resolve `panel → output → node_snapshot` on the existing optional-auth
  route; add an RLS smoke test for the public path under a non-superuser role.
- Export/import: the v2 `(type, config)` snapshot shape already carries `config.outputId` for
  output-kind panels (no `typeId`/`fieldMapping` on the wire — verified against
  `DashboardSnapshotPanelEntry`/`PanelConfigCodec`) and needs no reshape or version bump. The real
  gap: `importSnapshot` never validates that an output-kind panel's `config.outputId` resolves to
  an Output the *importing* owner can access — fixed by calling `outputRepo.findByIdOwned`
  directly (the same repository call `PanelService.rejectMissingOutput` uses internally for
  direct panel creation, invoked directly here since that method is private), failing import
  with a named error on an unresolvable Output (absorbs HEL-628).
- Simplify the helio-news panel-id lookup (sibling repo) now exports carry a stable panel `id`
  (absorbs HEL-626); update the delivery-analytics rebuild script if found.
- Rename `dataTypeId` → `outputId` on proposal/patch-set wire protocols and their frontend review
  surfaces (folds in HEL-940 — same footprint the grep sweep below already requires).
- Update README/agent-native docs/CLAUDE.md endpoint list; repo-wide grep sweep for retired
  DataType/Metric identifiers with zero hits outside migrations/history.
- New Playwright E2E: source → pipeline → 3 Outputs → dashboard in ≤ 12 interactions; existing
  Output placement in ≤ 2 interactions; wired into CI.

## Capabilities

### New Capabilities
- `public-dashboards`: anonymous/optional-auth read of a dashboard's panels via
  `panel → output → node_snapshot`, with RLS-enforced tenant isolation.

### Modified Capabilities
- `dashboard-export-import`: import validates that each output-kind panel's `config.outputId`
  resolves to an Output the importing owner can access (reusing `PanelService`'s existing
  validator), failing with a named error naming the unresolvable Output.

## Impact

Backend: `PublicDashboardRoutes` (new `GET /dashboards/:dashboardId/panels/:panelId/rows`
route, API-only — no public-dashboard frontend view exists in this codebase to wire it into; that
UI build is out of scope here and tracked as a follow-up ticket), `DashboardService.importSnapshot`,
`RlsPolicyGuardSpec`, proposal/patch-set protocols (`DashboardProposalProtocol`,
`CombinedProposalProtocol`, `AssistantProposalToolSchemas`, `WorkspaceContextProtocol`),
`ProposalPanelSupport`, `CombinedProposalService`, `WorkspaceContextComputations`. Frontend:
proposal/patch-set review pages and services. Sibling repos: `~/Development/helio-news`,
`delivery-analytics` (if found). Docs: `README.md`, `docs/agent-native.md`, `CLAUDE.md`,
`openspec/` project descriptions. E2E: new interaction-count spec; CI wiring.
