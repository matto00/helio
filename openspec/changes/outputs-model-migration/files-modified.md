# Files modified — cycle 27 (this cycle: section 5, tasks 5.1-5.4/5.6 only)

- `schemas/data-types/data-type-assertion-status.schema.json` → `schemas/outputs/output-assertion-status.schema.json` (git mv) — task 5.1: relocated per the ticket, `$id` updated to the new path; field shapes untouched (a pure move, not a reshape).
- `schemas/panels/panel.schema.json` — task 5.2: `oneOf` collapsed from the 9-arm bound-kind set (metric/chart/table/text/markdown/image/divider/collection/timeline) to the actual 5-kind `Panel.Registry` set (output/text/markdown/image/divider); deleted the five retired bound `$defs` (`MetricConfig`/`ChartConfig`/`TableConfig`/`CollectionConfig`/`TimelineConfig` + their nested aggregation/options defs); added `OutputConfig` (`{outputId: string}`) matching `OutputPanelConfig`; trimmed `TextConfig`/`MarkdownConfig` to their actual single `content` property (dropped stale `dataTypeId`/`fieldMapping`, confirmed dead against `TextPanelConfig`/`MarkdownPanelConfig`).
- `schemas/panels/create-panel-request.schema.json` — task 5.2: `allOf` mirrors the same 5-arm collapse (removed metric/chart/table/collection/timeline `if/then` branches, added `output` → `OutputConfig`).
- `schemas/panels/create-panels-batch-request.schema.json` — task 5.2: `type` enum corrected from the stale 9-value list to the canonical 5-value set (`text|markdown|image|divider|output`) for internal consistency (not covered by the drift script's `panelTypeSurfaces`, but still a real drift against backend reality).
- `schemas/panels/panel-capabilities-response.schema.json` — deleted (task 5.2): the only route it documented (`GET /api/types/:id/panel-capabilities`) was already deleted with `DataTypeRoutes`; `PanelCapabilityService` itself is kept (design.md decision) but is no longer route-facing.
- `schemas/panels/panel-query.schema.json` — deleted (task 5.2): unreferenced by any schema, backend, or frontend code.
- `openspec/changes/outputs-model-migration/tasks.md` — marked 5.1/5.2/5.3/5.4/5.6 `[x]` with verification notes; documented that the wire field stays `type` (not `kind`) since `PanelResponse`/`CreatePanelRequest` never renamed it — 5.4(c)'s original "properties.kind.enum" plan text was superseded by the actual implementation, which the drift script already correctly tracks.
- `openspec/changes/outputs-model-migration/execution-progress.md` — appended this cycle's log entry.

No backend (Scala) files touched this cycle — schemas-only diff, confirmed via `git diff --name-only main...HEAD`.

# Files modified — cycle 28 (this cycle: 5.7 verification, section 6 sweep, escalation)

- `openspec/changes/outputs-model-migration/tasks.md` — marked 5.7 `[x]` (verified already-complete: `helio-mcp/src/tools/proposal.ts:28`'s `PANEL_TYPES` and `dashboard-proposal.schema.json`'s `ProposalPanel.properties.type.enum` already both read `["text","markdown","image","output"]`, matching `agentFacingKinds`; `check-schema-drift.mjs` confirms both surfaces green — no edit needed).
- No other source files modified this cycle. Task 6.1's grep surfaced a substantial, real gap (see execution-progress.md and this cycle's escalation) that requires an orchestrator/design decision before further code changes — no blind edits made pending that answer.
