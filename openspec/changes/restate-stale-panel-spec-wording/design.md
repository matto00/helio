## Context

See proposal.md and ticket.md. Premise re-derived 2026-10-14 against main 609e62b6d
(`.concertino/runs/HEL-1592/evidence/premise-validation.md` in the main checkout): all three items are real.

Code facts the change rests on (each re-verified by the executor and recorded in evidence.md, constraint C1):
- Canonical panel kinds: `text/markdown/image/divider/output/form` (`schemas/panels/create-panel-request.schema.json`
  `type` enum; `frontend/src/features/panels/ui/PanelContent.tsx` dispatcher branches).
- `PanelContent` renders text via `TextRenderer content={panel.config.content}` (literal or faded lines), markdown via
  `MarkdownRenderer`, image via `ImageRenderer` (`config.imageUrl`/`imageFit`/`caption`), divider via
  `DividerRenderer`, form via `FormRenderer` ("Form not configured" for no fields); an unhandled kind falls back to
  `MetricRenderer` (unchanged requirement "Unknown panel types degrade gracefully").
- `OutputPanelContent` picks a renderer by Output kind: `chart`/`table`/`metric`/`markdown`/`collection`/`timeline`.
- `MetricOutputPanel` builds `{ value, label: cfg.label ?? "", unit: cfg.unit ?? "" }` from the Output config: no
  `fieldMapping`, no `trend`. `MetricRenderer` keys "No data" on value presence and omits an empty label.
- Panel card badge renders `panel.type` (`PanelCard.tsx` `panel-grid-card__type-badge`).
- Proposal wire: `metricId` absent from `DashboardProposalProtocol.scala`, `helio-mcp/src/tools/proposal.ts`
  `panelSchema`, and `dashboard-proposal.schema.json`; `sort` present but "decoded but never applied".
- `create_panel` is removed (`helio-mcp/src/tools/write.ts` HEL-907 comment); `create_content_panel`
  (`placements.ts`) DOES offer `divider`. So "create_panel's enum excludes it, and the proposal surfaces mirror that
  parity" is false twice over: the tool is gone and the live content-panel tool includes divider.

## Goals / Non-Goals

**Goals:** remove or restate exactly the stale statements of the three items through deltas `openspec validate
--strict` accepts; restate the divider exclusion wording; prove no generated artifact or check changes.

**Non-Goals:** see proposal.md. Other stale requirements found while verifying are recorded in evidence.md under
"Out of scope, observed" for the Delivery follow-up triage; not fixed here.

## Decisions

D1. Delta shape (HEL-1466 D1 pattern): a requirement whose scenarios must be dropped is REMOVED (Reason/Migration)
and, when a true replacement exists, re-ADDED under a new name. `Each panel type renders a visually distinct body`
→ REMOVED + ADDED `Each canonical panel kind renders a visually distinct body` + ADDED `Metric-kind output panels
render value, unit and label from the Output config`. `Metric panel literal label/unit takes precedence...` →
REMOVED (no field-mapped value exists to take precedence over). `Type badge is visible on each panel card` →
MODIFIED (scenario name kept; example changed from "metric", "chart" to "output", "text"). The two "Panel type
selector includes markdown/image option" requirements and "Unknown panel types degrade gracefully" are verified and
left unchanged if true; if the executor finds a selector requirement false, it is recorded as out-of-scope observed
(not typeId-based, not named by the ticket).

D2. Trend: no trend scenario is carried forward. `MetricOutputPanel` never sets `trend`, so the trend line has no
source on the output path. The `metric-panel-trend-indicator` spec is out of scope (recorded as observed).

D3. mcp-panel-composition-tools: REMOVE the five ticket-named requirements (collection schema, timeline flat
binding, three metricId) with no replacement — the behaviour they specify no longer exists, and the current type set
is already specified by "propose_dashboard exposes the current agent-facing panel type set" (HEL-1466). The legacy
`sort` field's actual handling is verified (task 1.4) and stated in the Reason exactly as observed; if an invalid
`sort` value is still rejected anywhere (zod enum, schema enum, backend decode), the Reason says so.

