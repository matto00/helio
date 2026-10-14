## Standing Constraints

- [C1] Every factual claim in every delta, comment and schema description changed by this change has a verification command and its output recorded in this change's evidence.md; a claim that fails verification is corrected to match ground truth, never the reverse.

### Backend

## 1. Verify delta and wording claims (no code behaviour change)

- [x] 1.1 Verify every design.md "Code facts" bullet with a command (grep/sed/test run); record command + output in evidence.md
- [x] 1.2 Verify every sentence of the panel-type-rendering delta (ADDED/MODIFIED scenarios, REMOVED Reasons) against PanelContent/renderers/OutputPanelContent/MetricOutputPanel/PanelCard and existing tests, incl. a `sanitizeImageUrl` probe with a bare relative value (`photo.png`), `data:` and `//evil.com/x`; record
- [x] 1.3 Verify the "Panel type selector" and "Unknown panel types" requirements; leave unchanged if true, else record under "Out of scope, observed"
- [x] 1.4 Verify every sentence of the mcp-panel-composition-tools REMOVED Reasons/Migrations (create-panel-request enum, HEL-907 removal, sort handling incl. invalid-value behaviour, metricId absence in protocol/panelSchema/schema, preValidateBindings, propose_dashboard metric catalog, /api/metrics 404 route evidence); record
- [x] 1.5 Amend any delta wording a probe contradicts; `openspec validate restate-stale-panel-spec-wording --type change --strict` passes

## 2. Restate the divider exclusion wording

- [x] 2.1 Grep the whole tree (excluding node_modules and openspec/changes/archive) for every consumer of the three strings and of the schema description text; record
- [x] 2.2 Run `npm run check:schemas` and `node scripts/check-schema-drift.selftest.mjs` BEFORE editing; record output
- [x] 2.3 Edit `AGENT_SURFACE_EXCLUSIONS.divider` reason in scripts/lib/agentFacingPanelTypes.mjs per design D4
- [x] 2.4 Edit helio-mcp/src/tools/proposal.ts: both comments (header, `config`) and the `propose_dashboard` description's divider clause per design D4
- [x] 2.4a Edit backend comments/test name per design D4a (AssistantProposalToolSchemas, DashboardProposalProtocol, ProposalPanelSupport sort comment, DashboardAuthoringPromptSpec name only)
- [x] 2.5 Edit `ProposalPanel.type` description in schemas/dashboards/dashboard-proposal.schema.json per design D4 (and any lockstep surface found in 2.1)
- [x] 2.6 Probe `grep -rn "create_panel\b" scripts/lib helio-mcp/src schemas backend/src frontend/src` and `grep -rn "parity" helio-mcp/src/tools/proposal.ts backend/src/main/scala/com/helio/api/protocols`; classify every remaining hit (accurate history vs false claim, zero false claims); record

### Tests

## 3. Gates

- [x] 3.1 Re-run `npm run check:schemas` and the schema-drift selftest AFTER editing; both green; record
- [x] 3.2 helio-mcp typecheck and test suite green (own worktree paths, non-zero counts); record
- [x] 3.2a Backend compiles and `DashboardAuthoringPromptSpec` passes under its new name (sbt testOnly, own worktree, non-zero count; HELIO_TEST_JVM_XMX=3g); record
- [x] 3.3 Record "Out of scope, observed" stale statements found during verification in evidence.md for Delivery triage
- [x] 3.4 `openspec validate restate-stale-panel-spec-wording --type change --strict` green; commit