D4. Exclusion wording. New `AGENT_SURFACE_EXCLUSIONS.divider` reason: "purely presentational layout chrome: no
content, binding or data an agent can author; excluded from the proposal surfaces only (create_content_panel still
creates dividers)". `proposal.ts` header comment: drop "mirroring create_panel", keep the pointer to the exclusion
table. `proposal.ts` `config` comment: "decoded by the same panel-create path (`PanelConfigCodec`) as
`POST /api/panels`". Schema `ProposalPanel.type` description: replace "mirrored by create_panel's enum" with "see
the AGENT_SURFACE_EXCLUSIONS table in scripts/lib/agentFacingPanelTypes.mjs; dividers remain creatable through the
MCP create_content_panel tool". `proposal.ts` `propose_dashboard` description (lines ~142-147, agent-facing): replace "dropped for agent/UI parity,
mirroring create_content_panel/place_outputs" (false: create_content_panel creates dividers) with "excluded from the
proposal flow as purely presentational chrome; create it with create_content_panel". Exact final wording may be
tightened by the executor; each claim is verified (C1).

D4a. Backend copies of the same false rationale, updated in lockstep (comments and one test name; no behaviour):
`AssistantProposalToolSchemas.scala` (~60-62, "parity with / create_panel, per that schema file's own description"
-- wrapped across lines) restated against the exclusion table; `DashboardProposalProtocol.scala` (~42-49) `sort`
comment restated as legacy decoded-never-applied, and "mirroring the MCP `create_panel` `config` passthrough"
restated as the proposal-panel `config` passthrough decoded by `PanelConfigCodec`; `DashboardAuthoringPromptSpec.scala`
`ProposalPanelSupport.scala` (~33-36) comment claiming it validates a timeline panel's `sort` is restated (no
such check exists); `DashboardAuthoringPromptSpec.scala`
:113 test NAME drops "for create_panel parity" (assertion body unchanged). The renamed spec is run and must show the
new name passing with non-zero executed count.

D5. Schema-description safety. Before editing, the executor greps the tree for every consumer of the changed
strings (backend resources, frontend copies, the in-app assistant proposal tool schema, generated files, selftests
asserting the reason text) and runs `npm run check:schemas` plus `node scripts/check-schema-drift.selftest.mjs`
before and after; any surface that embeds the same text is updated in lockstep or recorded as not embedding it.

D6. Evidence. evidence.md records, per claim, the command and its output (C1), plus the before/after check runs.

## Risks / Trade-offs

- [A delta Reason is subtly false] → task group 1 verifies each sentence; wording follows ground truth.
- [The schema description is mirrored into a generated/checked artifact] → D5 grep + check runs, before and after.
- [A wrapped multi-line comment escapes a single-line grep] → task 2.6 probes `create_panel` alone (not phrase
  forms) across `scripts/lib helio-mcp/src schemas backend/src frontend/src`, and every remaining hit is classified
  (accurate history like "replaces create_panel" vs. false parity claim) in evidence.md.
- [REMOVED header mismatch aborts archive] → headers copied byte-exact; `openspec validate --strict` gate.

## Planner Notes

Design gate round 1 (REFUTE, skeptic-design-1.md) addressed: propose_dashboard description (D4); backend copies (D4a,
task 2.4a/2.6 widened); duration-format unit exception + scenario; image scenarios restated against
`sanitizeImageUrl`/F-112; trend Reason names `data.trend`; `sort` Reason states invalid-value handling.

Design gate round 2 (REFUTE, skeptic-design-2.md) addressed: image scenarios restated around `sanitizeImageUrl`'s
real rule (resolve against origin; placeholder only for empty/unparseable/non-http(s)); task 1.2 records a bare
relative value probe; `ProposalPanelSupport.scala` sort comment added to D4a; `sort` Reason distinguishes runtime
zod rejection from the contract schema enum.

Self-approved: REMOVE-without-replacement for the five mcp requirements (D3); no trend scenario (D2); badge example
change (D1); selector requirements verified-not-rewritten (D1). Docs/specs/comments only; no escalation needed.
